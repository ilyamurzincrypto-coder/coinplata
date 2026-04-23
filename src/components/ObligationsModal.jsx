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
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  rpcSettleObligation,
  rpcSettleObligationPartial,
  rpcReceivePayment,
  rpcCancelObligation,
  withToast,
} from "../lib/supabaseWrite.js";

export default function ObligationsModal({ open, onClose }) {
  const { obligations, closeObligation, cancelObligation } = useObligations();
  const { accounts, balanceOf, reservedOf, addMovement } = useAccounts();
  const { transactions, updateTransaction, updateOutput } = useTransactions();
  const { findOffice } = useOffices();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();

  const [settleTarget, setSettleTarget] = useState(null);   // we_owe → Settle
  const [receiveTarget, setReceiveTarget] = useState(null); // they_owe → Receive

  const openObligations = useMemo(
    () => obligations.filter((o) => o.status === "open"),
    [obligations]
  );

  const weOwe = useMemo(
    () => openObligations.filter((o) => o.direction === "we_owe"),
    [openObligations]
  );
  const theyOwe = useMemo(
    () => openObligations.filter((o) => o.direction === "they_owe"),
    [openObligations]
  );

  const totalsByCurrency = useMemo(() => {
    const m = new Map();
    openObligations.forEach((o) => {
      const remaining = Math.max(0, o.amount - (o.paidAmount || 0));
      m.set(o.currency, (m.get(o.currency) || 0) + remaining);
    });
    return m;
  }, [openObligations]);

  // Settle we_owe — теперь partial. amount default = remaining (amount - paid).
  // Юзер может снизить значение.
  const handleSettle = async (obligation, accountId, amount) => {
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return { ok: false, warning: "Account not found" };
    const remaining = Math.max(0, obligation.amount - (obligation.paidAmount || 0));
    const payAmount = Number(amount) || remaining;
    if (payAmount <= 0 || payAmount > remaining) {
      return {
        ok: false,
        warning: `Amount must be between 0 and ${fmt(remaining, obligation.currency)}`,
      };
    }
    const available = balanceOf(accountId) - reservedOf(accountId);
    if (available < payAmount) {
      return {
        ok: false,
        warning: `Insufficient balance: ${fmt(available, acc.currency)} ${acc.currency} available, ${fmt(payAmount, acc.currency)} needed`,
      };
    }

    if (isSupabaseConfigured) {
      const res = await withToast(
        () => rpcSettleObligationPartial(obligation.id, accountId, payAmount),
        { success: "Obligation settled", errorPrefix: "Settle failed" }
      );
      if (!res.ok) return { ok: false, warning: res.error };
      const isFull = payAmount >= remaining;
      logAudit({
        action: "settle",
        entity: "obligation",
        entityId: obligation.id,
        summary: `${isFull ? "Full" : "Partial"} settle ${fmt(payAmount, obligation.currency)} ${obligation.currency} from ${acc.name} · deal #${obligation.dealId}`,
      });
      return { ok: true };
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

  // Receive payment from client for a they_owe obligation.
  const handleReceive = async (obligation, accountId, amount) => {
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return { ok: false, warning: "Account not found" };
    if (acc.currency !== obligation.currency) {
      return {
        ok: false,
        warning: `Account currency ${acc.currency} does not match obligation ${obligation.currency}`,
      };
    }
    const remaining = Math.max(0, obligation.amount - (obligation.paidAmount || 0));
    const payAmount = Number(amount) || remaining;
    if (payAmount <= 0 || payAmount > remaining) {
      return {
        ok: false,
        warning: `Amount must be between 0 and ${fmt(remaining, obligation.currency)}`,
      };
    }
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => rpcReceivePayment(obligation.id, accountId, payAmount),
        { success: "Payment received", errorPrefix: "Receive failed" }
      );
      if (!res.ok) return { ok: false, warning: res.error };
      const isFull = payAmount >= remaining;
      logAudit({
        action: "receive",
        entity: "obligation",
        entityId: obligation.id,
        summary: `${isFull ? "Full" : "Partial"} receive ${fmt(payAmount, obligation.currency)} ${obligation.currency} → ${acc.name} · deal #${obligation.dealId}`,
      });
      return { ok: true };
    }
    return { ok: false, warning: "Demo mode: they_owe flow requires Supabase" };
  };

  const handleCancel = async (obligation) => {
    if (!confirm(`Cancel obligation for ${fmt(obligation.amount, obligation.currency)} ${obligation.currency}? Deal will remain pending.`))
      return;
    if (isSupabaseConfigured) {
      await withToast(
        () => rpcCancelObligation(obligation.id),
        { success: "Obligation cancelled", errorPrefix: "Cancel failed" }
      );
      logAudit({
        action: "cancel",
        entity: "obligation",
        entityId: obligation.id,
        summary: `Cancelled obligation · ${fmt(obligation.amount, obligation.currency)} ${obligation.currency} · deal #${obligation.dealId}`,
      });
      return;
    }
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
                    onSettle={() =>
                      o.direction === "they_owe"
                        ? setReceiveTarget(o)
                        : setSettleTarget(o)
                    }
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
        mode="settle"
      />
      <SettleModal
        obligation={receiveTarget}
        onClose={() => setReceiveTarget(null)}
        onSettle={handleReceive}
        mode="receive"
      />
    </>
  );
}

