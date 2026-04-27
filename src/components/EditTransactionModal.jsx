// src/components/EditTransactionModal.jsx
// Модалка редактирования транзакции. Использует тот же ExchangeForm с mode="edit".
// При сохранении пересоздаём movements: сносим все по refId=tx.id и пишем новые.
// Это упрощённая схема "rewrite" вместо полноценных compensating entries.

import React, { useState } from "react";
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
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcUpdateDeal, withToast, uuidOrNull, ensureClient } from "../lib/supabaseWrite.js";

export default function EditTransactionModal({ transaction, onClose }) {
  const { t } = useTranslation();
  const { updateTransaction, counterparties } = useTransactions();
  const { addEntry: logAudit } = useAudit();
  const { accounts, addMovement, removeMovementsByRefId } = useAccounts();
  const { currentUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  if (!transaction) return null;

  const handleSubmit = async (updated) => {
    if (submitting) return;
    const prevStatus = transaction.status || "completed";
    const nextStatus = updated.status || "completed";

    if (isSupabaseConfigured) {
      setSubmitting(true);
      try {
        const resolvedClientId = await ensureClient(
          {
            nickname: updated.counterparty,
            telegram: updated.counterpartyTelegram,
            counterpartyId: updated.counterpartyId,
          },
          counterparties
        );

        const res = await withToast(
          () =>
            rpcUpdateDeal({
              dealId: transaction.id,
              officeId: uuidOrNull(updated.officeId),
              clientId: resolvedClientId,
              clientNickname: updated.counterparty || null,
              currencyIn: updated.curIn,
              amountIn: updated.amtIn,
              inAccountId: uuidOrNull(updated.accountId),
              inTxHash: updated.inTxHash || null,
              referral: !!updated.referral,
              comment: updated.comment || "",
              status: nextStatus,
              outputs: (updated.outputs || []).map((o) => ({
                ...o,
                accountId: uuidOrNull(o.accountId),
              })),
              // preserve pending fields — без этого 0003-версия сносила их в defaults
              plannedAt: updated.plannedAt || null,
              deferredIn: !!updated.deferredIn,
              applyMinFee: updated.applyMinFee !== false,
            }),
          { success: "Deal updated", errorPrefix: "Update failed" }
        );
        if (res.ok) {
          logAudit({
            action: "update",
            entity: "transaction",
            entityId: String(transaction.id),
            summary: `Edited #${transaction.id} · status ${prevStatus} → ${nextStatus}`,
          });
          onClose?.();
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    updateTransaction(transaction.id, updated);
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
        submitting={submitting}
      />
    </Modal>
  );
}
