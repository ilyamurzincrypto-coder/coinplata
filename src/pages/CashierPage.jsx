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
import { fmt } from "../utils/money.js";
import { buildMovementsFromTransaction } from "../utils/exchangeMovements.js";

export default function CashierPage({ currentOffice }) {
  const [balanceScope, setBalanceScope] = useState("selected");
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [editingTx, setEditingTx] = useState(null);

  const { addTransaction } = useTransactions();
  const { addEntry: logAudit } = useAudit();
  const { accounts, addMovement, removeMovementsByRefId } = useAccounts();
  const { currentUser } = useAuth();

  const handleCreate = (tx) => {
    addTransaction(tx);
    setJustCreatedId(tx.id);
    setTimeout(() => setJustCreatedId(null), 2500);

    // Защита от дублей: если вдруг создание сработало дважды с одним tx.id,
    // старые movements этой tx снесутся перед записью новых.
    removeMovementsByRefId(tx.id);

    // Записываем движения по счетам (exchange_in + exchange_out[])
    // TODO: в форме нет явного выбора from-account на каждый output.
    // Временная стратегия: первый активный account офиса в валюте output.
    const { movements, warnings } = buildMovementsFromTransaction(
      tx,
      accounts,
      currentUser.id
    );
    movements.forEach(addMovement);

    // Audit log сделки
    const outStr = (tx.outputs || [{ currency: tx.curOut, amount: tx.amtOut }])
      .map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`)
      .join(" + ");
    const warnSuffix = warnings.length > 0 ? ` · ⚠ ${warnings.length} missing account(s)` : "";
    logAudit({
      action: "create",
      entity: "transaction",
      entityId: String(tx.id),
      summary: `${fmt(tx.amtIn, tx.curIn)} ${tx.curIn} → ${outStr} · fee $${fmt(tx.fee)}${warnSuffix}`,
    });
  };

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      <RatesBar />
      <Balances currentOffice={currentOffice} scope={balanceScope} onScopeChange={setBalanceScope} />

      <div className="grid grid-cols-1 xl:grid-cols-[440px_1fr] gap-6 items-start">
        <section className="xl:sticky xl:top-[140px]">
          <ExchangeForm mode="create" currentOffice={currentOffice} onSubmit={handleCreate} />
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
