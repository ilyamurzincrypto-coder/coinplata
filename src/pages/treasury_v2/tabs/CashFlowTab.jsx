// src/pages/treasury_v2/tabs/CashFlowTab.jsx
// Treasury «Движение средств» (ДДС) по стандарту IFRS / IAS 7 — 3 секции:
//   1. Операционная     deal/exchange/income/expense/settle/reverse
//                       + inline-правки обязательств (working capital)
//   2. Инвестиционная   долгосрочные активы (для обменника обычно пуста)
//   3. Финансовая       topup/withdrawal/opening + inline-правки на cash
//                       против equity (реклассификация капитала)
//
// Cash & cash equivalents pool по IAS 7 = cash + bank + crypto_input +
// crypto_output. Inter-office / clearing / fx_clearing — внутренние, в
// pool не входят. USDT/USDC/DAI/BUSD пересчитываются 1:1 к USD при
// отсутствии явного fxRate в Settings.
//
// Polish-фичи:
//   • Internal-transfer cash↔cash отфильтрованы (netto 0).
//   • Operating секция разбита подзаголовками direct-method:
//       Поступления от клиентов | Платежи и расходы | Корректировки.
//   • Сравнение с предыдущим периодом такого же размера (Δ значок).
//   • Export CSV — для бухгалтерии.
//   • Иконки на секциях, sticky-итоги.
import React, { useState, useMemo, useEffect } from "react";
import {
  ChevronRight, ChevronDown, ArrowUpDown, Briefcase, Banknote,
  ArrowUpRight, ArrowDownRight, Minus, Download, Building2,
  TrendingUp, ShieldCheck, ShieldAlert, Globe, Info, Activity,
  AlertTriangle, AlertOctagon, Zap, ArrowRight,
} from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { trialBalance, pnlForPeriod } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { exportCSV } from "../../../utils/csv.js";
import { useOffices } from "../../../store/offices.jsx";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

// IAS 7 cash & cash equivalents
const CASH_SUBTYPES = new Set(["cash", "bank", "crypto_input", "crypto_output"]);

const fmtBaseAmount = (n, baseCurrency) =>
  `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency}`;
const fmtSignedBase = (n, baseCurrency) =>
  `${n < 0 ? "−" : ""}${fmtBaseAmount(Math.abs(n), baseCurrency)}`;
const fmtCur = (amount, currency) =>
  `${curSymbol(currency)}${fmt(amount, currency)}${curSymbol(currency) ? "" : ` ${currency}`}`;
const fmtSignedCur = (amount, currency) =>
  `${amount < 0 ? "−" : ""}${fmtCur(Math.abs(amount), currency)}`;

function passesOffice(acc, officeFilter) {
  if (officeFilter === "all" || !officeFilter) return true;
  return acc.officeId === officeFilter;
}
const isCash = (acc) => !!acc && acc.type === "asset" && CASH_SUBTYPES.has(acc.subtype);

const OPERATING_KINDS = new Set([
  "deal", "deal_v2", "exchange", "exchange_in", "exchange_out",
  "income", "expense", "settle", "reverse", "reversal",
]);
const FINANCING_KINDS = new Set(["topup", "withdrawal", "opening"]);
const INTERNAL_KINDS = new Set(["transfer", "transfer_in", "transfer_out"]);

// Подкатегории Operating для direct-method-style разбивки.
// Назначаем при категоризации, чтобы при показе сразу видеть «откуда пришло /
// куда ушло» — это управленческая ценность.
function operatingSubgroup(kind, nonCashLegs) {
  if (kind === "deal" || kind === "deal_v2" || kind === "exchange" ||
      kind === "exchange_in" || kind === "exchange_out") {
    return "customer_receipts"; // приход от клиентских сделок
  }
  if (kind === "income") return "customer_receipts";
  if (kind === "expense") return "payments";
  if (kind === "settle") return "payments";
  if (kind === "reverse" || kind === "reversal") return "reversals";
  // adjustment/manual на обязательствах
  if (kind === "adjustment" || kind === "manual") {
    const counter = nonCashLegs[0]?.acc;
    if (counter?.type === "liability") return "working_capital";
    return "adjustments";
  }
  return "other";
}

// Tailwind JIT не выдёргивает динамические классы — храним статичные
// в одной структуре.
const OPERATING_SUBGROUP_META = {
  customer_receipts: { label: "Поступления от клиентов (сделки, доходы)", icon: ArrowDownRight, iconCls: "text-emerald-500" },
  payments:          { label: "Платежи и расходы",                          icon: ArrowUpRight,   iconCls: "text-rose-500" },
  working_capital:   { label: "Изменения в обязательствах перед клиентами", icon: ArrowUpDown,    iconCls: "text-indigo-500" },
  reversals:         { label: "Сторно операций",                            icon: Minus,          iconCls: "text-slate-400" },
  adjustments:       { label: "Прочие корректировки",                       icon: Minus,          iconCls: "text-slate-400" },
  other:             { label: "Прочее",                                     icon: Minus,          iconCls: "text-slate-400" },
};

function categorizeTx(kind, nonCashLegs, sumCashBase) {
  if (INTERNAL_KINDS.has(kind) && nonCashLegs.length === 0 && Math.abs(sumCashBase) < 0.01) {
    return "internal";
  }
  if (kind === "adjustment" || kind === "manual") {
    const counter = nonCashLegs[0]?.acc;
    if (!counter) return "operating";
    if (counter.type === "liability") return "operating";
    if (counter.type === "revenue") return "operating";
    if (counter.type === "expense") return "operating";
    if (counter.type === "equity") return "financing";
    if (counter.type === "asset") return "operating";
    return "operating";
  }
  if (OPERATING_KINDS.has(kind)) return "operating";
  if (FINANCING_KINDS.has(kind)) return "financing";
  return "operating";
}

