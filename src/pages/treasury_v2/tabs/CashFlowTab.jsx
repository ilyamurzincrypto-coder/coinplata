// src/pages/treasury_v2/tabs/CashFlowTab.jsx
// Treasury «Движение средств» (ДДС) — приток/отток денег по кассам и
// крипто-кошелькам за период, разнесённый по 4 активностям (IFRS-стилю
// адаптированному под обменник):
//
//   1. ОПЕРАЦИОННАЯ        — сделки, доходы/расходы (основная активность)
//   2. ФИНАНСОВАЯ          — пополнения извне, изъятия, открывающие остатки
//   3. КОРРЕКТИРОВКИ       — adjustment / manual inline-edit / прочие ручные
//   4. ВНУТРЕННИЕ          — переводы между нашими счетами (netto = 0,
//                            показаны информационно, не плюсуются в Net)
//
// Внутренние переводы исключаются из inflow/outflow если ВСЕ их legs на cash
// subtypes (классический интер-счёт нашей валюты). Если хоть одна нога ушла
// в не-cash (комиссия в expense, разница в FX-clearing) — попадает в свою
// категорию (operating/reconciliation) полным потоком.
import React, { useState, useMemo, useEffect } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { trialBalance } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

const CASH_SUBTYPES = new Set(["cash", "crypto_input", "crypto_output"]);

// Жёсткое сопоставление source_kind транзакции → бизнес-категория ДДС.
// Любой kind, которого здесь нет, попадает в "other" (запасной чан).
const CATEGORY_OF_KIND = {
  // Operating
  deal: "operating",
  deal_v2: "operating",
  exchange: "operating",
  exchange_in: "operating",
  exchange_out: "operating",
  income: "operating",
  expense: "operating",
  settle: "operating",
  // Financing
  topup: "financing",
  withdrawal: "financing",
  opening: "financing",
  // Reconciliation
  adjustment: "reconciliation",
  manual: "reconciliation",
  // Internal (will be filtered to net-zero entries)
  transfer: "internal",
  transfer_in: "internal",
  transfer_out: "internal",
  // Reversal / storno — обычно зеркалит исходную операцию; кладём в operating
  // (можно увидеть как deal со знаком минус).
  reverse: "operating",
  reversal: "operating",
};

const CATEGORIES = ["operating", "financing", "reconciliation", "internal", "other"];

const CATEGORY_META = {
  operating: { label: "Операционная деятельность", hint: "Сделки, доходы и расходы — основной бизнес-поток." },
  financing: { label: "Финансовая деятельность", hint: "Пополнения извне, изъятия владельца, открывающие остатки." },
  reconciliation: { label: "Корректировки и сверка", hint: "Inline-правки остатков, ручные проводки, реклассификации." },
  internal: { label: "Внутренние переводы (инфо)", hint: "Переводы между нашими счетами — netto 0, в общий итог не входят." },
  other: { label: "Прочее", hint: "Транзакции с неопознанным типом." },
};

