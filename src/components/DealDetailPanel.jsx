// src/components/DealDetailPanel.jsx
//
// Раскрывающаяся панель с детализацией сделки: IN side, OUT legs,
// Obligations. Используется в:
//   - AccountingTab (Capital → Бухгалтерский репорт)
//   - TransactionsTable (Cashier dashboard) — раскрытие строки сделки
//
// Источник: loadAccountingDealDetail(dealId) → {legs, inPayments, legPayments, obligations}.
//
// UX: компактные блоки IN / OUT / Obligations с per-side статусом. Для
// non-deal entity (transfer/expense/...) показывает упрощённый view.

import React, { useEffect, useState, useMemo } from "react";
import {
  ArrowDownLeft, ArrowUpRight, AlertCircle, CheckCircle2, Clock, Scale,
} from "lucide-react";
import { fmt, curSymbol } from "../utils/money.js";
import { loadAccountingDealDetail } from "../lib/supabaseReaders.js";

// Tone helpers
const STATUS_CLS = {
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial:   "bg-violet-50 text-violet-700 ring-violet-200",
  pending:   "bg-amber-50 text-amber-700 ring-amber-200",
};
const STATUS_LABEL = {
  completed: "Получено",
  partial:   "Частично",
  pending:   "Ожидание",
};

function sideStatus(planned, actual) {
  const p = Number(planned) || 0;
  const a = Number(actual) || 0;
  if (a + 0.00000001 >= p && p > 0) return "completed";
  if (a > 0 && a < p) return "partial";
  return "pending";
}

