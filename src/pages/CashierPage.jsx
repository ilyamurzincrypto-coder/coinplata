// src/pages/CashierPage.jsx
import React, { useState } from "react";
import Balances from "../components/Balances.jsx";
import RatesBar from "../components/RatesBar.jsx";
import ExchangeForm from "../components/ExchangeForm.jsx";
import TransactionsTable from "../components/TransactionsTable.jsx";
import EditTransactionModal from "../components/EditTransactionModal.jsx";
import { useTransactions } from "../store/transactions.jsx";

export default function CashierPage({ currentOffice }) {
  const [balanceScope, setBalanceScope] = useState("selected");
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [editingTx, setEditingTx] = useState(null);

  const { addTransaction } = useTransactions();

  const handleCreate = (tx) => {
    addTransaction(tx);
    setJustCreatedId(tx.id);
    setTimeout(() => setJustCreatedId(null), 2500);
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