const fmtBaseAmount = (n, baseCurrency) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency}`;
const fmtSignedBase = (n, baseCurrency) => `${n < 0 ? "−" : ""}${fmtBaseAmount(Math.abs(n), baseCurrency)}`;
const fmtCur = (amount, currency) => `${curSymbol(currency)}${fmt(amount, currency)}${curSymbol(currency) ? "" : ` ${currency}`}`;
const fmtSignedCur = (amount, currency) => `${amount < 0 ? "−" : ""}${fmtCur(Math.abs(amount), currency)}`;

function passesOffice(acc, officeFilter) {
  if (officeFilter === "all" || !officeFilter) return true;
  return acc.officeId === officeFilter;
}

function categoryOf(kind) {
  return CATEGORY_OF_KIND[kind] || "other";
}

// Сборка ДДС по периоду + офису.
// Возвращает {sections: {[cat]: {inflowBase, outflowBase, netBase, byKind:Map,
//   byCurrency:Map, txCount}}, totalInflowBase, totalOutflowBase, totalNetBase,
//   openingBase, closingBase, hasMovement}.
function buildCashFlow(ctx, win, officeFilter) {
  const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
  const txEffMs = new Map((ctx.transactions || []).map((t) => [t.id, new Date(t.effectiveDate).getTime()]));
  const txKindMap = new Map((ctx.transactions || []).map((t) => [t.id, t.kind || "unknown"]));
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();

  // Группируем entries по транзакции, чтобы понять «весь tx — внутренний»
  // (все cash-ноги, netto = 0).
  const txCashLegs = new Map(); // txId → [{e, acc, signedBase}]
  for (const e of ctx.entries || []) {
    const acc = accById.get(e.accountId);
    if (!acc || acc.type !== "asset" || !CASH_SUBTYPES.has(acc.subtype)) continue;
    if (!passesOffice(acc, officeFilter)) continue;
    const ts = txEffMs.has(e.transactionId) ? txEffMs.get(e.transactionId) : new Date(e.createdAt).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const amt = Number(e.amount) || 0;
    const signedNative = e.direction === "dr" ? amt : -amt;
    const signedBase = ctx.toBase(signedNative, e.currency) || 0;
    const list = txCashLegs.get(e.transactionId) || [];
    list.push({ e, acc, signedBase, signedNative });
    txCashLegs.set(e.transactionId, list);
  }

  // Заводим бакеты по категориям.
  const sections = {};
  for (const c of CATEGORIES) {
    sections[c] = {
      inflowBase: 0,
      outflowBase: 0,
      netBase: 0,
      txCount: 0,
      byKind: new Map(),    // kind → netBase
      byCurrency: new Map(),// currency → { currency, inflow, outflow, net, netBase }
    };
  }

  // Распределяем по категориям, фильтруя внутренние transfer'ы.
  for (const [txId, legs] of txCashLegs.entries()) {
    const kind = txKindMap.get(txId) || "unknown";
    let category = categoryOf(kind);
    // Internal эвристика: если категория = internal И netto cash-ног ≈ 0 →
    // оставляем internal (информационно). Если netto ≠ 0 (например transfer
    // с комиссией ушёл в expense — на cash осталось −fee) → переклассифицируем
    // в operating, т.к. это реальный отток.
    const sumBase = legs.reduce((s, l) => s + l.signedBase, 0);
    if (category === "internal" && Math.abs(sumBase) > 0.01) {
      category = "operating";
    }
    const bucket = sections[category];
    bucket.txCount += 1;
    bucket.byKind.set(kind, (bucket.byKind.get(kind) || 0) + sumBase);
    for (const leg of legs) {
      // Skip net-zero summing для internal — он информационный
      if (category !== "internal") {
        if (leg.signedBase > 0) bucket.inflowBase += leg.signedBase;
        else bucket.outflowBase += -leg.signedBase;
      }
      const e = leg.e;
      const amt = Math.abs(Number(e.amount) || 0);
      const ccyBucket = bucket.byCurrency.get(e.currency) || { currency: e.currency, inflow: 0, outflow: 0, net: 0, netBase: 0 };
      if (e.direction === "dr") ccyBucket.inflow += amt;
      else ccyBucket.outflow += amt;
      ccyBucket.net += leg.signedNative;
      ccyBucket.netBase += leg.signedBase;
      bucket.byCurrency.set(e.currency, ccyBucket);
    }
    bucket.netBase += sumBase;
  }

  // Opening / closing — то же что было, по trial balance на даты периода.
  const tb = trialBalance(ctx, { from: win.from, to: win.to }, officeFilter);
  let openingBase = 0;
  for (const cls of tb.classes) {
    for (const a of cls.accounts) {
      if (a.type === "asset" && CASH_SUBTYPES.has(a.subtype)) openingBase += a.openingInBase || 0;
    }
  }
  // Итоги — operating + financing + reconciliation (internal не учитываем).
  const includedCategories = ["operating", "financing", "reconciliation", "other"];
  let totalInflowBase = 0, totalOutflowBase = 0, totalNetBase = 0;
  for (const c of includedCategories) {
    totalInflowBase += sections[c].inflowBase;
    totalOutflowBase += sections[c].outflowBase;
    totalNetBase += sections[c].netBase;
  }
  const closingBase = openingBase + totalNetBase;
  const hasMovement = txCashLegs.size > 0;
  return { sections, totalInflowBase, totalOutflowBase, totalNetBase, openingBase, closingBase, hasMovement };
}

function kindLabel(kind, t) {
  return t(`trv2_journal_type_${kind}`, kind);
}

function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-[14px] border border-slate-200/70 p-4 ${className}`}>{children}</div>;
}