function buildCashFlow(ctx, win, officeFilter) {
  const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
  const txEffMs = new Map((ctx.transactions || []).map((t) => [t.id, new Date(t.effectiveDate).getTime()]));
  const txKindMap = new Map((ctx.transactions || []).map((t) => [t.id, t.kind || "unknown"]));
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();

  // Per-office метрики Operating (только когда officeFilter='all' имеет смысл,
  // но считаем всегда — UI решит показывать или нет).
  const perOffice = new Map(); // officeId|"__none__" → { officeId, netBase, txCount }
  // Метрики сделок для топ-карточки.
  let dealCount = 0;
  let dealTurnoverBase = 0; // gross input от клиентов на cash (sum positives для kind=deal*)

  const txCashLegs = new Map();
  const txNonCashLegs = new Map();
  for (const e of ctx.entries || []) {
    const acc = accById.get(e.accountId);
    if (!acc) continue;
    const ts = txEffMs.has(e.transactionId) ? txEffMs.get(e.transactionId) : new Date(e.createdAt).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const amt = Number(e.amount) || 0;
    const signedNative = e.direction === "dr" ? amt : -amt;
    const signedBase = ctx.toBase(signedNative, e.currency) || 0;
    if (isCash(acc)) {
      if (!passesOffice(acc, officeFilter)) continue;
      const list = txCashLegs.get(e.transactionId) || [];
      list.push({ e, acc, signedBase, signedNative });
      txCashLegs.set(e.transactionId, list);
    } else {
      const list = txNonCashLegs.get(e.transactionId) || [];
      list.push({ e, acc, signedBase, signedNative });
      txNonCashLegs.set(e.transactionId, list);
    }
  }

  const SECTIONS = ["operating", "investing", "financing"];
  const makeSection = () => ({
    inflowBase: 0, outflowBase: 0, netBase: 0, txCount: 0,
    byKind: new Map(), byCurrency: new Map(),
    bySubgroup: new Map(), // только для operating
  });
  const sections = Object.fromEntries(SECTIONS.map((c) => [c, makeSection()]));
  let internalTxCount = 0;

  for (const [txId, cashLegs] of txCashLegs.entries()) {
    const kind = txKindMap.get(txId) || "unknown";
    const nonCashLegs = txNonCashLegs.get(txId) || [];
    const sumCashBase = cashLegs.reduce((s, l) => s + l.signedBase, 0);
    const category = categorizeTx(kind, nonCashLegs, sumCashBase);
    if (category === "internal") {
      internalTxCount += 1;
      continue;
    }
    const bucket = sections[category];
    if (!bucket) continue;
    bucket.txCount += 1;
    bucket.byKind.set(kind, (bucket.byKind.get(kind) || 0) + sumCashBase);
    if (category === "operating") {
      const sg = operatingSubgroup(kind, nonCashLegs);
      bucket.bySubgroup.set(sg, (bucket.bySubgroup.get(sg) || 0) + sumCashBase);
    }
    const isDeal = kind === "deal" || kind === "deal_v2" || kind === "exchange";
    if (isDeal) dealCount += 1;
    for (const leg of cashLegs) {
      if (leg.signedBase > 0) bucket.inflowBase += leg.signedBase;
      else bucket.outflowBase += -leg.signedBase;
      if (isDeal && leg.signedBase > 0) dealTurnoverBase += leg.signedBase;
      const e = leg.e;
      const amt = Math.abs(Number(e.amount) || 0);
      const ccyBucket = bucket.byCurrency.get(e.currency) || { currency: e.currency, inflow: 0, outflow: 0, net: 0, netBase: 0 };
      if (e.direction === "dr") ccyBucket.inflow += amt;
      else ccyBucket.outflow += amt;
      ccyBucket.net += leg.signedNative;
      ccyBucket.netBase += leg.signedBase;
      bucket.byCurrency.set(e.currency, ccyBucket);
      // Per-office по cash ноге (только Operating: для смыслового management)
      if (category === "operating") {
        const offKey = leg.acc.officeId || "__none__";
        const off = perOffice.get(offKey) || { officeId: leg.acc.officeId || null, netBase: 0, txIds: new Set() };
        off.netBase += leg.signedBase;
        off.txIds.add(txId);
        perOffice.set(offKey, off);
      }
    }
    bucket.netBase += sumCashBase;
  }

  const tb = trialBalance(ctx, { from: win.from, to: win.to }, officeFilter);
  let openingBase = 0;
  for (const cls of tb.classes) {
    for (const a of cls.accounts) {
      if (a.type === "asset" && CASH_SUBTYPES.has(a.subtype)) openingBase += a.openingInBase || 0;
    }
  }
  const totalNetBase = SECTIONS.reduce((s, c) => s + sections[c].netBase, 0);
  const closingBase = openingBase + totalNetBase;
  const hasMovement = txCashLegs.size > 0;

  // Маржа от сделок — извлекаем из revenue/expense accounts pnlForPeriod.
  // Sum of revenue.total − expense.total (для обменника revenue = спред +
  // комиссия, expense = network fees, exchange fees). Это близко к чистой
  // марже на сделках, если других неоперационных доходов нет за период.
  const pnl = pnlForPeriod(ctx, win, officeFilter);
  const marginBase = (pnl.revenue.total || 0) - (pnl.expense.total || 0);
  const marginPct = dealTurnoverBase > 0.01 ? (marginBase / dealTurnoverBase) * 100 : null;
  const avgDealSize = dealCount > 0 ? dealTurnoverBase / dealCount : 0;

  const perOfficeList = [...perOffice.values()]
    .map((o) => ({ ...o, txCount: o.txIds.size, txIds: undefined }))
    .sort((a, b) => Math.abs(b.netBase) - Math.abs(a.netBase));

  return {
    sections, totalNetBase, openingBase, closingBase, hasMovement, internalTxCount, win,
    deals: { count: dealCount, turnoverBase: dealTurnoverBase, marginBase, marginPct, avgDealSize },
    perOffice: perOfficeList,
  };
}

// FX exposure: нетто-позиция по каждой валюте (cash equivalents) на конец
// периода. Для управленца — видеть валютный риск: «у меня перевес в USDT,
// если упадёт — потеряю».
function buildFxExposure(ctx, win, officeFilter) {
  const tb = trialBalance(ctx, { from: win.from, to: win.to }, officeFilter);
  const byCurrency = new Map();
  for (const cls of tb.classes) {
    for (const a of cls.accounts) {
      if (a.type !== "asset" || !CASH_SUBTYPES.has(a.subtype)) continue;
      const cur = a.currency;
      const native = Number(a.closing) || 0;
      const inBase = Number(a.closingInBase) || 0;
      if (Math.abs(native) < 1e-9) continue;
      const bucket = byCurrency.get(cur) || { currency: cur, native: 0, inBase: 0 };
      bucket.native += native;
      bucket.inBase += inBase;
      byCurrency.set(cur, bucket);
    }
  }
  const totalBase = [...byCurrency.values()].reduce((s, b) => s + b.inBase, 0);
  const list = [...byCurrency.values()]
    .map((b) => ({ ...b, sharePct: totalBase > 0.01 ? (b.inBase / totalBase) * 100 : 0 }))
    .sort((a, b) => Math.abs(b.inBase) - Math.abs(a.inBase));
  return { byCurrency: list, totalBase };
}

