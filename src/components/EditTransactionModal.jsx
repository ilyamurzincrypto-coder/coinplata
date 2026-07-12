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
import { buildMovementsFromTransaction, commitMovements } from "../utils/exchangeMovements.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcSetDealCreatedAt, withToast, uuidOrNull, ensureClient } from "../lib/supabaseWrite.js";
import { updateDeal } from "../lib/dealOperations.js";
import { USE_NEW_LEDGER } from "../lib/newLedger.js";

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
            updateDeal({
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
          // Backdate (опц.) — юзер выставил «задним числом». В CashierPage
          // для НОВОЙ сделки это уже работает; для edit — раньше не дёргали
          // rpcSetDealCreatedAt, и backdate терялся.
          if (updated.backdateAt) {
            // Backdate: показываем toast при ошибке (раньше было silent
            // console.warn — юзер не понимал почему дата не меняется).
            await withToast(
              () =>
                rpcSetDealCreatedAt({
                  dealId: transaction.id,
                  createdAt: updated.backdateAt,
                }),
              {
                success: "Backdate applied",
                errorPrefix: "Backdate failed",
              }
            );
          }
          logAudit({
            action: "update",
            entity: "transaction",
            entityId: String(transaction.id),
            summary: `Edited #${transaction.id} · status ${prevStatus} → ${nextStatus}${updated.backdateAt ? " · backdated" : ""}`,
          });
          onClose?.();
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Строим НОВЫЕ движения ДО изменения tx и удаления старых — если набор
    // односторонний (нет IN / брошен OUT), отклоняем правку: старое состояние
    // не трогаем (B5: не оставляем tx без движений).
    const built = buildMovementsFromTransaction(
      { ...updated, id: transaction.id },
      accounts,
      currentUser.id
    );
    if (built.fatal) {
      // eslint-disable-next-line no-console
      console.warn("[edit] отклонена — несбалансированный набор:", built.warnings);
      return;
    }
    updateTransaction(transaction.id, updated);
    removeMovementsByRefId(transaction.id);
    commitMovements(built, addMovement);

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
      {USE_NEW_LEDGER && (
        <div className="mx-5 mt-4 px-3.5 py-2.5 rounded-card bg-warning-soft border border-warning/20 text-caption text-warning">
          <span className="font-semibold">Edit отключён в режиме v2 ledger.</span>{" "}
          v2 updateDeal ещё не реализован. Чтобы отредактировать сделку, попроси
          админа выключить <code className="px-1 bg-amber-100 rounded">VITE_USE_NEW_LEDGER</code>,
          либо дождись v2-обёртки.
        </div>
      )}
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