export default function DealDetailPanel({
  dealId,
  // optional — если уже загружено наверху (TransactionsTable сразу даёт outputs/etc)
  // тогда детали догружаем только legs/payments/obligations не в outputs
  hint = {},
  accountsById = {},
  partnerAccountsById = {},
  // показывать ли всю детализацию (true для AccountingTab) или сжатую (false)
  expanded = true,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAccountingDealDetail(dealId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => {
        if (!cancelled) {
          console.warn("[DealDetailPanel] load failed", e);
          setDetail(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dealId]);

  const accLabel = (id) => accountsById[id]?.name || (id ? `#${String(id).slice(0, 8)}` : "—");
  const partnerAccLabel = (id) => {
    const acc = partnerAccountsById[id];
    if (acc) return `${acc.partnerName || "Партнёр"} · ${acc.name}`;
    return id ? `Партнёр #${String(id).slice(0, 8)}` : "—";
  };

  if (loading) {
    return (
      <div className="text-[12px] text-slate-400 p-3">Загрузка деталей…</div>
    );
  }
  if (!detail) {
    return (
      <div className="text-[12px] text-slate-400 p-3">Не удалось загрузить детали.</div>
    );
  }

  // IN aggregates
  const inPlanned = Number(hint.amountIn) || 0;
  const inPaid = (detail.inPayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const inSt = sideStatus(inPlanned, inPaid);

  // OUT aggregates: суммируем по legs
  const totalOutPlanned = (detail.legs || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const totalOutPaid = (detail.legs || []).reduce((s, l) => s + (Number(l.actualAmount) || 0), 0);
  // status каждой leg отдельно — берём worst
  const legStatuses = (detail.legs || []).map((l) => sideStatus(l.amount, l.actualAmount));
  const outSt = legStatuses.includes("pending")
    ? legStatuses.includes("completed") ? "partial" : "pending"
    : legStatuses.includes("partial")
      ? "partial"
      : legStatuses.length > 0 ? "completed" : "pending";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-[12px]">
      {/* IN side */}
      <div className="rounded-[10px] border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <ArrowDownLeft className="w-3 h-3 text-rose-500" />
            IN — клиент отдал
          </div>
          <StatusPill status={inSt} />
        </div>
        <div className="text-[15px] font-bold text-slate-900 tabular-nums mb-1">
          {fmt(inPlanned, hint.currencyIn)} {hint.currencyIn || ""}
        </div>
        {hint.inKind && hint.inKind !== "ours_now" && (
          <div className="text-[10px] text-slate-500 mb-1">
            Тип: {inKindLabel(hint.inKind)}
          </div>
        )}
        {detail.inPayments.length > 0 ? (
          <div className="mt-2 space-y-1">
            <div className="text-[9.5px] font-bold text-slate-400 uppercase">Платежи</div>
            {detail.inPayments.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                accLabel={accLabel}
                partnerAccLabel={partnerAccLabel}
              />
            ))}
            <div className="border-t border-slate-100 pt-1 mt-1 flex justify-between text-[10.5px] font-bold tabular-nums">
              <span className="text-slate-500">Итого получено:</span>
              <span className="text-slate-900">{fmt(inPaid, hint.currencyIn)} / {fmt(inPlanned, hint.currencyIn)}</span>
            </div>
          </div>
        ) : inSt === "pending" ? (
          <div className="mt-2 text-[10.5px] text-amber-700 italic">
            Платежей ещё не было — обязательство «{inKindLabel(hint.inKind)}»
          </div>
        ) : null}
      </div>

      {/* OUT legs */}
      <div className="rounded-[10px] border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <ArrowUpRight className="w-3 h-3 text-emerald-500" />
            OUT — клиент получил
          </div>
          <StatusPill status={outSt} />
        </div>
        {detail.legs.length === 0 ? (
          <div className="text-[11px] text-slate-400">Нет legs</div>
        ) : (
          <div className="space-y-1.5">
            {detail.legs.map((l) => {
              const st = sideStatus(l.amount, l.actualAmount);
              return (
                <div key={l.id} className="border-b border-slate-100 last:border-0 pb-1.5 last:pb-0">
                  <div className="flex items-baseline justify-between text-[11.5px]">
                    <span className="font-semibold tabular-nums">
                      {fmt(l.amount, l.currency)} {l.currency}
                      <span className="text-slate-400 font-normal text-[10px] ml-1.5">@ {l.rate}</span>
                    </span>
                    <span className="text-[9.5px] text-slate-500">{outKindLabel(l.outKind)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>
                      {l.outKind === "ours_now" ? `→ ${accLabel(l.accountId)}` :
                       l.outKind === "partner_now" ? `→ ${partnerAccLabel(l.partnerAccountId)}` :
                       l.outKind === "ours_later" ? "→ мы должны клиенту" :
                       "→ партнёр должен клиенту"}
                    </span>
                    <StatusPill status={st} compact />
                  </div>
                  {st === "partial" && (
                    <div className="text-[10px] text-violet-700 font-bold tabular-nums mt-0.5">
                      Выдано: {fmt(l.actualAmount, l.currency)} / {fmt(l.amount, l.currency)}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="border-t border-slate-200 pt-1 flex justify-between text-[10.5px] font-bold tabular-nums">
              <span className="text-slate-500">Итого выдано:</span>
              <span className="text-slate-900">{fmt(totalOutPaid, detail.legs[0]?.currency)} / {fmt(totalOutPlanned, detail.legs[0]?.currency)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Obligations */}
      <div className="rounded-[10px] border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          <Scale className="w-3 h-3" />
          Обязательства
        </div>
        {detail.obligations.length === 0 ? (
          <div className="text-[11px] text-slate-400">Нет открытых обязательств</div>
        ) : (
          <div className="space-y-1.5">
            {detail.obligations.map((o) => {
              const remaining = o.amount - o.paidAmount;
              const isWeOwe = o.direction === "we_owe";
              const isClosed = o.status === "closed";
              return (
                <div
                  key={o.id}
                  className={`border-b border-slate-100 last:border-0 pb-1.5 last:pb-0 ${
                    isClosed ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-baseline justify-between text-[11.5px]">
                    <span className={`font-semibold ${isWeOwe ? "text-rose-700" : "text-emerald-700"}`}>
                      {isWeOwe ? "Мы должны" : "Должны нам"}
                    </span>
                    <span className="font-bold tabular-nums">
                      {fmt(remaining, o.currency)} {o.currency}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {o.counterpartyName ? `${o.counterpartyName} · ` : ""}
                    paid {fmt(o.paidAmount, o.currency)} / {fmt(o.amount, o.currency)}
                    {isClosed && <span className="ml-1 text-emerald-600 font-bold">✓ closed</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function StatusPill({ status, compact = false }) {
  const cls = STATUS_CLS[status] || STATUS_CLS.pending;
  const label = STATUS_LABEL[status] || "—";
  const Icon = status === "completed" ? CheckCircle2 : status === "partial" ? Clock : Clock;
  if (compact) {
    return (
      <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-bold ring-1 ${cls}`}>
        {label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold ring-1 ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

function PaymentRow({ payment, accLabel, partnerAccLabel }) {
  const d = new Date(payment.paidAt);
  const dateStr = Number.isFinite(d.getTime())
    ? `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : "—";
  const dest = payment.kind === "ours_now"
    ? accLabel(payment.accountId)
    : payment.kind === "partner_now"
      ? partnerAccLabel(payment.partnerAccountId)
      : "—";
  return (
    <div className="text-[10.5px] text-slate-600 flex items-center justify-between">
      <span className="truncate">{dateStr} · {dest}</span>
      <span className="font-semibold tabular-nums shrink-0 ml-2">
        {fmt(payment.amount, payment.currency)} {payment.currency}
      </span>
    </div>
  );
}

function inKindLabel(k) {
  return {
    ours_now: "Принимаем сейчас",
    partner_now: "Принимает партнёр",
    ours_later: "Клиент должен нам",
    partner_later: "Партнёр должен нам",
  }[k] || k || "—";
}

function outKindLabel(k) {
  return {
    ours_now: "Наш счёт",
    partner_now: "Счёт партнёра",
    ours_later: "Мы должны клиенту",
    partner_later: "Партнёр должен клиенту",
  }[k] || k || "—";
}
