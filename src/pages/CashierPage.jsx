// src/pages/CashierPage.jsx
import React, { useState, useEffect } from "react";
import { Plus, ArrowUpRight } from "lucide-react";
import Balances from "../components/Balances.jsx";
import RatesBar from "../components/RatesBar.jsx";
import ExchangeDrawer from "../components/ExchangeDrawer.jsx";
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
import { rpcCreateDeal, withToast, uuidOrNull, ensureClient } from "../lib/supabaseWrite.js";

export default function CashierPage({ currentOffice }) {
  const [balanceScope, setBalanceScope] = useState("selected");
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Mode state: "view" — котировки + транзакции + CTA.
  //             "create" — drawer с формой справа, транзакции сжимаются.
  // minimized: внутри create-mode drawer можно свернуть без потери данных.
  //            Form остаётся mounted в drawer'е → state сохраняется.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMinimized, setDrawerMinimized] = useState(false);

  const openDrawer = () => {
    setDrawerOpen(true);
    setDrawerMinimized(false);
  };
  const minimizeDrawer = () => setDrawerMinimized(true);
  const restoreDrawer = () => setDrawerMinimized(false);
  const closeDrawer = () => {
    setDrawerOpen(false);
    setDrawerMinimized(false);
  };

  // Hotkey N — быстро открыть создание сделки (кассирам не нужно тянуться к мыши).
  useEffect(() => {
    const onKey = (e) => {
      // Игнорируем если в input'е / textarea / modal'е или мета-клавиши.
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        if (!drawerOpen || drawerMinimized) {
          e.preventDefault();
          openDrawer();
        }
      } else if (e.key === "Escape" && drawerOpen && !drawerMinimized) {
        minimizeDrawer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, drawerMinimized]);

  const { addTransaction, updateTransaction, counterparties } = useTransactions();
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

  // Возвращает { ok } — чтобы drawer закрывался только при успехе.
  const handleCreate = async (tx) => {
    if (submitting) return { ok: false };
    // DB-режим: всю логику (obligation decisions, movements, fee, profit)
    // берёт на себя RPC create_deal. Frontend только строит payload + бампает.
    if (isSupabaseConfigured) {
      setSubmitting(true);
      try {
        // Гарантируем существование клиента в clients (match-or-insert).
        // Дедупликация по nickname/telegram. Если не удалось — fallback на
        // client_nickname only (deal создастся без FK-связи, не блокируется).
        const resolvedClientId = await ensureClient(
          {
            nickname: tx.counterparty,
            telegram: tx.counterpartyTelegram,
            counterpartyId: tx.counterpartyId,
          },
          counterparties
        );

        const res = await withToast(
          () =>
            rpcCreateDeal({
              officeId: uuidOrNull(tx.officeId),
              managerId: currentUser.id,
              clientId: resolvedClientId,
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
        return { ok: res.ok };
      } finally {
        setSubmitting(false);
      }
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
    return { ok: true };
  };

  // В режиме create (drawer открыт и не свёрнут) добавляем padding справа,
  // чтобы основной контент не уходил под drawer. На маленьких экранах drawer
  // накрывает контент как overlay → padding не нужен.
  const drawerActive = drawerOpen && !drawerMinimized;

  return (
    <main className="min-h-screen">
      <div
        className={`max-w-[1400px] mx-auto px-6 py-6 space-y-6 transition-[padding] duration-300 ease-out ${
          drawerActive ? "lg:pr-[540px]" : "pr-0"
        }`}
      >
        {/* 1. Котировки — главный визуальный фокус, якорь интерфейса */}
        <RatesBar />

        {/* 2. Балансы — вторичный блок. В режиме create чуть сжимаем spacing. */}
        <Balances
          currentOffice={currentOffice}
          scope={balanceScope}
          onScopeChange={setBalanceScope}
        />

        {/* CTA — большая кнопка "+ New exchange". Видна только в view mode.
            В create mode её заменяет drawer (плюс minimize-chip если свернут). */}
        {!drawerOpen && (
          <section>
            <button
              onClick={openDrawer}
              className="group w-full flex items-center justify-between gap-4 px-6 py-5 rounded-[16px] bg-slate-900 text-white shadow-[0_10px_32px_-12px_rgba(15,23,42,0.5)] hover:shadow-[0_16px_40px_-12px_rgba(15,23,42,0.6)] hover:bg-slate-800 active:scale-[0.995] transition-all duration-200"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_4px_14px_-2px_rgba(16,185,129,0.5)] group-hover:bg-emerald-400 transition-colors">
                  <Plus className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <div className="text-left">
                  <div className="text-[16px] font-bold tracking-tight">
                    New exchange
                  </div>
                  <div className="text-[12px] text-slate-300">
                    Open the deal form — rates stay visible
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                  Press
                  <kbd className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-200 tracking-wider">
                    N
                  </kbd>
                </span>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </div>
            </button>
          </section>
        )}

        {/* 3. Транзакции — третичный блок. Занимают всю ширину в view mode
               и сжимаются автоматически благодаря padding-right на контейнере. */}
        <TransactionsTable
          currentOffice={currentOffice}
          justCreatedId={justCreatedId}
          onEdit={setEditingTx}
        />
      </div>

      {/* Drawer (справа) — форма сделки. Remount=false: при minimize остаётся
          в DOM, ExchangeForm внутри сохраняет state. */}
      <ExchangeDrawer
        open={drawerOpen}
        minimized={drawerMinimized}
        currentOffice={currentOffice}
        onSubmit={async (tx) => {
          const r = await handleCreate(tx);
          // Закрываем drawer только при успехе — при ошибке форма остаётся
          // открытой, пользователь может исправить ввод и повторить.
          if (r?.ok) closeDrawer();
        }}
        onMinimize={minimizeDrawer}
        onRestore={restoreDrawer}
        onClose={closeDrawer}
        submitting={submitting}
      />

      <EditTransactionModal transaction={editingTx} onClose={() => setEditingTx(null)} />
    </main>
  );
}
