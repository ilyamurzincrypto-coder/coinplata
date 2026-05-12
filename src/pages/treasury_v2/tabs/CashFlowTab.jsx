// src/pages/treasury_v2/tabs/CashFlowTab.jsx
// Treasury «Движение средств» (cash flow / ДДС) — for a period, the inflow / outflow
// of cash & crypto-wallet accounts (subtype ∈ {cash, crypto_input, crypto_output}),
// broken down by source category and by currency. Read-only.
import React, { useState, useMemo, useEffect } from "react";
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

// Build the cash-flow report from ctx + period (already-resolved {from,to} ISO strings).
function buildCashFlow(ctx, win, officeFilter) {
  const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
  const txEffMs = new Map((ctx.transactions || []).map((t) => [t.id, new Date(t.effectiveDate).getTime()]));
  const txKind = new Map((ctx.transactions || []).map((t) => [t.id, t.kind || "unknown"]));
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();

  let inflowBase = 0, outflowBase = 0;
  const byKind = new Map();    // kind -> netBase  (Σ Dr − Σ Cr on cash/crypto accounts, in base)
  const byCurrency = new Map(); // currency -> { currency, inflow, outflow, net, netBase }

  for (const e of ctx.entries || []) {
    const acc = accById.get(e.accountId);
    if (!acc || acc.type !== "asset" || !CASH_SUBTYPES.has(acc.subtype)) continue;
    if (!passesOffice(acc, officeFilter)) continue;
    const ts = txEffMs.has(e.transactionId) ? txEffMs.get(e.transactionId) : new Date(e.createdAt).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const amt = Number(e.amount) || 0;
    const signedNative = e.direction === "dr" ? amt : -amt; // money in = +, money out = −
    const signedBase = ctx.toBase(signedNative, e.currency) || 0;
    if (e.direction === "dr") { inflowBase += ctx.toBase(amt, e.currency) || 0; }
    else { outflowBase += ctx.toBase(amt, e.currency) || 0; }
    const kind = txKind.get(e.transactionId) || "unknown";
    byKind.set(kind, (byKind.get(kind) || 0) + signedBase);
    const cur = byCurrency.get(e.currency) || { currency: e.currency, inflow: 0, outflow: 0, net: 0, netBase: 0 };
    if (e.direction === "dr") cur.inflow += amt; else cur.outflow += amt;
    cur.net += signedNative;
    cur.netBase += signedBase;
    byCurrency.set(e.currency, cur);
  }

  // opening = sum of cash/crypto accounts' opening (in base) at period.from, via the trial balance
  const tb = trialBalance(ctx, { from: win.from, to: win.to }, officeFilter);
  let openingBase = 0;
  for (const cls of tb.classes) {
    for (const a of cls.accounts) {
      if (a.type === "asset" && CASH_SUBTYPES.has(a.subtype)) openingBase += a.openingInBase || 0;
    }
  }
  const netBase = inflowBase - outflowBase;
  const closingBase = openingBase + netBase;

  const categories = [...byKind.entries()]
    .map(([kind, net]) => ({ kind, net }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const currencies = [...byCurrency.values()].sort((a, b) => Math.abs(b.netBase) - Math.abs(a.netBase));
  const hasMovement = (ctx.entries || []).length > 0 && (categories.length > 0 || Math.abs(inflowBase) > 1e-9 || Math.abs(outflowBase) > 1e-9);

  return { inflowBase, outflowBase, netBase, openingBase, closingBase, categories, currencies, hasMovement };
}

function kindLabel(kind, t) {
  return t(`trv2_journal_type_${kind}`, kind);
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

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {!cf.hasMovement ? (
        <section className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">
          {t("trv2_cf_empty")}
        </section>
      ) : (
        <>
          {/* Top summary */}
          <section className="bg-white rounded-[14px] border border-slate-200/70 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-[10px] bg-emerald-50 px-3 py-2.5">
                <div className="text-[11px] text-emerald-700">{t("trv2_cf_inflow")}</div>
                <div className="text-[19px] font-bold tabular-nums text-emerald-700">+{fmtBaseAmount(cf.inflowBase, baseCurrency)}</div>
              </div>
              <div className="rounded-[10px] bg-rose-50 px-3 py-2.5">
                <div className="text-[11px] text-rose-700">{t("trv2_cf_outflow")}</div>
                <div className="text-[19px] font-bold tabular-nums text-rose-700">−{fmtBaseAmount(cf.outflowBase, baseCurrency)}</div>
              </div>
              <div className={`rounded-[10px] px-3 py-2.5 ${cf.netBase < 0 ? "bg-rose-50" : "bg-slate-50"}`}>
                <div className="text-[11px] text-slate-500">{t("trv2_cf_net")}</div>
                <div className={`text-[19px] font-bold tabular-nums ${cf.netBase < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(cf.netBase, baseCurrency)}</div>
              </div>
            </div>
            <div className="mt-3 text-[12.5px] text-slate-600">
              {t("trv2_cf_opening")} <span className="font-semibold tabular-nums text-slate-900">{fmtBaseAmount(cf.openingBase, baseCurrency)}</span>
              {" → "}
              {t("trv2_cf_closing")} <span className="font-semibold tabular-nums text-slate-900">{fmtBaseAmount(cf.closingBase, baseCurrency)}</span>
            </div>
          </section>

          {/* By source category */}
          <section className="bg-white rounded-[14px] border border-slate-200/70 p-4">
            <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_cf_by_category")}</h3>
            {cf.categories.length === 0 ? (
              <div className="text-[12px] text-slate-400">—</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {cf.categories.map((c) => (
                    <tr key={c.kind} className="border-t border-slate-100 first:border-t-0">
                      <td className="py-1.5 text-slate-700">{kindLabel(c.kind, t)}</td>
                      <td className={`py-1.5 text-right tabular-nums font-medium ${c.net < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(c.net, baseCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* By currency */}
          <section className="bg-white rounded-[14px] border border-slate-200/70 p-4">
            <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_cf_by_currency")}</h3>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[11px] text-slate-400 text-right">
                  <th className="py-1 text-left font-medium">{t("trv2_col_currency")}</th>
                  <th className="py-1 font-medium">{t("trv2_cf_inflow")}</th>
                  <th className="py-1 font-medium">{t("trv2_cf_outflow")}</th>
                  <th className="py-1 font-medium">{t("trv2_cf_net")}</th>
                  <th className="py-1 font-medium">{t("trv2_col_in_base")}</th>
                </tr>
              </thead>
              <tbody>
                {cf.currencies.map((c) => (
                  <tr key={c.currency} className="border-t border-slate-100">
                    <td className="py-1.5 text-left font-semibold text-slate-700">{c.currency}</td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-700">+{fmtCur(c.inflow, c.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums text-rose-700">−{fmtCur(c.outflow, c.currency)}</td>
                    <td className={`py-1.5 text-right tabular-nums font-medium ${c.net < 0 ? "text-rose-600" : "text-slate-900"}`}>{fmtSignedCur(c.net, c.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{fmtSignedBase(c.netBase, baseCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
