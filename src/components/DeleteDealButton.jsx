// src/components/DeleteDealButton.jsx
//
// Маленькая кнопка удаления сделки с 2-tap confirm. Используется в:
//   - PartnerDealsSection (Counterparties → партнёр → раскрытие)
//   - AccountHistoryModal (Сделки на этом счёте)
//   - PartnerAccountHistoryModal (Связанные сделки)
//
// Доступ: только admin/owner (rpcDeleteDeal SQL-side проверка).
// Скрыта для других ролей.

import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { useAuth } from "../store/auth.jsx";
import { withToast } from "../lib/supabaseWrite.js";
import { deleteDeal } from "../lib/dealOperations.js";
import { USE_NEW_LEDGER } from "../lib/newLedger.js";

export default function DeleteDealButton({ dealId, onDeleted, size = "sm" }) {
  const { currentUser } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Только admin/owner. У остальных даже кнопки нет.
  if (!currentUser || !["admin", "owner"].includes(currentUser.role)) {
    return null;
  }

  const handleClick = async (e) => {
    e.stopPropagation();
    if (busy) return;
    if (!confirm) {
      setConfirm(true);
      // авто-сброс через 3 секунды
      setTimeout(() => setConfirm(false), 3000);
      return;
    }
    setBusy(true);
    try {
      const res = await withToast(
        () => deleteDeal(dealId, "manual"),
        { success: `Сделка #${dealId} удалена`, errorPrefix: "Delete failed" }
      );
      if (res.ok) {
        onDeleted?.(dealId);
      }
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const sz = size === "lg" ? "w-4 h-4" : "w-3 h-3";
  const padCls = size === "lg" ? "p-1.5" : "p-1";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || USE_NEW_LEDGER}
      onBlur={() => setConfirm(false)}
      title={
        USE_NEW_LEDGER
          ? "Удаление отключено в режиме v2 ledger — wait for v2 deleteDeal support"
          : confirm
          ? "Подтвердить удаление"
          : "Удалить сделку (откатит баланс)"
      }
      className={`${padCls} rounded transition-colors ${
        confirm
          ? "bg-danger-soft0 text-white hover:bg-rose-600"
          : "text-muted-soft hover:text-danger hover:bg-danger-soft"
      } ${busy ? "opacity-60 cursor-wait" : ""}`}
    >
      <Trash2 className={sz} />
    </button>
  );
}
