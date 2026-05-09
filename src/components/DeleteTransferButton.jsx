// src/components/DeleteTransferButton.jsx
//
// Кнопка удаления перемещения с 2-tap confirm.
// Балансы счетов откатываются (delete_transfer RPC, 0093).
// Доступ: только admin / owner.

import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { useAuth } from "../store/auth.jsx";
import { withToast } from "../lib/supabaseWrite.js";
import { deleteTransfer } from "../lib/dealOperations.js";
import { USE_NEW_LEDGER } from "../lib/newLedger.js";

export default function DeleteTransferButton({ transferId, onDeleted }) {
  const { currentUser } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!currentUser || !["admin", "owner"].includes(currentUser.role)) {
    return null;
  }

  const handleClick = async (e) => {
    e.stopPropagation();
    if (busy) return;
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 3000);
      return;
    }
    setBusy(true);
    try {
      const res = await withToast(
        () => deleteTransfer(transferId),
        { success: "Перемещение удалено · балансы откатаны", errorPrefix: "Delete failed" }
      );
      if (res.ok) {
        onDeleted?.(transferId);
      }
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || USE_NEW_LEDGER}
      onBlur={() => setConfirm(false)}
      title={
        USE_NEW_LEDGER
          ? "Удаление отключено в режиме v2 ledger — wait for v2 deleteTransfer support"
          : confirm
          ? "Подтвердить удаление"
          : "Удалить перемещение (откатит балансы)"
      }
      className={`p-1 rounded transition-colors ${
        confirm
          ? "bg-rose-500 text-white hover:bg-rose-600"
          : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"
      } ${busy ? "opacity-60 cursor-wait" : ""}`}
    >
      <Trash2 className="w-3 h-3" />
    </button>
  );
}
