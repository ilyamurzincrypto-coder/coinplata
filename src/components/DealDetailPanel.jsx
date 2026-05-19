// src/components/DealDetailPanel.jsx
//
// Полный flow OTC сделки в виде вертикального timeline:
//
//   ① CLIENT GIVES        — что клиент отдал, кто принял, статус
//   ② CONVERSION (OTC)    — курс, fee, profit
//   ③ CLIENT RECEIVES     — что клиент получил, кто выдал, статус
//   ④ OBLIGATIONS         — кто кому остался должен (если есть)
//   ⑤ EXECUTION LEGS      — детальная разбивка выдачи на legs
//
// Используется в:
//   - TransactionsTable (Cashier dashboard) — раскрытие строки
//   - AccountingTab (Capital → Бухгалтерский репорт)
//
// Источник: loadAccountingDealDetail(dealId) → {legs, inPayments, legPayments, obligations}.

import React, { useEffect, useState, useMemo } from "react";
import {
  ArrowDownLeft, ArrowUpRight, AlertCircle, CheckCircle2, Clock, Scale,
  Repeat, Coins,
} from "lucide-react";
import { fmt, curSymbol } from "../utils/money.js";
import { loadAccountingDealDetail } from "../lib/supabaseReaders.js";

// ─── Status helpers ────────────────────────────────────────────────────

const STATUS_PILL = {
  completed: "bg-success-soft text-success ring-emerald-200",
  partial:   "bg-accent-bg text-accent ring-violet-200",
  pending:   "bg-warning-soft text-warning ring-amber-200",
};

const STATUS_LABEL = {
  completed: "Completed",
  partial:   "Partial",
  pending:   "Pending",
};

function sideStatus(planned, actual) {
  const p = Number(planned) || 0;
  const a = Number(actual) || 0;
  if (a + 0.00000001 >= p && p > 0) return "completed";
  if (a > 0 && a < p) return "partial";
  return "pending";
}