function ObligationRow({ obligation: o, office, deal, accounts, balanceOf, reservedOf, onSettle, onCancel }) {
  const isTheyOwe = o.direction === "they_owe";
  const remaining = Math.max(0, o.amount - (o.paidAmount || 0));
  const paidPct = o.amount > 0 ? Math.min(100, ((o.paidAmount || 0) / o.amount) * 100) : 0;

  // Best account: для we_owe — с max available; для they_owe — первый подходящий.
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

  // they_owe не требует баланса на счёте — клиент приносит деньги нам.
  const canSettle = isTheyOwe || bestAccount.available >= remaining;

  return (
    <div className="px-4 py-3 hover:bg-slate-50 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
              isTheyOwe
                ? "bg-sky-100 text-sky-700"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {isTheyOwe ? "They owe" : "We owe"}
          </span>
          <span className="tabular-nums">
            {curSymbol(o.currency)}{fmt(remaining, o.currency)}
          </span>
          {(o.paidAmount || 0) > 0 && (
            <span className="text-[10px] font-semibold text-slate-400 tabular-nums">
              / {fmt(o.amount, o.currency)}
            </span>
          )}
          <span className="text-slate-500 font-normal">{o.currency}</span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
            <Building2 className="w-2.5 h-2.5 text-slate-400" />
            {office?.name || o.officeId}
          </span>
        </div>
        {(o.paidAmount || 0) > 0 && (
          <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden max-w-[240px]">
            <div
              className={`h-full rounded-full ${isTheyOwe ? "bg-sky-400" : "bg-amber-400"}`}
              style={{ width: `${paidPct}%` }}
            />
          </div>
        )}
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
              ? isTheyOwe
                ? "bg-sky-600 text-white hover:bg-sky-700"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-100 text-slate-400 cursor-not-allowed"
          }`}
          title={isTheyOwe ? "Record payment received from client" : canSettle ? "Create OUT movement, close obligation" : "Not enough balance yet"}
        >
          <Check className="w-3 h-3" />
          {isTheyOwe ? "Receive" : "Settle"}
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

function SettleModal({ obligation, onClose, onSettle, mode = "settle" }) {
  const { accounts, balanceOf, reservedOf } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isReceive = mode === "receive";
  const remaining = obligation
    ? Math.max(0, obligation.amount - (obligation.paidAmount || 0))
    : 0;

  // Для they_owe (receive) — подойдёт любой account в нужной валюте (не офис-фильтр,
  // клиент может принести в любой).
  const candidates = useMemo(() => {
    if (!obligation) return [];
    return accounts
      .filter(
        (a) =>
          a.active &&
          a.currency === obligation.currency &&
          (isReceive || a.officeId === obligation.officeId)
      )
      .map((a) => ({
        ...a,
        available: balanceOf(a.id) - reservedOf(a.id),
      }))
      .sort((a, b) => b.available - a.available);
  }, [obligation, accounts, balanceOf, reservedOf, isReceive]);

  React.useEffect(() => {
    if (obligation) {
      setAccountId(candidates[0]?.id || "");
      setAmountStr(String(remaining));
      setError("");
    }
  }, [obligation, candidates, remaining]);

  if (!obligation) return null;
  const amountNum = parseFloat(amountStr) || 0;
  const selected = candidates.find((c) => c.id === accountId);
  const amountValid = amountNum > 0 && amountNum <= remaining;
  const balanceOK = isReceive || (selected && selected.available >= amountNum);
  const canSubmit = selected && amountValid && balanceOK;

  const handleSubmit = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await onSettle(obligation, accountId, amountNum);
      if (!res.ok) {
        setError(res.warning || "Could not settle");
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const title = isReceive ? "Receive payment" : "Settle obligation";
  const submitLabel = isReceive ? "Receive" : "Settle";

  return (
    <Modal open={!!obligation} onClose={onClose} title={title} width="md">
      <div className="p-5 space-y-3">
        <div className={`border rounded-[10px] px-3 py-2 text-[12px] ${
          isReceive
            ? "bg-sky-50 border-sky-200"
            : "bg-slate-50 border-slate-200"
        }`}>
          <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${
            isReceive ? "text-sky-700" : "text-slate-500"
          }`}>
            {isReceive ? "Client will pay" : "To settle"}
            {(obligation.paidAmount || 0) > 0 && (
              <span className="ml-2 text-slate-400 normal-case">
                (already paid {fmt(obligation.paidAmount, obligation.currency)})
              </span>
            )}
          </div>
          <div className="text-[16px] font-bold tabular-nums text-slate-900">
            {curSymbol(obligation.currency)}{fmt(remaining, obligation.currency)}{" "}
            <span className="text-[12px] text-slate-500 font-medium">{obligation.currency}</span>
            <span className="text-[11px] text-slate-400 font-medium ml-2">
              remaining of {fmt(obligation.amount, obligation.currency)}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Deal #{obligation.dealId}
          </div>
        </div>

        {/* Amount input — можно меньше remaining для partial */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Amount {isReceive ? "received" : "to pay"}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) =>
                setAmountStr(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
              }
              className="flex-1 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[14px] font-semibold tabular-nums outline-none"
            />
            <button
              type="button"
              onClick={() => setAmountStr(String(remaining))}
              className="px-2.5 py-2 rounded-[10px] text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              title="Set to full remaining"
            >
              Full
            </button>
          </div>
          {!amountValid && amountStr && (
            <p className="text-[10px] text-rose-600 mt-1">
              Must be between 0 and {fmt(remaining, obligation.currency)}
            </p>
          )}
          {amountNum > 0 && amountNum < remaining && (
            <p className="text-[10px] text-amber-700 mt-1">
              Partial {isReceive ? "receive" : "settle"} — {fmt(remaining - amountNum, obligation.currency)} {obligation.currency} will stay open.
            </p>
          )}
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
          {isReceive
            ? "Will create an IN movement on the selected account. If this closes the obligation and no others remain on the deal, the deal moves to Completed."
            : "Will create an OUT movement on the selected account. If this closes the obligation and no others remain on the deal, the deal moves to Completed."}
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
          disabled={!canSubmit || busy}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors inline-flex items-center gap-1.5 ${
            canSubmit && !busy
              ? isReceive
                ? "bg-sky-600 text-white hover:bg-sky-700"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          <ArrowRight className="w-3 h-3" />
          {busy ? "Processing…" : submitLabel}
        </button>
      </div>
    </Modal>
  );
}
