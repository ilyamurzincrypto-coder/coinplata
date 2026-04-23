// src/pages/CashierPage.jsx
import React, { useState } from "react";
import Balances from "../components/Balances.jsx";
import RatesBar from "../components/RatesBar.jsx";
import ExchangeForm from "../components/ExchangeForm.jsx";
import TransactionsTable from "../components/TransactionsTable.jsx";
import EditTransactionModal from "../components/EditTransactionModal.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useAudit } from "../store/audit.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useObligations } from "../store/obligations.jsx";
import { officeName } from "../store/data.js";
import { fmt } from "../utils/money.js";
import { buildMovementsFromTransaction } from "../utils/exchangeMovements.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateDeal, withToast, uuidOrNull } from "../lib/supabaseWrite.js";

export default function CashierPage({ currentOffice }) {
  const [balanceScope, setBalanceScope] = useState("selected");
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { addTransaction, updateTransaction } = useTransactions();
  const { addEntry: logAudit } = useAudit();
  const { accounts, addMovement, removeMovementsByRefId, balanceOf, reservedOf } = useAccounts();
  const { currentUser } = useAuth();
  const { addObligation, openWeOweByOfficeCurrency } = useObligations();

  // Находит легы, для которых не хватает available — они станут obligations.
  // Правило: проверяется доступное по КОНКРЕТНОМУ выбранному аккаунту
  //   available = balanceOf(acc) - reservedOf(acc) - уже-зарезервированное-выше-в-этой-сделке
  // Open obligations по office+currency также учитываются (не даём повторно зарезервировать
  // то что уже обещано).
  const detectObligationLegs = (tx) => {
    const set = new Set();
    const committed = new Map(); // accountId → сколько уже зарезервировали в legs выше
    const outs = tx.outputs || [];
    outs.forEach((leg, idx) => {
      if (!leg.accountId) return; // без account сделка уже с warning, не obligation
      const acc = accounts.find((a) => a.id === leg.accountId);
      if (!acc) return;
      const balance = balanceOf(leg.accountId);
      const reserved = reservedOf(leg.accountId);
      const priorCommit = committed.get(leg.accountId) || 0;
      // Open we_owe по office+currency — уменьшает пул (деньги уже обещаны).
      const owedOnOfficeCurrency = openWeOweByOfficeCurrency(acc.officeId, leg.currency);
      const available = balance - reserved - priorCommit - owedOnOfficeCurrency;
      if (available < leg.amount) {
        set.add(idx);
      } else {
        committed.set(leg.accountId, priorCommit + leg.amount);
      }
    });
    return set;
  };

  const handleCreate = async (tx) => {
    if (submitting) return; // double-click guard
    // DB-режим: всю логику (obligation decisions, movements, fee, profit)
    // берёт на себя RPC create_deal. Frontend только строит payload + бампает.
    if (isSupabaseConfigured) {
      setSubmitting(true);
      try {
        // Локальные cp_/a_ id не годятся для FK — пропускаем только UUID.
        // Nickname сохраняется в client_nickname. TODO Stage 5: auto-insert
        // нового клиента в clients при submit.
        const res = await withToast(
          () =>
            rpcCreateDeal({
              officeId: uuidOrNull(tx.officeId),
              managerId: currentUser.id,
              clientId: uuidOrNull(tx.counterpartyId),
              clientNickname: tx.counterparty || null,
              currencyIn: tx.curIn,
              amountIn: tx.amtIn,
              inAccountId: uuidOrNull(tx.accountId),
              inTxHash: tx.inTxHash || null,
              referral: !!tx.referral,
              comment: tx.comment || "",
              status: tx.status || "completed",
              outputs: (tx.outputs || []).map((o) => ({
                ...o,
                accountId: uuidOrNull(o.accountId),
              })),
            }),
          { success: "Deal created", errorPrefix: "Create deal failed" }
        );
        if (res.ok) {
          setJustCreatedId(res.result);
          setTimeout(() => setJustCreatedId(null), 2500);
          const outStr = (tx.outputs || [])
            .map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`)
            .join(" + ");
          logAudit({
            action: "create",
            entity: "transaction",
            entityId: String(res.result),
            summary: `${fmt(tx.amtIn, tx.curIn)} ${tx.curIn} → ${outStr}`,
          });
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Demo-режим (in-memory): оригинальная логика.
    // 1. Защита от дублей
    removeMovementsByRefId(tx.id);

    // 2. Ищем легы с недостатком available → obligations.
    const obligationLegs = detectObligationLegs(tx);

    // 3. Если есть obligations — сделка форсится в 'pending' (неважно что пришло).
    //    Инвариант: баланс не уходит в минус.
    const nowIso = new Date().toISOString();
    let finalTx = obligationLegs.size > 0
      ? { ...tx, status: "pending", hasObligations: true }
      : tx;

    // === Leg-level lifecycle ===
    // Для каждого OUT leg решаем: paid-out сейчас или pending.
    //   — obligation-leg     → actual=0, completedAt=null (деньги обещаны, не выданы)
    //   — crypto send        → actual=0, completedAt=null (pending_send, ждём on-chain)
    //   — deal 'checking'    → actual=0, completedAt=null (ждём crypto match)
    //   — deal 'pending' (manual) → actual=0, completedAt=null
    //   — всё остальное      → actual=planned, completedAt=now
    const outs = (finalTx.outputs || []).map((leg, idx) => {
      const isObligation = obligationLegs.has(idx);
      const isCryptoSendPending = leg.sendStatus && leg.sendStatus !== "confirmed";
      const isDealPending = finalTx.status === "pending" || finalTx.status === "checking";
      const fullyPaid = !isObligation && !isCryptoSendPending && !isDealPending;
      return {
        ...leg,
        actualAmount: fullyPaid ? leg.plannedAmount ?? leg.amount ?? 0 : 0,
        completedAt: fullyPaid ? nowIso : null,
      };
    });

    // IN side: аналогично — для checking ждём блокчейн, для manual pending ждём действий.
    const inCompleted = finalTx.status === "completed" && finalTx.accountId;
    finalTx = {
      ...finalTx,
      outputs: outs,
      inActualAmount: inCompleted ? (finalTx.amtIn || 0) : 0,
      inCompletedAt: inCompleted ? nowIso : null,
    };

    addTransaction(finalTx);
    setJustCreatedId(finalTx.id);
    setTimeout(() => setJustCreatedId(null), 2500);

    // 4. Создаём movements (OUT по obligation-легам пропускаем).
    const { movements, warnings } = buildMovementsFromTransaction(
      finalTx,
      accounts,
      currentUser.id,
      { obligationLegs }
    );
    movements.forEach(addMovement);

    // 5. Для каждой obligation-леги — создаём we_owe obligation.
    const obligationSummaries = [];
    obligationLegs.forEach((idx) => {
      const leg = (finalTx.outputs || [])[idx];
      if (!leg) return;
      const acc = accounts.find((a) => a.id === leg.accountId);
      if (!acc) return;
      addObligation({
        officeId: acc.officeId,
        dealId: finalTx.id,
        dealLegIndex: idx,
        clientId: finalTx.counterpartyId || null,
        currency: leg.currency,
        amount: leg.amount,
        direction: "we_owe",
        note: `Deal #${finalTx.id} — insufficient ${leg.currency} in ${officeName(acc.officeId)}`,
        createdBy: currentUser.id,
      });
      obligationSummaries.push(`${fmt(leg.amount, leg.currency)} ${leg.currency}`);
    });

    // 6. Audit log.
    const outStr = (finalTx.outputs || [{ currency: finalTx.curOut, amount: finalTx.amtOut }])
      .map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`)
      .join(" + ");
    const warnSuffix = warnings.length > 0 ? ` · ⚠ ${warnings.length} warn` : "";
    const oblSuffix = obligationSummaries.length
      ? ` · 🔒 ${obligationSummaries.length} obligation(s): ${obligationSummaries.join(", ")}`
      : "";
    const statusPrefix =
      finalTx.status === "pending" ? (obligationLegs.size ? "[PENDING/OBLIGATION] " : "[PENDING/RESERVED] ")
        : finalTx.status === "checking" ? "[CHECKING] " : "";
    logAudit({
      action: "create",
      entity: "transaction",
      entityId: String(finalTx.id),
      summary: `${statusPrefix}${fmt(finalTx.amtIn, finalTx.curIn)} ${finalTx.curIn} → ${outStr} · fee $${fmt(finalTx.fee)}${warnSuffix}${oblSuffix}`,
    });
  };

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      <RatesBar />
      <Balances currentOffice={currentOffice} scope={balanceScope} onScopeChange={setBalanceScope} />

      <div className="grid grid-cols-1 xl:grid-cols-[440px_1fr] gap-6 items-start">
        <section className="xl:sticky xl:top-[140px]">
          <ExchangeForm mode="create" currentOffice={currentOffice} onSubmit={handleCreate} submitting={submitting} />
        </section>

        <TransactionsTable
          currentOffice={currentOffice}
          justCreatedId={justCreatedId}
          onEdit={setEditingTx}
        />
      </div>

      <EditTransactionModal transaction={editingTx} onClose={() => setEditingTx(null)} />
    </main>
  );
}
