// src/pages/treasury_v2/tabs/CashFlowTab.jsx
// Treasury «Движение средств» (ДДС) по стандарту IFRS / IAS 7 — 3 секции:
//
//   1. ОПЕРАЦИОННАЯ ДЕЯТЕЛЬНОСТЬ
//      Основной бизнес-flow обменника:
//        • сделки (deal/exchange) — приём/выдача валют клиентам
//        • доходы и расходы (income/expense) — комиссии, зарплаты, аренда
//        • settle/reverse — закрытие обязательств и сторно
//        • inline-правки на обязательствах перед клиентами/партнёрами
//          (working capital changes)
//
//   2. ИНВЕСТИЦИОННАЯ ДЕЯТЕЛЬНОСТЬ
//      Для типового обменника обычно пуста. Сюда попало бы:
//        • покупка/продажа оборудования, ПО
//        • вложения в долговременные активы
//      По умолчанию показываем «0», секция всегда есть для парности отчёта.
//
//   3. ФИНАНСОВАЯ ДЕЯТЕЛЬНОСТЬ
//      Поток капитала и финансирования:
//        • пополнения извне (topup) — собственник кладёт деньги
//        • изъятия (withdrawal)
//        • открывающие остатки (opening)
//        • inline-правки на кассе/крипте с корр-счётом equity
//          (по сути «собственник довложил/изъял» с пометкой)
//
// Внутренние переводы cash↔cash (transfer) — отфильтрованы. По IFRS они
// netto 0 и не влияют на cash, в отчёте не светятся.
//
// Внизу — стандартное тождество:
//   Cash at beginning + Σ activities = Cash at end
import React, { useState, useMemo, useEffect } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { trialBalance } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

const CASH_SUBTYPES = new Set(["cash", "crypto_input", "crypto_output"]);

const fmtBaseAmount = (n, baseCurrency) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency}`;
const fmtSignedBase = (n, baseCurrency) => `${n < 0 ? "−" : ""}${fmtBaseAmount(Math.abs(n), baseCurrency)}`;
const fmtCur = (amount, currency) => `${curSymbol(currency)}${fmt(amount, currency)}${curSymbol(currency) ? "" : ` ${currency}`}`;
const fmtSignedCur = (amount, currency) => `${amount < 0 ? "−" : ""}${fmtCur(Math.abs(amount), currency)}`;

function passesOffice(acc, officeFilter) {
  if (officeFilter === "all" || !officeFilter) return true;
  return acc.officeId === officeFilter;
}

const isCash = (acc) => !!acc && acc.type === "asset" && CASH_SUBTYPES.has(acc.subtype);

// Прямые мапы — для типов транзакций где категория однозначна.
const OPERATING_KINDS = new Set([
  "deal", "deal_v2", "exchange", "exchange_in", "exchange_out",
  "income", "expense", "settle", "reverse", "reversal",
]);
const FINANCING_KINDS = new Set(["topup", "withdrawal", "opening"]);
const INTERNAL_KINDS = new Set(["transfer", "transfer_in", "transfer_out"]);

// Решает в какую IFRS-секцию пихнуть транзакцию.
//   kind — source_kind транзакции
//   nonCashLegs — все её non-cash entries (нужны чтобы понять корр-счёт
//                 для adjustment/manual)
//   sumCashBase — сумма cash-ног в base (для internal-эвристики)
// Возвращает 'operating' | 'investing' | 'financing' | 'internal'.
function categorizeTx(kind, nonCashLegs, sumCashBase) {
  // Internal: чисто переброс cash↔cash без сторонних ног
  if (INTERNAL_KINDS.has(kind) && nonCashLegs.length === 0 && Math.abs(sumCashBase) < 0.01) {
    return "internal";
  }
  // adjustment / manual — категория решается по типу корр-счёта
  if (kind === "adjustment" || kind === "manual") {
    // Берём первый non-cash leg как корр-счёт (для inline-edit пара 2 ноги,
    // одна cash, одна — equity/liability/etc).
    const counter = nonCashLegs[0]?.acc;
    if (!counter) return "operating"; // вырожденный случай — обе ноги cash
    if (counter.type === "liability") return "operating";   // working capital
    if (counter.type === "revenue") return "operating";
    if (counter.type === "expense") return "operating";
    if (counter.type === "equity") return "financing";      // owner/opening
    if (counter.type === "asset") return "operating";       // переброс между активами
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

  // По каждой транзакции собираем cash-ноги (для inflow/outflow) и
  // non-cash ноги (для категоризации adjustment/manual по корр-счёту).
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
  const sections = {};
  for (const c of SECTIONS) {
    sections[c] = {
      inflowBase: 0,
      outflowBase: 0,
      netBase: 0,
      txCount: 0,
      byKind: new Map(),
      byCurrency: new Map(),
    };
  }

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
    for (const leg of cashLegs) {
      if (leg.signedBase > 0) bucket.inflowBase += leg.signedBase;
      else bucket.outflowBase += -leg.signedBase;
      const e = leg.e;
      const amt = Math.abs(Number(e.amount) || 0);
      const ccyBucket = bucket.byCurrency.get(e.currency) || { currency: e.currency, inflow: 0, outflow: 0, net: 0, netBase: 0 };
      if (e.direction === "dr") ccyBucket.inflow += amt;
      else ccyBucket.outflow += amt;
      ccyBucket.net += leg.signedNative;
      ccyBucket.netBase += leg.signedBase;
      bucket.byCurrency.set(e.currency, ccyBucket);
    }
    bucket.netBase += sumCashBase;
  }

  // Opening / closing — по trial balance на даты периода.
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

  return { sections, totalNetBase, openingBase, closingBase, hasMovement, internalTxCount };
}

function kindLabel(kind, t) {
  return t(`trv2_journal_type_${kind}`, kind);
}

function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-[14px] border border-slate-200/70 p-4 ${className}`}>{children}</div>;
}

