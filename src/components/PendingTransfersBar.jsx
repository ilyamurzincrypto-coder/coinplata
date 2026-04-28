// src/components/PendingTransfersBar.jsx
// P2P pending transfers (миграция 0052) — UI для confirm/reject/cancel.
// Показывается над TransactionsTable если у current user есть incoming
// (to_manager_id=me) или outgoing (created_by=me) pending transfers.
//
// Receiver: Confirm (создаёт IN movement, status=confirmed) / Reject.
// Sender: Cancel (удаляет OUT, status=cancelled).

import React, { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  XCircle,
  Ban,
  Clock,
  Building2,
} from "lucide-react";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  rpcConfirmTransfer,
  rpcRejectTransfer,
  rpcCancelTransfer,
  withToast,
} from "../lib/supabaseWrite.js";

export default function PendingTransfersBar() {
  const { transfers, accounts } = useAccounts();
  const { currentUser, users } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const [busyId, setBusyId] = useState(null);

  const me = currentUser?.id;

  // Pending transfers где я — получатель или отправитель.
  const myPending = useMemo(() => {
    if (!Array.isArray(transfers) || !me) return [];
    return transfers
      .filter((t) => t.status === "pending")
      .filter((t) => t.toManagerId === me || t.createdBy === me);
  }, [transfers, me]);

  if (myPending.length === 0) return null;

  const accById = (id) => accounts.find((a) => a.id === id);
  const userById = (id) => (users || []).find((u) => u.id === id);

  const run = async (kind, tr) => {
    if (!isSupabaseConfigured || busyId) return;
    setBusyId(tr.id);
    try {
      const note =
        kind === "reject" || kind === "cancel"
          ? prompt("Причина (опционально):")
          : prompt("Заметка (опционально):");
      if (note === null) return; // user cancelled prompt
      const fn =
        kind === "confirm"
          ? rpcConfirmTransfer
          : kind === "reject"
          ? rpcRejectTransfer
          : rpcCancelTransfer;
      const labels = {
        confirm: "Перевод подтверждён",
        reject: "Перевод отклонён",
        cancel: "Перевод отменён",
      };
      const res = await withToast(
        () => fn({ transferId: tr.id, note }),
        { success: labels[kind], errorPrefix: "Ошибка" }
      );
      if (res.ok) {
        logAudit({
          action: kind,
          entity: "transfer",
          entityId: tr.id,
          summary: `Transfer ${kind} · ${fmt(tr.fromAmount)} ${accById(tr.fromAccountId)?.currency || ""}`,
        });
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-4 bg-amber-50/40 border border-amber-200 rounded-[14px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-amber-200 bg-amber-100/40 flex items-center gap-2">
        <Clock className="w-4 h-4 text-amber-700" />
        <span className="text-[13px] font-bold text-amber-900">
          Pending переводы
        </span>
        <span className="text-[10px] text-amber-700/70 uppercase tracking-wider">
          {myPending.length} · ожидают подтверждения
        </span>
      </div>
      <div className="divide-y divide-amber-100 bg-white">
        {myPending.map((tr) => {
          const isIncoming = tr.toManagerId === me;
          const fromAcc = accById(tr.fromAccountId);
          const toAcc = accById(tr.toAccountId);
          const sender = userById(tr.createdBy);
          const fromCur = fromAcc?.currency || "—";
          const toCur = toAcc?.currency || "—";
          return (
            <div key={tr.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="shrink-0">
                {isIncoming ? (
                  <ArrowDownToLine className="w-4 h-4 text-emerald-600" />
                ) : (
                  <ArrowUpFromLine className="w-4 h-4 text-slate-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-slate-900 inline-flex items-center gap-2 flex-wrap">
                  <span className="tabular-nums">
                    {curSymbol(fromCur)}
                    {fmt(tr.fromAmount, fromCur)} {fromCur}
                  </span>
                  {fromCur !== toCur && (
                    <>
                      <span className="text-slate-400">→</span>
                      <span className="tabular-nums">
                        {curSymbol(toCur)}
                        {fmt(tr.toAmount, toCur)} {toCur}
                      </span>
                      {tr.rate && (
                        <span className="text-[10px] text-slate-500">
                          @ {tr.rate}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 inline-flex items-center gap-1.5 flex-wrap">
                  <Building2 className="w-3 h-3" />
                  <span>
                    {fromAcc ? officeName(fromAcc.officeId) : "—"} →{" "}
                    {toAcc ? officeName(toAcc.officeId) : "—"}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>
                    {isIncoming
                      ? `от ${sender?.name || "коллеги"}`
                      : "вы отправитель"}
                  </span>
                  {tr.note && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="italic truncate">{tr.note}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isIncoming ? (
                  <>
                    <button
                      onClick={() => run("confirm", tr)}
                      disabled={busyId === tr.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Подтвердить
                    </button>
                    <button
                      onClick={() => run("reject", tr)}
                      disabled={busyId === tr.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-60 transition-colors"
                    >
                      <XCircle className="w-3 h-3" />
                      Отклонить
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => run("cancel", tr)}
                    disabled={busyId === tr.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-60 transition-colors"
                  >
                    <Ban className="w-3 h-3" />
                    Отменить
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