function StatusPill({ status }) {
  const cls = STATUS_PILL[status] || STATUS_PILL.pending;
  const Icon = status === "completed" ? CheckCircle2 : Clock;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-micro font-bold ring-1 ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Kind labels ───────────────────────────────────────────────────────

const IN_KIND = {
  ours_now:      { label: "Принимает наш счёт",      tone: "emerald" },
  partner_now:   { label: "Принимает контрагент",    tone: "indigo"  },
  ours_later:    { label: "Клиент должен нам",       tone: "amber"   },
  partner_later: { label: "Контрагент должен нам",   tone: "amber"   },
};

const OUT_KIND = {
  ours_now:      { label: "С нашего счёта",          tone: "emerald" },
  partner_now:   { label: "Со счёта контрагента",    tone: "indigo"  },
  ours_later:    { label: "Мы должны клиенту",       tone: "amber"   },
  partner_later: { label: "Контрагент должен клиенту", tone: "amber" },
};

// ─── Main panel ────────────────────────────────────────────────────────

export default function DealDetailPanel({
  dealId,
  hint = {},
  accountsById = {},
  partnerAccountsById = {},
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

  if (loading) {
    return <div className="text-caption text-muted-soft p-3">Загрузка деталей…</div>;
  }
  if (!detail) {
    return <div className="text-caption text-muted-soft p-3">Не удалось загрузить детали.</div>;
  }

  // План счетов: если у entity задан accounting_code — префиксим именем
  // (например «2008 Касса Mark Antalya»). Юзер заводит коды в Settings →
  // План счетов; пока кода нет — показывается просто имя.
  const withCode = (code, name) => (code ? `${code} ${name}` : name);
  const accLabel = (id) => {
    const a = accountsById[id];
    if (!a) return id ? `#${String(id).slice(0, 8)}` : "—";
    return withCode(a.accountingCode, a.name);
  };
  const partnerLabel = (id) => {
    const acc = partnerAccountsById[id];
    if (acc) {
      const name = `${acc.partnerName || "Партнёр"} · ${acc.name}`;
      return withCode(acc.ledgerAccountCode, name);
    }
    return id ? `Партнёр #${String(id).slice(0, 8)}` : "—";
  };

  // IN aggregate
  const inPlanned = Number(hint.amountIn) || 0;
  const inPaid = (detail.inPayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const inSt = inPlanned > 0 ? sideStatus(inPlanned, inPaid) : "completed";

  // OUT aggregate
  const totalOutPlanned = (detail.legs || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const totalOutPaid = (detail.legs || []).reduce((s, l) => s + (Number(l.actualAmount) || 0), 0);
  const legStatuses = (detail.legs || []).map((l) => sideStatus(l.amount, l.actualAmount));
  const outSt = legStatuses.length === 0 ? "pending"
    : legStatuses.every((s) => s === "completed") ? "completed"
    : legStatuses.some((s) => s === "completed" || s === "partial") ? "partial"
    : "pending";

  // OUT side primary destination для подзаголовка ("Sent by ...")
  const firstLeg = detail.legs[0];
  const outCurrency = firstLeg?.currency || "—";

  // Determine "received by" for IN side
  const inReceivedBy = (() => {
    if (hint.inKind === "ours_now") {
      // first payment account
      const firstPay = (detail.inPayments || []).find((p) => p.accountId);
      return firstPay ? accLabel(firstPay.accountId) : (hint.inAccountId ? accLabel(hint.inAccountId) : "наш счёт");
    }
    if (hint.inKind === "partner_now") {
      const firstPay = (detail.inPayments || []).find((p) => p.partnerAccountId);
      return firstPay ? partnerLabel(firstPay.partnerAccountId) : "контрагент";
    }
    if (hint.inKind === "ours_later") return "клиент (отложено)";
    if (hint.inKind === "partner_later") return "контрагент (отложено)";
    return "—";
  })();

  // Open obligations only — closed скрываем по дефолту
  const openObligations = detail.obligations.filter((o) => o.status !== "cancelled");

  // Бухгалтерские проводки Дт / Кт / Сумма — выводим из IN-payments и legs.
  // Правила:
  //   • IN payment ours_now    → Дт «наш счёт», Кт «клиент»
  //   • IN payment partner_now → Дт «партнёр-счёт», Кт «клиент»
  //   • OUT leg ours_now       → Дт «клиент», Кт «наш счёт»
  //   • OUT leg partner_now    → Дт «клиент», Кт «партнёр-счёт»
  // _later (deferred) — без движения, только obligation. В проводки не попадают.
  // hint.clientCode опц. передаётся из AccountingTab — клиент получает
  // префикс «386 Mehmet Obmenka» в проводках.
  const clientName = hint.clientLabel || hint.counterpartyLabel || "Клиент";
  const clientLabel = hint.clientCode ? `${hint.clientCode} ${clientName}` : clientName;
  const entries = (() => {
    const out = [];
    (detail.inPayments || []).forEach((p) => {
      const amt = Number(p.amount) || 0;
      if (amt <= 0) return;
      if (p.kind === "ours_now" && p.accountId) {
        out.push({
          dr: accLabel(p.accountId),
          cr: clientLabel,
          amount: amt,
          currency: p.currency,
          side: "in",
        });
      } else if (p.kind === "partner_now" && p.partnerAccountId) {
        out.push({
          dr: partnerLabel(p.partnerAccountId),
          cr: clientLabel,
          amount: amt,
          currency: p.currency,
          side: "in",
        });
      }
    });
    (detail.legs || []).forEach((l) => {
      const amt = Number(l.actualAmount) || Number(l.amount) || 0;
      if (amt <= 0) return;
      if (l.outKind === "ours_now" && l.accountId) {
        out.push({
          dr: clientLabel,
          cr: accLabel(l.accountId),
          amount: amt,
          currency: l.currency,
          side: "out",
        });
      } else if (l.outKind === "partner_now" && l.partnerAccountId) {
        out.push({
          dr: clientLabel,
          cr: partnerLabel(l.partnerAccountId),
          amount: amt,
          currency: l.currency,
          side: "out",
        });
      }
    });
    return out;
  })();

  // Одностороннее OUT — нет IN-секции, всё начинается с шага «Client receives».
  // Skip-флаги нужны для последовательной нумерации шагов и last-флага линии.
  const hasIn = inPlanned > 0;
  const hasConversion = hasIn && firstLeg && hint.currencyIn && firstLeg.currency !== hint.currencyIn;

  return (
    <div className="space-y-0">
      {/* ─── STEP 1: CLIENT GIVES ─────────────────────────────────── */}
      {hasIn && (
      <TimelineStep
        index={1}
        tone="rose"
        title="Client gives"
        icon={ArrowDownLeft}
        last={false}
      >
        <div className="text-[15px] font-bold text-ink tabular-nums mb-1">
          {fmt(inPlanned, hint.currencyIn)} {hint.currencyIn}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-start">
          <div className="space-y-0.5 text-caption">
            <FieldRow label="Received by" value={inReceivedBy} bold />
            {hint.inKind && (
              <FieldRow label="Type" value={IN_KIND[hint.inKind]?.label || hint.inKind} />
            )}
          </div>
          <div className="md:text-right">
            <StatusPill status={inSt} />
          </div>
        </div>
        {detail.inPayments.length > 1 && (
          <div className="mt-2 pt-2 border-t border-border-soft space-y-1">
            <div className="text-micro font-bold text-muted-soft uppercase tracking-wider">
              Payments ({detail.inPayments.length})
            </div>
            {detail.inPayments.map((p) => (
              <PaymentRow key={p.id} payment={p} accLabel={accLabel} partnerLabel={partnerLabel} />
            ))}
          </div>
        )}
      </TimelineStep>
      )}

      {/* ─── STEP 2: CONVERSION ───────────────────────────────────── */}
      {hasConversion && (
        <TimelineStep
          index={2}
          tone="indigo"
          title={hint.kind === "otc" || hint.kind === "broker" ? "OTC conversion" : "Конверсия валюты"}
          icon={Repeat}
          last={false}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-tiny font-bold text-muted-soft uppercase tracking-wider">Rate</div>
              <div className="text-body-sm font-bold text-ink tabular-nums">
                1 {hint.currencyIn} = {Number(firstLeg.rate).toFixed(6)} {firstLeg.currency}
              </div>
            </div>
            <div>
              <div className="text-tiny font-bold text-muted-soft uppercase tracking-wider">Inverse</div>
              <div className="text-body-sm font-bold text-ink-soft tabular-nums">
                1 {firstLeg.currency} = {firstLeg.rate > 0 ? (1 / Number(firstLeg.rate)).toFixed(6) : "—"} {hint.currencyIn}
              </div>
            </div>
            {hint.feeUsd != null && (
              <div>
                <div className="text-tiny font-bold text-muted-soft uppercase tracking-wider">Fee</div>
                <div className="text-body-sm font-bold text-ink tabular-nums">
                  ${fmt(hint.feeUsd, "USD")}
                </div>
              </div>
            )}
            {hint.commissionUsd != null && hint.commissionUsd > 0 && (
              <div>
                <div className="text-tiny font-bold text-muted-soft uppercase tracking-wider">Commission</div>
                <div className="text-body-sm font-bold text-ink tabular-nums">
                  ${fmt(hint.commissionUsd, "USD")}
                </div>
              </div>
            )}
            {hint.profit != null && (
              <div className="col-span-2 pt-1.5 border-t border-border-soft">
                <div className="text-tiny font-bold text-muted-soft uppercase tracking-wider">Profit</div>
                <div className={`text-[15px] font-bold tabular-nums ${hint.profit > 0 ? "text-success" : hint.profit < 0 ? "text-danger" : "text-ink-soft"}`}>
                  {hint.profit > 0 ? "+" : ""}${fmt(hint.profit, "USD")}
                </div>
              </div>
            )}
          </div>
        </TimelineStep>
      )}

      {/* ─── STEP 3: CLIENT RECEIVES ──────────────────────────────── */}
      <TimelineStep
        index={(hasIn ? 1 : 0) + (hasConversion ? 1 : 0) + 1}
        tone="emerald"
        title="Client receives"
        icon={ArrowUpRight}
        last={openObligations.length === 0 && detail.legs.length <= 1}
      >
        <div className="text-[15px] font-bold text-ink tabular-nums mb-1">
          {fmt(totalOutPlanned, outCurrency)} {outCurrency}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-start">
          <div className="space-y-0.5 text-caption">
            {detail.legs.length === 1 ? (
              <FieldRow label="Sent by" value={outDestinationLabel(firstLeg, accLabel, partnerLabel)} bold />
            ) : (
              <FieldRow label="Sent by" value={`${detail.legs.length} legs (см. ниже)`} bold />
            )}
            {detail.legs.length === 1 && firstLeg.outKind && (
              <FieldRow label="Type" value={OUT_KIND[firstLeg.outKind]?.label || firstLeg.outKind} />
            )}
            {totalOutPaid > 0 && totalOutPaid < totalOutPlanned && (
              <FieldRow label="Paid" value={`${fmt(totalOutPaid, outCurrency)} / ${fmt(totalOutPlanned, outCurrency)}`} />
            )}
          </div>
          <div className="md:text-right">
            <StatusPill status={outSt} />
          </div>
        </div>
      </TimelineStep>

      {/* ─── STEP 4: OBLIGATIONS ──────────────────────────────────── */}
      {openObligations.length > 0 && (
        <TimelineStep
          index={(hasIn ? 1 : 0) + (hasConversion ? 1 : 0) + 2}
          tone="amber"
          title="Obligations"
          icon={Scale}
          last={detail.legs.length <= 1}
        >
          <div className="space-y-1.5">
            {openObligations.map((o) => {
              const remaining = o.amount - o.paidAmount;
              const isWeOwe = o.direction === "we_owe";
              const isClosed = o.status === "closed";
              return (
                <div
                  key={o.id}
                  className={`flex items-center justify-between gap-2 ${isClosed ? "opacity-60" : ""}`}
                >
                  <div className="min-w-0">
                    <div className={`text-caption font-semibold truncate ${isWeOwe ? "text-danger" : "text-success"}`}>
                      {isWeOwe ? "Мы должны" : "Должны нам"}
                      {o.counterpartyName ? <span className="text-muted font-normal"> · {o.counterpartyName}</span> : ""}
                    </div>
                    <div className="text-tiny text-muted mt-0.5">
                      paid {fmt(o.paidAmount, o.currency)} / {fmt(o.amount, o.currency)}
                      {isClosed && <span className="ml-1 text-success font-bold">✓ closed</span>}
                    </div>
                  </div>
                  <div className="text-body-sm font-bold tabular-nums shrink-0">
                    {fmt(remaining, o.currency)} {o.currency}
                  </div>
                </div>
              );
            })}
          </div>
        </TimelineStep>
      )}

      {/* ─── STEP 5: EXECUTION (legs) ──────────────────────────────── */}
      {detail.legs.length > 1 && (
        <TimelineStep
          index={(hasIn ? 1 : 0) + (hasConversion ? 1 : 0) + (openObligations.length > 0 ? 3 : 2)}
          tone="slate"
          title={`Execution · ${detail.legs.length} legs`}
          icon={Coins}
          last
        >
          <div className="space-y-2">
            {detail.legs.map((l, i) => {
              const st = sideStatus(l.amount, l.actualAmount);
              return (
                <div key={l.id} className="rounded-button border border-border-soft bg-white p-2.5">
                  <div className="flex items-baseline justify-between mb-1 gap-2">
                    <div className="text-tiny font-bold text-muted tracking-wider uppercase">
                      Leg {i + 1}
                    </div>
                    <StatusPill status={st} />
                  </div>
                  <div className="text-body-sm font-bold text-ink tabular-nums mb-0.5">
                    {fmt(l.amount, l.currency)} {l.currency}
                    <span className="text-tiny text-muted-soft font-normal ml-1.5">@ {l.rate}</span>
                  </div>
                  <div className="text-tiny text-muted">
                    → {outDestinationLabel(l, accLabel, partnerLabel)}
                  </div>
                  {st === "partial" && (
                    <div className="text-tiny text-accent font-bold tabular-nums mt-0.5">
                      Выдано: {fmt(l.actualAmount, l.currency)} / {fmt(l.amount, l.currency)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TimelineStep>
      )}

      {/* ─── Бухгалтерские проводки (Дт / Кт / Сумма) ─────────────────── */}
      {entries.length > 0 && (
        <div className="mt-2 rounded-card border border-border-soft bg-white overflow-hidden">
          <div className="px-3 py-2 border-b border-border-soft bg-surface-soft/40 flex items-center justify-between">
            <div className="text-tiny font-bold text-muted uppercase tracking-wider">
              Проводка
            </div>
            <span className="text-tiny text-muted-soft">
              {entries.length} {entries.length === 1 ? "операция" : "операций"}
            </span>
          </div>
          <table className="w-full text-caption">
            <thead>
              <tr className="text-micro font-bold text-muted-soft tracking-wider uppercase border-b border-border-soft">
                <th className="px-3 py-1.5 text-left">Тип</th>
                <th className="px-3 py-1.5 text-left">Дебет</th>
                <th className="px-3 py-1.5 text-left">Кредит</th>
                <th className="px-3 py-1.5 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-b border-border-soft last:border-0">
                  <td className="px-3 py-1.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-tiny font-bold uppercase ${
                        e.side === "in"
                          ? "bg-success-soft text-success"
                          : "bg-danger-soft text-danger"
                      }`}
                    >
                      {e.side === "in" ? "IN" : "OUT"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-soft">
                    <span className="font-semibold">Дт</span> {e.dr}
                  </td>
                  <td className="px-3 py-1.5 text-ink-soft">
                    <span className="font-semibold">Кт</span> {e.cr}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                    <span className="font-bold text-ink">{fmt(e.amount, e.currency)}</span>
                    <span className="text-tiny text-muted-soft ml-1">{e.currency}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Timeline step wrapper ──────────────────────────────────────────────

const TONE_RING = {
  rose:    "ring-rose-200 bg-danger-soft text-danger",
  indigo:  "ring-indigo-200 bg-accent-bg text-accent",
  emerald: "ring-emerald-200 bg-success-soft text-success",
  amber:   "ring-amber-200 bg-warning-soft text-warning",
  slate:   "ring-border-soft bg-surface-soft text-ink-soft",
};

const TONE_LINE = {
  rose:    "bg-rose-200/60",
  indigo:  "bg-indigo-200/60",
  emerald: "bg-emerald-200/60",
  amber:   "bg-amber-200/60",
  slate:   "bg-surface-sunk/60",
};

function TimelineStep({ index, tone, title, icon: Icon, last, children }) {
  return (
    <div className="flex gap-3">
      {/* Left column: number circle + connecting line */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-7 h-7 rounded-full ring-2 flex items-center justify-center text-tiny font-bold ${TONE_RING[tone] || TONE_RING.slate}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        {!last && (
          <div className={`w-px flex-1 my-1 min-h-[20px] ${TONE_LINE[tone] || TONE_LINE.slate}`} />
        )}
      </div>
      {/* Right column: card */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="text-tiny font-bold text-muted-soft uppercase tracking-wider mb-1">
          Step {index} · {title}
        </div>
        <div className="rounded-card border border-border-soft bg-white p-3">
          {children}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, value, bold }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-tiny font-bold text-muted-soft uppercase tracking-wider w-24 shrink-0">{label}</span>
      <span className={`text-caption ${bold ? "font-bold text-ink" : "text-ink-soft"}`}>{value}</span>
    </div>
  );
}

function PaymentRow({ payment, accLabel, partnerLabel }) {
  const d = new Date(payment.paidAt);
  const dateStr = Number.isFinite(d.getTime())
    ? `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : "—";
  const dest = payment.kind === "ours_now"
    ? accLabel(payment.accountId)
    : payment.kind === "partner_now"
      ? partnerLabel(payment.partnerAccountId)
      : "—";
  return (
    <div className="text-tiny text-ink-soft flex items-center justify-between gap-2">
      <span className="truncate">{dateStr} · {dest}</span>
      <span className="font-semibold tabular-nums shrink-0">
        {fmt(payment.amount, payment.currency)} {payment.currency}
      </span>
    </div>
  );
}

function outDestinationLabel(leg, accLabel, partnerLabel) {
  if (leg.outKind === "ours_now") return accLabel(leg.accountId);
  if (leg.outKind === "partner_now") return partnerLabel(leg.partnerAccountId);
  if (leg.outKind === "ours_later") return "мы должны клиенту";
  if (leg.outKind === "partner_later") return "контрагент должен клиенту";
  return "—";
}