const SECTION_META = {
  operating: {
    label: "Операционная деятельность",
    hint: "Сделки, доходы, расходы, изменения в обязательствах перед клиентами.",
  },
  investing: {
    label: "Инвестиционная деятельность",
    hint: "Долгосрочные активы (оборудование, ПО, инвестиции). Для типового обменника обычно пусто.",
  },
  financing: {
    label: "Финансовая деятельность",
    hint: "Пополнения собственника, изъятия, открывающие остатки, реклассификации капитала.",
  },
};

function CategorySection({ id, meta, data, baseCurrency, t, expanded, toggle }) {
  const open = expanded.has(id);
  const sign = data.netBase < 0 ? "rose" : data.netBase > 0 ? "emerald" : "slate";
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <div
        onClick={() => toggle(id)}
        className="px-3 py-3 flex items-center gap-2 cursor-pointer hover:bg-slate-50"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-slate-900 uppercase tracking-wide">{meta.label}</div>
          <div className="text-[11px] text-slate-400">{meta.hint}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-[16px] font-bold tabular-nums text-${sign}-600`}>{fmtSignedBase(data.netBase, baseCurrency)}</div>
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
          {data.byKind.size === 0 ? (
            <div className="text-[12px] text-slate-400 py-1">Движений в этой секции нет за период.</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-wider">
                  <th className="text-left py-1 font-bold">Тип операции</th>
                  <th className="text-right py-1 font-bold">Нетто (в базовой)</th>
                </tr>
              </thead>
              <tbody>
                {[...data.byKind.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([kind, net]) => (
                  <tr key={kind} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-700">{kindLabel(kind, t)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${net < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(net, baseCurrency)}</td>
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
        <span className="text-[11px] text-slate-400">Стандарт: IAS 7 · 3 секции</span>
      </div>

      {!cf.hasMovement ? (
        <Card className="text-center text-[12.5px] text-slate-400 py-8">
          {t("trv2_cf_empty")}
        </Card>
      ) : (
        <>
          {/* IFRS-style: 3 секции, опускаются сверху вниз. */}
          <Card className="!p-0">
            <CategorySection id="operating" meta={SECTION_META.operating} data={cf.sections.operating} baseCurrency={baseCurrency} t={t} expanded={expanded} toggle={toggle} />
            <CategorySection id="investing" meta={SECTION_META.investing} data={cf.sections.investing} baseCurrency={baseCurrency} t={t} expanded={expanded} toggle={toggle} />
            <CategorySection id="financing" meta={SECTION_META.financing} data={cf.sections.financing} baseCurrency={baseCurrency} t={t} expanded={expanded} toggle={toggle} />
            {/* Итоговое тождество */}
            <div className="border-t-2 border-slate-200 px-4 py-3 bg-slate-50/50">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px]">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Чистое изменение денежных средств</span>
                <span className={`text-[18px] font-bold tabular-nums ml-auto ${cf.totalNetBase < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(cf.totalNetBase, baseCurrency)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px] text-slate-600">
                <span><span className="text-slate-500">Денежные средства на начало периода:</span> <span className="font-semibold tabular-nums text-slate-900">{fmtBaseAmount(cf.openingBase, baseCurrency)}</span></span>
                <span className="text-slate-400">+</span>
                <span><span className="text-slate-500">изменение:</span> <span className="font-semibold tabular-nums text-slate-900">{fmtSignedBase(cf.totalNetBase, baseCurrency)}</span></span>
                <span className="text-slate-400">=</span>
                <span><span className="text-slate-500">на конец периода:</span> <span className="font-bold tabular-nums text-slate-900">{fmtBaseAmount(cf.closingBase, baseCurrency)}</span></span>
              </div>
              {cf.internalTxCount > 0 && (
                <div className="mt-2 text-[10.5px] text-slate-400">
                  Внутренние переводы между нашими счетами ({cf.internalTxCount} шт.) — исключены, netto 0.
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
