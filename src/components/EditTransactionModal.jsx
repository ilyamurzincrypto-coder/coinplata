// src/components/EditTransactionModal.jsx
// Модалка редактирования транзакции. Использует тот же ExchangeForm с mode="edit".
// При сохранении пересоздаём movements: сносим все по refId=tx.id и пишем новые.
// Это упрощённая схема "rewrite" вместо полноценных compensating entries.

import React from "react";
import Modal from "./ui/Modal.jsx";
import ExchangeForm from "./ExchangeForm.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useAudit } from "../store/audit.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { officeName } from "../store/data.js";
import { fmt } from "../utils/money.js";
import { buildMovementsFromTransaction } from "../utils/exchangeMovements.js";

export default function EditTransactionModal({ transaction, onClose }) {
  const { t } = useTranslation();
  const { updateTransaction } = useTransactions();
  const { addEntry: logAudit } = useAudit();
  const { accounts, addMovement, removeMovementsByRefId } = useAccounts();
  const { currentUser } = useAuth();

  if (!transaction) return null;

  const handleSubmit = (updated) => {
    updateTransaction(transaction.id, updated);

    const prevStatus = transaction.status || "completed";
    const nextStatus = updated.status || "completed";

    // Простая стратегия: всегда rewrite movements (снести и записать заново).
    // buildMovementsFromTransaction учтёт tx.status и поставит reserved:true если pending.
    // Это проще чем тонкий diff и покрывает все случаи (смена currency, amount, account).
    removeMovementsByRefId(transaction.id);
    const { movements } = buildMovementsFromTransaction(
      { ...updated, id: transaction.id },
      accounts,
      currentUser.id
    );
    movements.forEach(addMovement);

    const changes = [];
    if (transaction.amtIn !== updated.amtIn) {
      changes.push(`in ${fmt(transaction.amtIn, transaction.curIn)} → ${fmt(updated.amtIn, updated.curIn)}`);
    }
    if (transaction.fee !== updated.fee) {
      changes.push(`fee $${fmt(transaction.fee)} → $${fmt(updated.fee)}`);
    }
    if (transaction.profit !== updated.profit) {
      changes.push(`profit $${fmt(transaction.profit)} → $${fmt(updated.profit)}`);
    }
    if (prevStatus !== nextStatus) {
      changes.push(`status: ${prevStatus} → ${nextStatus}`);
    }
    const summary = changes.length
      ? `${changes.join(", ")} · movements rewritten (${nextStatus === "pending" ? "reserved" : "completed"})`
      : `Transaction ${transaction.id} edited`;

    logAudit({
      action: "update",
      entity: "transaction",
      entityId: String(transaction.id),
      summary,
    });

    onClose?.();
  };

  return (
    <Modal
      open={!!transaction}
      onClose={onClose}
      title={t("edit_exchange")}
      subtitle={`${officeName(transaction.officeId)} · ${transaction.time}, ${transaction.date} · ${transaction.manager}`}
      width="xl"
    >
      <ExchangeForm
        mode="edit"
        currentOffice={transaction.officeId}
        initialData={transaction}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