// Coverage ratio: сколько раз cash покрывает обязательства перед клиентами.
// > 1.0 — комфортно; 0.8–1.0 — тонко; < 0.8 — недостаточно ликвидности.
function buildCoverage(ctx, win, officeFilter) {
  const tb = trialBalance(ctx, { from: win.from, to: win.to }, officeFilter);
  let cashTotal = 0;
  let obligationsTotal = 0; // в base, положительный знак = «должны клиентам»
  for (const cls of tb.classes) {
    for (const a of cls.accounts) {
      if (a.type === "asset" && CASH_SUBTYPES.has(a.subtype)) {
        cashTotal += Number(a.closingInBase) || 0;
      } else if (a.type === "liability" && a.subtype === "customer_liab") {
        // У liability Cr-normal: closingInBase отрицательный (Dr−Cr).
        // Сумма обязательств = |closing| (минус-знак отбрасываем для display).
        obligationsTotal += Math.abs(Number(a.closingInBase) || 0);
      }
    }
  }
  const ratio = obligationsTotal > 0.01 ? cashTotal / obligationsTotal : null;
  return { cashTotal, obligationsTotal, ratio };
}

// Pair analytics: для каждой клиентской сделки определяем пару валют
// (out → in, что отдали → что получили со стороны кассы) и собираем:
//   • count       — сколько сделок по этой паре
//   • turnoverBase — gross оборот в base (сумма IN-ноги)
//   • marginBase   — маржа = revenue − expense entries той же транзакции
// Сортируем по марже desc — топ-пары приносящие прибыль.
function buildPairAnalytics(ctx, win, officeFilter) {
  const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
  const txEffMs = new Map((ctx.transactions || []).map((t) => [t.id, new Date(t.effectiveDate).getTime()]));
  const txKindMap = new Map((ctx.transactions || []).map((t) => [t.id, t.kind || "unknown"]));
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();
  const DEAL_KINDS = new Set(["deal", "deal_v2", "exchange", "exchange_in", "exchange_out"]);

  // Группируем entries по транзакции для разбора каждой сделки целиком.
  const txEntries = new Map();
  for (const e of ctx.entries || []) {
    const ts = txEffMs.has(e.transactionId) ? txEffMs.get(e.transactionId) : new Date(e.createdAt).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const list = txEntries.get(e.transactionId) || [];
    list.push(e);
    txEntries.set(e.transactionId, list);
  }

  const byPair = new Map();
  for (const [txId, entries] of txEntries.entries()) {
    const kind = txKindMap.get(txId);
    if (!DEAL_KINDS.has(kind)) continue;
    // Собираем IN/OUT cash ноги (доминантные).
    let inCur = null, inBase = 0;
    let outCur = null, outBase = 0;
    let revenue = 0;
    for (const e of entries) {
      const acc = accById.get(e.accountId);
      if (!acc) continue;
      const amt = Number(e.amount) || 0;
      if (isCash(acc)) {
        if (!passesOffice(acc, officeFilter)) continue;
        const inBaseLeg = ctx.toBase(amt, e.currency) || 0;
        if (e.direction === "dr") {
          // Берём первый IN; если несколько — суммируем по той же валюте.
          if (inCur == null) inCur = e.currency;
          if (e.currency === inCur) inBase += inBaseLeg;
        } else {
          if (outCur == null) outCur = e.currency;
          if (e.currency === outCur) outBase += inBaseLeg;
        }
      } else if (acc.type === "revenue") {
        revenue += ctx.toBase(e.direction === "cr" ? amt : -amt, e.currency) || 0;
      } else if (acc.type === "expense") {
        revenue -= ctx.toBase(e.direction === "dr" ? amt : -amt, e.currency) || 0;
      }
    }
    if (!inCur || !outCur) continue;
    const pairKey = `${outCur}_${inCur}`;
    const bucket = byPair.get(pairKey) || {
      pair: pairKey, fromCur: outCur, toCur: inCur,
      count: 0, turnoverBase: 0, marginBase: 0,
      txs: [], // топ сделок для drill-down (по марже)
    };
    bucket.count += 1;
    bucket.turnoverBase += inBase;
    bucket.marginBase += revenue;
    bucket.txs.push({
      txId, kind, inCur, inBase, outCur, outBase, marginBase: revenue,
      effectiveDate: new Date(txEffMs.get(txId)).toISOString(),
    });
    byPair.set(pairKey, bucket);
  }
  // Сортируем txs внутри каждой пары по |margin| desc, оставляем топ-5.
  for (const bucket of byPair.values()) {
    bucket.txs.sort((a, b) => Math.abs(b.marginBase) - Math.abs(a.marginBase));
    bucket.txs = bucket.txs.slice(0, 5);
  }
  return [...byPair.values()].sort((a, b) => Math.abs(b.marginBase) - Math.abs(a.marginBase));
}

