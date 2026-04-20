// src/components/EditTransactionModal.jsx
// Модалка редактирования транзакции. Использует тот же ExchangeForm с mode="edit".

import React from "react";
import Modal from "./ui/Modal.jsx";
import ExchangeForm from "./ExchangeForm.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { officeName } from "../store/data.js";

export default function EditTransactionModal({ transaction, onClose }) {
  const { t } = useTranslation();
  const { updateTransaction } = useTransactions();

  if (!transaction) return null;

  const handleSubmit = (updated) => {
    // ExchangeForm в режиме edit возвращает полный объект транзакции
    updateTransaction(transaction.id, updated);
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