function CategorySection({ id, meta, data, baseCurrency, t, expanded, toggle }) {
  const open = expanded.has(id);
  const sign = data.netBase < 0 ? "rose" : "emerald";
  const isInternal = id === "internal";
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <div
        onClick={() => toggle(id)}
        className="px-3 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-slate-50"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-bold text-slate-900 uppercase tracking-wide">{meta.label}</div>
          <div className="text-[11px] text-slate-400">{meta.hint}</div>
        </div>
        <div className="text-right shrink-0">
          {isInternal ? (
            <div className="text-[12px] text-slate-400 tabular-nums">{data.txCount} tx · netto 0</div>
          ) : (
            <>
              <div className={`text-[15px] font-bold tabular-nums text-${sign}-600`}>{fmtSignedBase(data.netBase, baseCurrency)}</div>
              <div className="text-[10.5px] text-slate-400 tabular-nums">
                <span className="text-emerald-600">+{fmtBaseAmount(data.inflowBase, baseCurrency)}</span>
                <span className="mx-1">·</span>
                <span className="text-rose-600">−{fmtBaseAmount(data.outflowBase, baseCurrency)}</span>
              </div>
            </>
          )}
        </div>
      </div>
      {open && (
        <div className="px-4 py-2 bg-slate-50/30 space-y-2">
          {data.byKind.size === 0 ? (
            <div className="text-[12px] text-slate-400 py-1">—</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-wider">
                  <th className="text-left py-1 font-bold">Тип</th>
                  <th className="text-right py-1 font-bold">{isInternal ? "Оборот (info)" : "Нетто (в базовой)"}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.byKind.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([kind, net]) => (
                  <tr key={kind} className="border-t border-slate-100">
                    <td className="py-1 text-slate-700">{kindLabel(kind, t)}</td>
                    <td className={`py-1 text-right tabular-nums ${isInternal ? "text-slate-500" : (net < 0 ? "text-rose-600" : "text-emerald-600")}`}>{fmtSignedBase(net, baseCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.byCurrency.size > 0 && (
            <details className="text-[11.5px]">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800 py-1">по валютам</summary>
              <table className="w-full mt-1">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase tracking-wider">
                    <th className="text-left py-1 font-bold">Вал.</th>
                    <th className="text-right py-1 font-bold">+</th>
                    <th className="text-right py-1 font-bold">−</th>
                    <th className="text-right py-1 font-bold">Нетто</th>
                    <th className="text-right py-1 font-bold">В базе</th>
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

export default function CashFlowTab({ ctx, officeFilter, baseCurrency }) {
  const { t } = useTranslation();
  const [period, setPeriodState] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_cashflow_period") || "month"; } catch { return "month"; }
  });
  const setPeriod = (v) => { setPeriodState(v); try { localStorage.setItem("coinplata.treasury_cashflow_period", v); } catch {} };

  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);

  const cf = useMemo(() => buildCashFlow(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const [expanded, setExpanded] = useState(() => new Set(["operating"]));
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {!cf.hasMovement ? (
        <Card className="text-center text-[12.5px] text-slate-400 py-8">
          {t("trv2_cf_empty")}
        </Card>
      ) : (
        <>
          {/* Top summary */}
          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-[10px] bg-emerald-50 px-3 py-2.5">
                <div className="text-[11px] text-emerald-700">{t("trv2_cf_inflow")}</div>
                <div className="text-[19px] font-bold tabular-nums text-emerald-700">+{fmtBaseAmount(cf.totalInflowBase, baseCurrency)}</div>
              </div>
              <div className="rounded-[10px] bg-rose-50 px-3 py-2.5">
                <div className="text-[11px] text-rose-700">{t("trv2_cf_outflow")}</div>
                <div className="text-[19px] font-bold tabular-nums text-rose-700">−{fmtBaseAmount(cf.totalOutflowBase, baseCurrency)}</div>
              </div>
              <div className={`rounded-[10px] px-3 py-2.5 ${cf.totalNetBase < 0 ? "bg-rose-50" : "bg-slate-50"}`}>
                <div className="text-[11px] text-slate-500">{t("trv2_cf_net")}</div>
                <div className={`text-[19px] font-bold tabular-nums ${cf.totalNetBase < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(cf.totalNetBase, baseCurrency)}</div>
              </div>
            </div>
            <div className="mt-3 text-[12.5px] text-slate-600">
              {t("trv2_cf_opening")} <span className="font-semibold tabular-nums text-slate-900">{fmtBaseAmount(cf.openingBase, baseCurrency)}</span>
              {" → "}
              {t("trv2_cf_closing")} <span className="font-semibold tabular-nums text-slate-900">{fmtBaseAmount(cf.closingBase, baseCurrency)}</span>
              <span className="ml-2 text-[11px] text-slate-400">
                (внутренние переводы исключены — netto 0 по определению)
              </span>
            </div>
          </Card>

          {/* По активностям */}
          <Card className="!p-0">
            {CATEGORIES.map((id) => {
              const data = cf.sections[id];
              const hasAnything = data.byKind.size > 0 || data.byCurrency.size > 0;
              if (!hasAnything) return null;
              return (
                <CategorySection
                  key={id}
                  id={id}
                  meta={CATEGORY_META[id]}
                  data={data}
                  baseCurrency={baseCurrency}
                  t={t}
                  expanded={expanded}
                  toggle={toggle}
                />
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}