// Прогноз окончания периода на основе текущего темпа.
// Если периода ещё не прошло — экстраполируем nettoBase * total/elapsed.
// Возвращает { applicable, projectedNet, daysElapsed, daysTotal }.
function buildForecast(win, totalNetBase) {
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();
  const nowMs = Date.now();
  // Прогноз имеет смысл только если конец периода в будущем И мы внутри окна.
  if (nowMs <= fromMs || nowMs >= toMs) {
    return { applicable: false };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const daysElapsed = Math.max(1, Math.ceil((nowMs - fromMs) / dayMs));
  const daysTotal = Math.max(daysElapsed, Math.ceil((toMs - fromMs) / dayMs));
  if (daysElapsed >= daysTotal - 0.5) return { applicable: false };
  const pace = totalNetBase / daysElapsed;
  const projectedNet = pace * daysTotal;
  return { applicable: true, projectedNet, daysElapsed, daysTotal, pace };
}

// Алерты на основе текущей картины. Возвращает массив { severity, title,
// detail }. severity: 'warn' | 'critical'.
function buildAlerts(cf, fx, cov, baseCurrency) {
  const alerts = [];
  if (cov.ratio != null && cov.ratio < 0.8) {
    alerts.push({
      severity: "critical",
      title: "Недостаточно ликвидности для покрытия обязательств клиентам",
      detail: `Cash ${fmtBaseAmount(cov.cashTotal, baseCurrency)} < обязательств ${fmtBaseAmount(cov.obligationsTotal, baseCurrency)} (coverage ${cov.ratio.toFixed(2)}×). Нужно либо довложить, либо закрыть часть обязательств перед выдачей новых.`,
    });
  } else if (cov.ratio != null && cov.ratio < 1.0) {
    alerts.push({
      severity: "warn",
      title: "Тонкая ликвидность",
      detail: `Coverage ${cov.ratio.toFixed(2)}×. Cash покрывает обязательства, но запаса нет — следи за выдачами и думай про пополнение.`,
    });
  }
  // FX-концентрация: одна валюта >70% портфеля
  const concentratedCur = fx.byCurrency.find((b) => b.sharePct > 70);
  if (concentratedCur) {
    alerts.push({
      severity: "warn",
      title: `Сильный валютный перевес: ${concentratedCur.currency} ${concentratedCur.sharePct.toFixed(0)}%`,
      detail: `Бо́льшая часть кэша (${fmtBaseAmount(concentratedCur.inBase, baseCurrency)} из ${fmtBaseAmount(fx.totalBase, baseCurrency)}) в одной валюте. Если она упадёт — серьёзный удар по капиталу. Подумай о хедже или ребалансе.`,
    });
  }
  return alerts;
}

// Daily buckets: для каждого дня периода считаем netto cash flow (по cash
// equivalents). Возвращает массив { dateKey: "YYYY-MM-DD", netBase }.
// Используется для sparkline-визуализации активности.
function buildDailyFlow(ctx, win, officeFilter) {
  const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
  const txEffMs = new Map((ctx.transactions || []).map((t) => [t.id, new Date(t.effectiveDate).getTime()]));
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  // Pre-fill дней нулями для непрерывного sparkline.
  const buckets = new Map();
  for (let t = fromMs; t <= toMs; t += dayMs) {
    const key = new Date(t).toISOString().slice(0, 10);
    buckets.set(key, 0);
  }
  for (const e of ctx.entries || []) {
    const acc = accById.get(e.accountId);
    if (!isCash(acc) || !passesOffice(acc, officeFilter)) continue;
    const ts = txEffMs.has(e.transactionId) ? txEffMs.get(e.transactionId) : new Date(e.createdAt).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const amt = Number(e.amount) || 0;
    const signedNative = e.direction === "dr" ? amt : -amt;
    const signedBase = ctx.toBase(signedNative, e.currency) || 0;
    const key = new Date(ts).toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + signedBase);
  }
  return [...buckets.entries()].map(([dateKey, netBase]) => ({ dateKey, netBase }));
}

// Окно предыдущего периода такой же длины (для сравнения).
function previousWindow(win) {
  const from = new Date(win.from).getTime();
  const to = new Date(win.to).getTime();
  const len = to - from;
  const prevTo = new Date(from - 1).toISOString();
  const prevFrom = new Date(from - 1 - len).toISOString();
  return { from: prevFrom, to: prevTo };
}

function kindLabel(kind, t) {
  return t(`trv2_journal_type_${kind}`, kind);
}

// Маленькая info-иконка с native-tooltip (title=) — даём подсказки на
// неочевидных метриках без отдельной библиотеки tooltip'ов.
function InfoTip({ text, className = "" }) {
  return (
    <span
      title={text}
      className={`inline-flex items-center text-slate-300 hover:text-slate-500 cursor-help ${className}`}
    >
      <Info className="w-3 h-3" />
    </span>
  );
}

