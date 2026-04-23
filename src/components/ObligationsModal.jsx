// src/components/ObligationsModal.jsx
// Список открытых obligations с actions: Settle (создаёт OUT movement, закрывает
// obligation, при закрытии последней obligation по сделке — переводит её в completed)
// и Cancel.

import React, { useState, useMemo } from "react";
import {
  X,
  Lock,
  Check,
  Building2,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useObligations } from "../store/obligations.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { fmt, curSymbol } from "../utils/money.js";

export default function ObligationsModal({ open, onClose }) {
  const { obligations, closeObligation, cancelObligation } = useObligations();
  const { accounts, balanceOf, reservedOf, addMovement } = useAccounts();
  const { transactions, updateTransaction, updateOutput } = useTransactions();
  const { findOffice } = useOffices();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();

  const [settleTarget, setSettleTarget] = useState(null); // obligation

  const openObligations = useMemo(
    () => obligations.filter((o) => o.status === "open"),
    [obligations]
  );

  const totalsByCurrency = useMemo(() => {
    const m = new Map();
    openObligations.forEach((o) => {
      m.set(o.currency, (m.get(o.currency) || 0) + o.amount);
    });
    return m;
  }, [openObligations]);

  const handleSettle = (obligation, accountId) => {
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return { ok: false, warning: "Account not found" };
    const available = balanceOf(accountId) - reservedOf(accountId);
    if (available < obligation.amount) {
      return {
        ok: false,
        warning: `Insufficient balance: ${fmt(available, acc.currency)} ${acc.currency} available, ${fmt(obligation.amount, acc.currency)} needed`,
      };
    }

    // 1. Создаём OUT movement (тот, что был пропущен при создании сделки).
    addMovement({
      accountId,
      amount: obligation.amount,
      direction: "out",
      currency: obligation.currency,
      reserved: false,
      source: {
        kind: "exchange_out",
        refId: String(obligation.dealId),
        outputIndex: obligation.dealLegIndex ?? null,
        note: `Settled obligation ${obligation.id}`,
      },
      createdBy: currentUser.id,
    });

    // 2. Закрываем obligation.
    closeObligation(obligation.id, currentUser.id);

    // 3. Помечаем конкретный leg как completed (actual = planned, completedAt = now).
    const nowIso = new Date().toISOString();
    if (obligation.dealId && Number.isFinite(obligation.dealLegIndex)) {
      updateOutput(obligation.dealId, obligation.dealLegIndex, {
        actualAmount: obligation.amount,
        completedAt: nowIso,
      });
    }

    // 4. Если у сделки больше нет open obligations → переводим её в completed
    //    и закрываем все остальные legs + IN (если они ещё pending).
    if (obligation.dealId) {
      const stillOpen = obligations.some(
        (o) =>
          o.dealId === obligation.dealId &&
          o.id !== obligation.id &&
          o.status === "open"
      );
      if (!stillOpen) {
        const deal = transactions.find((t) => t.id === obligation.dealId);
        const patch = { status: "completed", confirmedAt: nowIso };
        if (deal) {
          // IN side — если ещё не закрыт (deal был pending, IN мог ждать)
          if (!deal.inCompletedAt) {
            patch.inActualAmount = deal.amtIn || 0;
            patch.inCompletedAt = nowIso;
          }
          // Остальные OUT legs — закрыть все что ещё не закрыты (не только этот)
          const updatedOuts = (deal.outputs || []).map((l, idx) => {
            if (l.completedAt) return l;
            return {
              ...l,
              actualAmount: l.plannedAmount ?? l.amount ?? 0,
              completedAt: nowIso,
            };
          });
          patch.outputs = updatedOuts;
        }
        updateTransaction(obligation.dealId, patch);
      }
    }

    logAudit({
      action: "settle",
      entity: "obligation",
      entityId: obligation.id,
      summary: `Settled ${fmt(obligation.amount, obligation.currency)} ${obligation.currency} from ${acc.name} · deal #${obligation.dealId}`,
    });
    return { ok: true };
  };

  const handleCancel = (obligation) => {
    if (!confirm(`Cancel obligation for ${fmt(obligation.amount, obligation.currency)} ${obligation.currency}? Deal will remain pending.`))
      return;
    cancelObligation(obligation.id, currentUser.id);
    logAudit({
      action: "cancel",
      entity: "obligation",
      entityId: obligation.id,
      summary: `Cancelled obligation · ${fmt(obligation.amount, obligation.currency)} ${obligation.currency} · deal #${obligation.dealId}`,
    });
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Open obligations" subtitle={`${openObligations.length} open`} width="2xl">
        <div className="p-5 max-h-[70vh] overflow-auto space-y-4">
          {openObligations.length === 0 ? (
            <div className="text-center py-10 text-[13px] text-slate-500">
              No open obligations — all commitments are settled.
            </div>
          ) : (
            <>
              {/* Summary по валютам */}
              <div className="flex flex-wrap gap-2">
                {[...totalsByCurrency.entries()].map(([cur, amt]) => (
                  <div
                    key={cur}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-amber-50 border border-amber-200 text-[12px]"
                  >
                    <Lock className="w-3 h-3 text-amber-700" />
                    <span className="font-bold text-amber-900 tabular-nums">
                      {curSymbol(cur)}{fmt(amt, cur)}
                    </span>
                    <span className="font-semibold text-amber-700">{cur}</span>
                  </div>
                ))}
              </div>

              {/* Список */}
              <div className="border border-slate-200 rounded-[10px] overflow-hidden divide-y divide-slate-100">
                {openObligations.map((o) => (
                  <ObligationRow
                    key={o.id}
                    obligation={o}
                    office={findOffice(o.officeId)}
                    deal={transactions.find((t) => t.id === o.dealId)}
                    accounts={accounts.filter(
                      (a) =>
                        a.active &&
                        a.officeId === o.officeId &&
                        a.currency === o.currency
                    )}
                    balanceOf={balanceOf}
                    reservedOf={reservedOf}
                    onSettle={() => setSettleTarget(o)}
                    onCancel={() => handleCancel(o)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Close
          </button>
        </div>
      </Modal>

      <SettleModal
        obligation={settleTarget}
        onClose={() => setSettleTarget(null)}
        onSettle={handleSettle}
      />
    </>
  );
}

function ObligationRow({ obligation: o, office, deal, accounts, balanceOf, reservedOf, onSettle, onCancel }) {
  // Лучший аккаунт для settle — с максимальным available в том же office+currency.
  const bestAccount = useMemo(() => {
    let best = null;
    let bestAvail = -Infinity;
    accounts.forEach((a) => {
      const avail = balanceOf(a.id) - reservedOf(a.id);
      if (avail > bestAvail) {
        bestAvail = avail;
        best = a;
      }
    });
    return { account: best, available: bestAvail };
  }, [accounts, balanceOf, reservedOf]);

  const canSettle = bestAccount.available >= o.amount;

  return (
    <div className="px-4 py-3 hover:bg-slate-50 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
          <span className="tabular-nums">
            {curSymbol(o.currency)}{fmt(o.amount, o.currency)}
          </span>
          <span className="text-slate-500 font-normal">{o.currency}</span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
            <Building2 className="w-2.5 h-2.5 text-slate-400" />
            {office?.name || o.officeId}
          </span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>Deal #{o.dealId}</span>
          {deal?.counterparty && (
            <>
              <span className="text-slate-300">·</span>
              <span>client {deal.counterparty}</span>
            </>
          )}
          {o.note && (
            <>
              <span className="text-slate-300">·</span>
              <span className="italic">{o.note}</span>
            </>
          )}
        </div>
        {!canSettle && (
          <div className="mt-1 text-[10px] text-amber-700 inline-flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            Need {fmt(o.amount - Math.max(0, bestAccount.available), o.currency)} more on {bestAccount.account?.name || "any account"} to settle
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onSettle}
          disabled={!canSettle}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold transition-colors ${
            canSettle
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-100 text-slate-400 cursor-not-allowed"
          }`}
          title={canSettle ? "Create OUT movement, close obligation" : "Not enough balance yet"}
        >
          <Check className="w-3 h-3" />
          Settle
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
          title="Cancel obligation (deal stays pending)"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function SettleModal({ obligation, onClose, onSettle }) {
  const { accounts, balanceOf, reservedOf } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");

  const candidates = useMemo(() => {
    if (!obligation) return [];
    return accounts
      .filter(
        (a) =>
          a.active &&
          a.officeId === obligation.officeId &&
          a.currency === obligation.currency
      )
      .map((a) => ({
        ...a,
        available: balanceOf(a.id) - reservedOf(a.id),
      }))
      .sort((a, b) => b.available - a.available);
  }, [obligation, accounts, balanceOf, reservedOf]);

  React.useEffect(() => {
    if (obligation) {
      setAccountId(candidates[0]?.id || "");
      setError("");
    }
  }, [obligation, candidates]);

  if (!obligation) return null;
  const selected = candidates.find((c) => c.id === accountId);
  const canSubmit = selected && selected.available >= obligation.amount;

  const handleSubmit = () => {
    setError("");
    const res = onSettle(obligation, accountId);
    if (!res.ok) {
      setError(res.warning || "Could not settle");
      return;
    }
    onClose();
  };

  return (
    <Modal open={!!obligation} onClose={onClose} title="Settle obligation" width="md">
      <div className="p-5 space-y-3">
        <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 text-[12px]">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            To settle
          </div>
          <div className="text-[16px] font-bold tabular-nums text-slate-900">
            {curSymbol(obligation.currency)}{fmt(obligation.amount, obligation.currency)}{" "}
            <span className="text-[12px] text-slate-500 font-medium">{obligation.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Deal #{obligation.dealId} · leg {(obligation.dealLegIndex ?? 0) + 1}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Pay from account
          </label>
          {candidates.length === 0 ? (
            <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              No accounts with {obligation.currency} in this office. Top up or transfer first.
            </div>
          ) : (
            <div className="space-y-1">
              {candidates.map((c) => {
                const ok = c.available >= obligation.amount;
                const active = accountId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAccountId(c.id)}
                    disabled={!ok}
                    className={`w-full text-left px-3 py-2 rounded-[10px] border flex items-center justify-between transition-colors ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : ok
                        ? "border-slate-200 hover:border-slate-300"
                        : "border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-[13px] font-semibold">{c.name}</span>
                    <span className="text-[11px] tabular-nums">
                      {curSymbol(obligation.currency)}{fmt(c.available, obligation.currency)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="text-[12px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Settling will create an OUT movement on the selected account and close this obligation. If it was the last open obligation on the deal, the deal moves to <span className="font-semibold">Completed</span>.
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors inline-flex items-center gap-1.5 ${
            canSubmit
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          <ArrowRight className="w-3 h-3" />
          Settle
        </button>
      </div>
    </Modal>
  );
}