// Sparkline ежедневного cash flow. Высота баров пропорциональна
// |max| из всех дней. Цвет: emerald = inflow (>0), rose = outflow (<0).
function Sparkline({ days, baseCurrency }) {
  if (!days || days.length === 0) return null;
  const maxAbs = Math.max(0.01, ...days.map((d) => Math.abs(d.netBase)));
  return (
    <div className="flex items-end gap-px h-10 min-w-[100px]">
      {days.map((d) => {
        const heightPct = Math.max(2, (Math.abs(d.netBase) / maxAbs) * 100);
        const positive = d.netBase >= 0;
        return (
          <div
            key={d.dateKey}
            title={`${d.dateKey}: ${d.netBase >= 0 ? "+" : "−"}${Math.abs(d.netBase).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency}`}
            className={`flex-1 min-w-[3px] rounded-t-[1px] ${positive ? "bg-emerald-400" : "bg-rose-400"}`}
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
}

function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-[14px] border border-slate-200/70 p-4 ${className}`}>{children}</div>;
}

const SECTION_META = {
  operating: {
    label: "Операционная деятельность",
    hint: "Сделки, доходы, расходы, изменения в обязательствах.",
    icon: ArrowUpDown,
    iconWrapCls: "bg-emerald-50 text-emerald-600",
  },
  investing: {
    label: "Инвестиционная деятельность",
    hint: "Долгосрочные активы — оборудование, ПО, инвестиции.",
    icon: Briefcase,
    iconWrapCls: "bg-indigo-50 text-indigo-600",
  },
  financing: {
    label: "Финансовая деятельность",
    hint: "Пополнения собственника, изъятия, открывающие остатки.",
    icon: Banknote,
    iconWrapCls: "bg-amber-50 text-amber-600",
  },
};

// Δ-индикатор vs предыдущего периода.
function PrevDelta({ current, previous, baseCurrency }) {
  const delta = current - previous;
  if (Math.abs(delta) < 0.01 && Math.abs(previous) < 0.01) return null;
  const pct = Math.abs(previous) > 0.01 ? (delta / Math.abs(previous)) * 100 : null;
  const positive = delta > 0;
  const Icon = positive ? ArrowUpRight : (delta < 0 ? ArrowDownRight : Minus);
  const toneCls = positive ? "text-emerald-600" : (delta < 0 ? "text-rose-600" : "text-slate-500");
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10.5px] font-bold tabular-nums ${toneCls}`}
      title={`Δ vs предыдущий период: ${fmtSignedBase(delta, baseCurrency)}`}
    >
      <Icon className="w-3 h-3" strokeWidth={2.5} />
      {pct != null ? `${positive ? "+" : ""}${pct.toFixed(0)}%` : fmtSignedBase(delta, baseCurrency)}
    </span>
  );
}

function CategorySection({ id, meta, data, prevNet, baseCurrency, t, expanded, toggle, perOffice, findOffice, daily }) {
  const open = expanded.has(id);
  const netToneCls = data.netBase < 0 ? "text-rose-600" : data.netBase > 0 ? "text-emerald-600" : "text-slate-600";
  const Icon = meta.icon || Minus;
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <div
        onClick={() => toggle(id)}
        className="px-3 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${meta.iconWrapCls}`}>
          <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-slate-900 uppercase tracking-wide">{meta.label}</div>
          <div className="text-[11px] text-slate-400">{meta.hint}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-[16px] font-bold tabular-nums inline-flex items-baseline gap-1.5 ${netToneCls}`}>
            {fmtSignedBase(data.netBase, baseCurrency)}
            {prevNet != null && <PrevDelta current={data.netBase} previous={prevNet} baseCurrency={baseCurrency} />}
          </div>
          {(data.inflowBase > 0 || data.outflowBase > 0) && (
            <div className="text-[10.5px] text-slate-400 tabular-nums">
              <span className="text-emerald-600">+{fmtBaseAmount(data.inflowBase, baseCurrency)}</span>
              <span className="mx-1">·</span>
              <span className="text-rose-600">−{fmtBaseAmount(data.outflowBase, baseCurrency)}</span>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="px-4 py-2 bg-slate-50/30 space-y-2">
          {/* Operating sparkline — ежедневная активность за период */}
          {id === "operating" && daily && daily.length > 1 && (
            <div className="bg-white border border-slate-100 rounded-[10px] px-3 py-2 flex items-center gap-3">
              <div className="flex items-center gap-1 text-[10px] text-slate-500 uppercase font-bold tracking-wider shrink-0">
                <Activity className="w-3 h-3" />
                Дневная активность
              </div>
              <div className="flex-1 min-w-0">
                <Sparkline days={daily} baseCurrency={baseCurrency} />
              </div>
              <div className="text-[10px] text-slate-400 shrink-0">
                {daily.length} {daily.length === 1 ? "день" : daily.length < 5 ? "дня" : "дней"}
              </div>
            </div>
          )}
          {/* Operating — direct-method подгруппы */}
          {id === "operating" && data.bySubgroup && data.bySubgroup.size > 0 && (
            <div className="space-y-1">
              {[...data.bySubgroup.entries()]
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([sg, net]) => {
                  const sgMeta = OPERATING_SUBGROUP_META[sg] || OPERATING_SUBGROUP_META.other;
                  const SgIcon = sgMeta.icon;
                  return (
                    <div key={sg} className="flex items-center gap-2 px-1 py-1.5 text-[12px]">
                      <SgIcon className={`w-3 h-3 shrink-0 ${sgMeta.iconCls}`} strokeWidth={2.5} />
                      <span className="text-slate-700 flex-1">{sgMeta.label}</span>
                      <span className={`text-right tabular-nums font-semibold ${net < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {fmtSignedBase(net, baseCurrency)}
                      </span>
                    </div>
                  );
                })}
              <div className="border-t border-slate-200 my-1" />
            </div>
          )}
          {/* Per-office breakdown — только в Operating и только в режиме «все офисы» */}
          {id === "operating" && perOffice && perOffice.length > 0 && (
            <details className="text-[11.5px]">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800 py-1 inline-flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                по офисам ({perOffice.length})
              </summary>
              <table className="w-full mt-1">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase tracking-wider">
                    <th className="text-left py-1 font-bold">Офис</th>
                    <th className="text-right py-1 font-bold">Транзакций</th>
                    <th className="text-right py-1 font-bold">Нетто (base)</th>
                  </tr>
                </thead>
                <tbody>
                  {perOffice.map((o) => {
                    const name = o.officeId
                      ? (findOffice?.(o.officeId)?.name || o.officeId.slice(0, 8))
                      : "Без офиса";
                    return (
                      <tr key={o.officeId || "__none__"} className="border-t border-slate-100">
                        <td className="py-1 text-slate-700">{name}</td>
                        <td className="py-1 text-right tabular-nums text-slate-500">{o.txCount}</td>
                        <td className={`py-1 text-right tabular-nums font-semibold ${o.netBase < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {fmtSignedBase(o.netBase, baseCurrency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}
          {data.byKind.size === 0 ? (
            <div className="text-[12px] text-slate-400 py-1">Движений в этой секции нет за период.</div>
          ) : (
            <details className="text-[11.5px]">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800 py-1">детально по типу транзакции</summary>
              <table className="w-full mt-1">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase tracking-wider">
                    <th className="text-left py-1 font-bold">Тип</th>
                    <th className="text-right py-1 font-bold">Нетто (в base)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.byKind.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([kind, net]) => (
                    <tr key={kind} className="border-t border-slate-100">
                      <td className="py-1 text-slate-700">{kindLabel(kind, t)}</td>
                      <td className={`py-1 text-right tabular-nums ${net < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(net, baseCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {data.byCurrency.size > 0 && (
            <details className="text-[11.5px]">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800 py-1">по валютам</summary>
              <table className="w-full mt-1">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase tracking-wider">
                    <th className="text-left py-1 font-bold">Вал.</th>
                    <th className="text-right py-1 font-bold">Поступило</th>
                    <th className="text-right py-1 font-bold">Выбыло</th>
                    <th className="text-right py-1 font-bold">Нетто</th>
                    <th className="text-right py-1 font-bold">≈ base</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.byCurrency.values()].sort((a, b) => Math.abs(b.netBase) - Math.abs(a.netBase)).map((c) => (
                    <tr key={c.currency} className="border-t border-slate-100">
                      <td className="py-1 font-semibold text-slate-700">{c.currency}</td>
                      <td className="py-1 text-right tabular-nums text-emerald-700">+{fmtCur(c.inflow, c.currency)}</td>
                      <td className="py-1 text-right tabular-nums text-rose-700">−{fmtCur(c.outflow, c.currency)}</td>
                      <td className={`py-1 text-right tabular-nums ${c.net < 0 ? "text-rose-600" : "text-slate-700"}`}>{fmtSignedCur(c.net, c.currency)}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500">{fmtSignedBase(c.netBase, baseCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function doCsvExport(cf, prevCf, pairs, baseCurrency, periodLabel) {
  const rows = [];
  const push = (section, kind, label, amount, prev) => rows.push({ section, kind, label, amount, prev });
  for (const [secId, data] of Object.entries(cf.sections)) {
    push(SECTION_META[secId].label, "", "ИТОГО", data.netBase, prevCf?.sections[secId]?.netBase ?? 0);
    if (secId === "operating" && data.bySubgroup) {
      for (const [sg, net] of data.bySubgroup.entries()) {
        const sgLabel = OPERATING_SUBGROUP_META[sg]?.label || sg;
        push(SECTION_META[secId].label, "subgroup", sgLabel, net, null);
      }
    }
    for (const [kind, net] of data.byKind.entries()) {
      push(SECTION_META[secId].label, kind, kindLabel(kind, (k) => k), net, null);
    }
  }
  push("ИТОГ", "", "Чистое изменение", cf.totalNetBase, prevCf?.totalNetBase ?? 0);
  push("ИТОГ", "", "На начало периода", cf.openingBase, null);
  push("ИТОГ", "", "На конец периода", cf.closingBase, null);
  // Полный список валютных пар (не только топ-8 из UI).
  for (const p of pairs || []) {
    push("Пары", `${p.fromCur}_${p.toCur}`, `${p.fromCur} → ${p.toCur} (${p.count}×, оборот ${p.turnoverBase.toFixed(2)})`, p.marginBase, null);
  }
  exportCSV({
    filename: `cashflow_${periodLabel}.csv`,
    columns: [
      { key: "section", label: "Секция" },
      { key: "kind", label: "Тип" },
      { key: "label", label: "Категория" },
      { key: "amount", label: `Нетто (${baseCurrency})` },
      { key: "prev", label: `Прошлый период (${baseCurrency})` },
    ],
    rows,
  });
}

export default function CashFlowTab({ ctx, officeFilter, baseCurrency }) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  const [period, setPeriodState] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_cashflow_period") || "month"; } catch { return "month"; }
  });
  const setPeriod = (v) => { setPeriodState(v); try { localStorage.setItem("coinplata.treasury_cashflow_period", v); } catch {} };

  const win = useMemo(() => presetWindow(period), [period]);
  const prevWin = useMemo(() => previousWindow(win), [win]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso) {
      const earliest = new Date(prevWin.from);
      if (earliest < new Date(ctx.sinceIso)) ctx.extendWindow(prevWin.from);
    }
  }, [prevWin.from, ctx.sinceIso, ctx.extendWindow]);

  const cf = useMemo(() => buildCashFlow(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const prevCf = useMemo(() => buildCashFlow(ctx, prevWin, officeFilter), [ctx, prevWin, officeFilter]);
  const fx = useMemo(() => buildFxExposure(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const cov = useMemo(() => buildCoverage(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const daily = useMemo(() => buildDailyFlow(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const pairs = useMemo(() => buildPairAnalytics(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const alerts = useMemo(() => buildAlerts(cf, fx, cov, baseCurrency), [cf, fx, cov, baseCurrency]);
  const forecast = useMemo(() => buildForecast(win, cf.totalNetBase), [win, cf.totalNetBase]);

  const [expanded, setExpanded] = useState(() => new Set(["operating"]));
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const periodLabel = `${win.from.slice(0, 10)}_${win.to.slice(0, 10)}`;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <span className="text-[11px] text-slate-400">Стандарт: IAS 7 · 3 секции · сравнение с прошлым периодом</span>
        <button
          type="button"
          onClick={() => doCsvExport(cf, prevCf, pairs, baseCurrency, periodLabel)}
          disabled={!cf.hasMovement}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[12px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" strokeWidth={2.5} />
          CSV
        </button>
      </div>

      {/* Alerts всегда сверху (даже когда нет движений, coverage может сигналить) */}
      {alerts.length > 0 && <AlertsBanner alerts={alerts} />}

      {!cf.hasMovement ? (
        <Card className="text-center text-[12.5px] text-slate-400 py-8">
          {t("trv2_cf_empty")}
        </Card>
      ) : (
        <>
        {/* Top metrics — управленческая сводка: сделки/маржа + coverage. */}
        <MetricsCard cf={cf} cov={cov} baseCurrency={baseCurrency} />

        <Card className="!p-0">
          <CategorySection
            id="operating" meta={SECTION_META.operating} data={cf.sections.operating}
            prevNet={prevCf.sections.operating.netBase}
            baseCurrency={baseCurrency} t={t} expanded={expanded} toggle={toggle}
            perOffice={officeFilter === "all" ? cf.perOffice : null}
            findOffice={findOffice}
            daily={daily}
          />
          <CategorySection
            id="investing" meta={SECTION_META.investing} data={cf.sections.investing}
            prevNet={prevCf.sections.investing.netBase}
            baseCurrency={baseCurrency} t={t} expanded={expanded} toggle={toggle}
          />
          <CategorySection
            id="financing" meta={SECTION_META.financing} data={cf.sections.financing}
            prevNet={prevCf.sections.financing.netBase}
            baseCurrency={baseCurrency} t={t} expanded={expanded} toggle={toggle}
          />
          {/* Sticky-итог внизу — даже если все секции свёрнуты */}
          <div className="border-t-2 border-slate-200 bg-gradient-to-b from-slate-50/50 to-white px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px]">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Чистое изменение денежных средств
              </span>
              <span className={`text-[20px] font-bold tabular-nums ml-auto ${cf.totalNetBase < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                {fmtSignedBase(cf.totalNetBase, baseCurrency)}
              </span>
              <PrevDelta current={cf.totalNetBase} previous={prevCf.totalNetBase} baseCurrency={baseCurrency} />
            </div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12.5px]">
              <div className="rounded-[10px] bg-slate-50 px-3 py-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">На начало периода</div>
                <div className="text-[15px] font-bold tabular-nums text-slate-900">{fmtBaseAmount(cf.openingBase, baseCurrency)}</div>
              </div>
              <div className={`rounded-[10px] px-3 py-2 ${cf.totalNetBase < 0 ? "bg-rose-50" : "bg-emerald-50"}`}>
                <div className={`text-[10px] uppercase tracking-wide ${cf.totalNetBase < 0 ? "text-rose-700" : "text-emerald-700"}`}>Изменение</div>
                <div className={`text-[15px] font-bold tabular-nums ${cf.totalNetBase < 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtSignedBase(cf.totalNetBase, baseCurrency)}</div>
              </div>
              <div className="rounded-[10px] bg-slate-100 px-3 py-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">На конец периода</div>
                <div className="text-[15px] font-bold tabular-nums text-slate-900">{fmtBaseAmount(cf.closingBase, baseCurrency)}</div>
              </div>
            </div>
            {/* Прогноз на конец периода: если период не закрыт, и темп ясен */}
            {forecast.applicable && (
              <div className="mt-3 rounded-[10px] border border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[12px] text-indigo-900 flex items-center gap-2 flex-wrap">
                <TrendingUp className="w-3.5 h-3.5 text-indigo-500 shrink-0" strokeWidth={2.5} />
                <span className="font-bold uppercase text-[10px] tracking-wider">Прогноз</span>
                <span>
                  День {forecast.daysElapsed} из {forecast.daysTotal} — при текущем темпе{" "}
                  <span className="font-semibold tabular-nums" title={`Дневной пейс: ${fmtSignedBase(forecast.pace, baseCurrency)}`}>
                    {fmtSignedBase(forecast.pace, baseCurrency)}/день
                  </span>
                  {" "}к концу периода будет{" "}
                  <span className={`font-bold tabular-nums ${forecast.projectedNet < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {fmtSignedBase(forecast.projectedNet, baseCurrency)}
                  </span>
                </span>
              </div>
            )}
            {cf.internalTxCount > 0 && (
              <div className="mt-2 text-[10.5px] text-slate-400">
                Внутренние переводы между нашими счетами ({cf.internalTxCount} шт., netto 0) — исключены из отчёта.
              </div>
            )}
          </div>
        </Card>

        {/* Pair analytics — какая валютная пара принесла больше всего маржи */}
        {pairs.length > 0 && <PairAnalyticsCard pairs={pairs} baseCurrency={baseCurrency} />}

        {/* FX exposure — нетто-позиция по валютам на конец периода */}
        <FxExposureCard fx={fx} baseCurrency={baseCurrency} />
        </>
      )}
    </div>
  );
}

// ─── MetricsCard ───────────────────────────────────────────────────────
// Карточка управленческих метрик: сделки, оборот, маржа, средний чек,
// Coverage ratio (cash покрывает обязательства перед клиентами).
function MetricsCard({ cf, cov, baseCurrency }) {
  const deals = cf.deals;
  const covOk = cov.ratio == null || cov.ratio >= 1.0;
  const covWarn = cov.ratio != null && cov.ratio < 1.0 && cov.ratio >= 0.8;
  const covIcon = covOk ? ShieldCheck : ShieldAlert;
  const CovIcon = covIcon;
  return (
    <div className="bg-white rounded-[14px] border border-slate-200/70 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric
          icon={TrendingUp}
          iconWrapCls="bg-emerald-50 text-emerald-600"
          label="Сделок"
          value={deals.count.toLocaleString("ru-RU")}
          sub={deals.count > 0 ? `avg ${fmtBaseAmount(deals.avgDealSize, baseCurrency)}` : "—"}
          tip="Количество клиентских сделок за период (deal / exchange). Avg = средний размер сделки (gross приход)."
        />
        <Metric
          icon={ArrowDownRight}
          iconWrapCls="bg-emerald-50 text-emerald-600"
          label="Оборот"
          value={fmtBaseAmount(deals.turnoverBase, baseCurrency)}
          sub="клиентские поступления (gross)"
          tip="Σ всех клиентских поступлений (Dr на cash от deal / exchange). Это валовой оборот, не прибыль."
        />
        <Metric
          icon={ArrowUpDown}
          iconWrapCls={deals.marginBase >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}
          label="Маржа"
          value={fmtSignedBase(deals.marginBase, baseCurrency)}
          sub={deals.marginPct != null ? `${deals.marginPct >= 0 ? "+" : ""}${deals.marginPct.toFixed(2)}%` : "—"}
          tone={deals.marginBase < 0 ? "rose" : "emerald"}
          tip="Доходы (спред + комиссия) минус расходы (сетевые/обменные fee'и) за период. Та же цифра, что в P&L. % считается от оборота."
        />
        <Metric
          icon={covIcon}
          iconWrapCls={covOk ? "bg-emerald-50 text-emerald-600" : covWarn ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}
          label="Coverage"
          value={cov.ratio != null ? `${cov.ratio.toFixed(2)}×` : "—"}
          sub={
            cov.obligationsTotal > 0.01
              ? `${fmtBaseAmount(cov.cashTotal, baseCurrency)} / ${fmtBaseAmount(cov.obligationsTotal, baseCurrency)}`
              : "обязательств нет"
          }
          tone={covOk ? "emerald" : covWarn ? "amber" : "rose"}
          tip="Сколько раз наш кэш покрывает обязательства перед клиентами. ≥ 1.0× — комфортно (можем закрыть всё). 0.8–1.0× — тонко. < 0.8× — недостаточно ликвидности, есть риск не выдать клиентам."
        />
      </div>
    </div>
  );
}

function Metric({ icon: Icon, iconWrapCls, label, value, sub, tone = "slate", tip }) {
  const valueToneCls =
    tone === "emerald" ? "text-emerald-700"
    : tone === "rose" ? "text-rose-700"
    : tone === "amber" ? "text-amber-700"
    : "text-slate-900";
  return (
    <div className="flex items-start gap-2.5">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconWrapCls}`}>
        <Icon className="w-4 h-4" strokeWidth={2.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold inline-flex items-center gap-1">
          {label}
          {tip && <InfoTip text={tip} />}
        </div>
        <div className={`text-[18px] font-bold tabular-nums leading-tight ${valueToneCls}`}>{value}</div>
        <div className="text-[10.5px] text-slate-400 tabular-nums truncate" title={sub}>{sub}</div>
      </div>
    </div>
  );
}

// ─── AlertsBanner ──────────────────────────────────────────────────────
// Управленческие алерты: красные (critical) и жёлтые (warn). Появляются
// автоматически при недостаточной ликвидности и сильном FX-перевесе.
function AlertsBanner({ alerts }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const critical = a.severity === "critical";
        const Icon = critical ? AlertOctagon : AlertTriangle;
        const wrap = critical
          ? "bg-rose-50 border-rose-200 text-rose-900"
          : "bg-amber-50 border-amber-200 text-amber-900";
        const iconCls = critical ? "text-rose-600" : "text-amber-600";
        return (
          <div key={i} className={`rounded-[12px] border px-4 py-3 flex items-start gap-3 ${wrap}`}>
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconCls}`} strokeWidth={2.5} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold">{a.title}</div>
              <div className="text-[11.5px] opacity-80 mt-0.5 leading-snug">{a.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── PairAnalyticsCard ─────────────────────────────────────────────────
// Какая валютная пара принесла больше всего маржи за период.
// Сортировка по |marginBase| desc — топ-пары прибыльности видны сразу.
// Клик по строке пары раскрывает топ-5 её сделок (drill-down).
function PairAnalyticsCard({ pairs, baseCurrency }) {
  const [expandedPair, setExpandedPair] = useState(null);
  const top = pairs.slice(0, 8);
  const totalMargin = pairs.reduce((s, p) => s + p.marginBase, 0);
  const totalTurnover = pairs.reduce((s, p) => s + p.turnoverBase, 0);
  const maxMargin = Math.max(0.01, ...top.map((p) => Math.abs(p.marginBase)));
  return (
    <div className="bg-white rounded-[14px] border border-slate-200/70 p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Zap className="w-4 h-4 text-amber-500" />
        <h3 className="text-[13px] font-bold text-slate-900 uppercase tracking-wide">
          Топ валютных пар по марже
        </h3>
        <InfoTip text="Сколько маржи принесла каждая пара (что отдали → что получили). Маржа считается из revenue/expense ног сделки. Помогает понять какие пары пушить и где задирать спред. Клик по паре — топ-5 её сделок." />
        <span className="text-[11px] text-slate-400 ml-auto">
          Маржа Σ {fmtSignedBase(totalMargin, baseCurrency)} · оборот {fmtBaseAmount(totalTurnover, baseCurrency)}
        </span>
      </div>
      {top.length === 0 ? (
        <div className="text-[12px] text-slate-400 py-2">Сделок за период нет.</div>
      ) : (
        <div className="space-y-1">
          {top.map((p) => {
            const widthPct = Math.max(2, (Math.abs(p.marginBase) / maxMargin) * 100);
            const positive = p.marginBase >= 0;
            const marginPct = p.turnoverBase > 0.01 ? (p.marginBase / p.turnoverBase) * 100 : null;
            const isOpen = expandedPair === p.pair;
            return (
              <React.Fragment key={p.pair}>
                <div
                  onClick={() => setExpandedPair(isOpen ? null : p.pair)}
                  className="flex items-center gap-2 text-[12.5px] cursor-pointer hover:bg-slate-50 rounded-[6px] -mx-1 px-1 py-0.5"
                >
                  {isOpen
                    ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                  <span className="inline-flex items-center gap-1 font-bold text-slate-700 w-24 shrink-0">
                    {p.fromCur}
                    <ArrowRight className="w-2.5 h-2.5 text-slate-400" />
                    {p.toCur}
                  </span>
                  <span className="text-slate-400 text-[11px] tabular-nums w-10 shrink-0">{p.count}×</span>
                  <span className="text-slate-500 text-[11px] tabular-nums w-24 shrink-0 truncate" title={`Оборот ${fmtBaseAmount(p.turnoverBase, baseCurrency)}`}>
                    {fmtBaseAmount(p.turnoverBase, baseCurrency)}
                  </span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden min-w-[60px]">
                    <div
                      className={`h-full ${positive ? "bg-emerald-400" : "bg-rose-400"}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className={`text-right tabular-nums font-semibold w-24 shrink-0 ${positive ? "text-emerald-700" : "text-rose-700"}`}>
                    {fmtSignedBase(p.marginBase, baseCurrency)}
                  </span>
                  {marginPct != null && (
                    <span className={`text-right tabular-nums text-[10.5px] w-12 shrink-0 ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                      {positive ? "+" : ""}{marginPct.toFixed(2)}%
                    </span>
                  )}
                </div>
                {isOpen && p.txs.length > 0 && (
                  <div className="pl-6 pr-1 pb-1 pt-0.5 bg-slate-50/40 rounded-b-[6px] -mx-1 mb-1">
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold py-1">
                      Топ-{p.txs.length} сделок этой пары по марже
                    </div>
                    <table className="w-full text-[11.5px]">
                      <tbody>
                        {p.txs.map((tx) => (
                          <tr key={tx.txId} className="border-t border-slate-100">
                            <td className="py-1 text-slate-500 tabular-nums w-20">{tx.effectiveDate.slice(0, 10)}</td>
                            <td className="py-1 text-slate-700">
                              <span className="tabular-nums">{tx.outBase.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tx.outCur}</span>
                              <ArrowRight className="w-2.5 h-2.5 mx-1 inline text-slate-400" />
                              <span className="tabular-nums">{tx.inBase.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tx.inCur}</span>
                              <span className="text-slate-400 text-[10px] ml-1">(в base)</span>
                            </td>
                            <td className={`py-1 text-right tabular-nums font-semibold ${tx.marginBase < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                              {fmtSignedBase(tx.marginBase, baseCurrency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
      {pairs.length > 8 && (
        <div className="mt-2 text-[10.5px] text-slate-400">
          Показаны топ-8 из {pairs.length} пар. Полный список — в CSV экспорте.
        </div>
      )}
    </div>
  );
}

// ─── FxExposureCard ────────────────────────────────────────────────────
// На конец периода: сколько у нас в каждой валюте (cash equivalents),
// доля каждой в общем cash-портфеле — видеть валютный риск.
function FxExposureCard({ fx, baseCurrency }) {
  if (!fx.byCurrency.length) return null;
  return (
    <div className="bg-white rounded-[14px] border border-slate-200/70 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Globe className="w-4 h-4 text-slate-500" />
        <h3 className="text-[13px] font-bold text-slate-900 uppercase tracking-wide">
          Валютная позиция на конец периода
        </h3>
        <InfoTip text="Нетто-баланс по каждой валюте в cash equivalents (cash + bank + crypto). Если в одной валюте сильный перевес (>50%) — валютный риск: падение этой валюты ощутимо ударит по капиталу. Для обменника норма — разные валюты пропорционально объёмам сделок." />
        <span className="text-[11px] text-slate-400 ml-auto">
          Σ ≈ {fmtBaseAmount(fx.totalBase, baseCurrency)}
        </span>
      </div>
      <div className="space-y-1">
        {fx.byCurrency.map((b) => (
          <div key={b.currency} className="flex items-center gap-3 text-[12.5px]">
            <span className="font-bold text-slate-700 w-12 shrink-0">{b.currency}</span>
            <span className="tabular-nums text-slate-800 w-32 shrink-0">{fmtSignedCur(b.native, b.currency)}</span>
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[80px]">
              <div
                className={`h-full ${b.inBase >= 0 ? "bg-emerald-400" : "bg-rose-400"}`}
                style={{ width: `${Math.min(100, Math.abs(b.sharePct))}%` }}
              />
            </div>
            <span className="text-slate-500 text-[11px] tabular-nums w-12 text-right shrink-0">
              {b.sharePct.toFixed(0)}%
            </span>
            <span className="text-slate-500 text-[11.5px] tabular-nums w-24 text-right shrink-0">
              ≈ {fmtSignedBase(b.inBase, baseCurrency)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-slate-100 text-[10.5px] text-slate-400 leading-snug">
        Если в одной валюте сильный перевес (например 70% в USDT) — валютный риск:
        падение этой валюты ощутимо ударит по капиталу.
      </div>
    </div>
  );
}
