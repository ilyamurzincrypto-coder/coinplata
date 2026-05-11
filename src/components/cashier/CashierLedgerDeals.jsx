// src/components/cashier/CashierLedgerDeals.jsx
// The Cashier's transactions list — read straight from the v2 ledger
// (ledger.transactions / journal_entries via LedgerProvider), so an operator
// sees the deals they just created (which now go to ledger.*, not public.deals).
// Mirrors JournalTab's structure: PeriodPicker + type chips + transactionTree +
// TransactionRow, plus a one-line «пришло → ушло · спред» summary on deal rows.
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useLedger } from "../../store/ledger.jsx";
import { transactionTree } from "../../lib/treasury/v2selectors.js";
import { dealSummary } from "../../lib/treasury/dealSummary.js";
import PeriodPicker, { presetWindow } from "../../pages/treasury_v2/PeriodPicker.jsx";
import TransactionRow from "../../pages/treasury_v2/parts/TransactionRow.jsx";

const TYPES = ["deal", "all", "transfer", "topup", "adjustment", "manual", "reversal"];
const fmtAmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function formatDealSummary(s, t) {
  if (!s) return null;
  const leg = (l) => `${fmtAmt(l.amount)} ${l.currency}${l.accountName ? ` (${l.accountName})` : ""}`;
  const sides = [];
  if (s.in.length) sides.push(`${t("cashier_deal_in")} ${s.in.map(leg).join(" + ")}`);
  if (s.out.length) sides.push(`${t("cashier_deal_out")} ${s.out.map(leg).join(" + ")}`);
  let line = sides.join(" → ");
  if (s.margin.length) line += ` · ${t("cashier_deal_margin")} ${s.margin.map((m) => `${fmtAmt(m.amount)} ${m.currency}`).join(" + ")}`;
  return line || null;
}

export default function CashierLedgerDeals({ officeFilter }) {
  const { t } = useTranslation();
  const ctx = useLedger();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.cashier_deals_period") || "30d"; } catch { return "30d"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.cashier_deals_period", v); } catch {} };
  const [typeFilter, setTypeFilter] = useState("deal");

  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  const tree = useMemo(
    () => transactionTree(ctx, { type: typeFilter, officeFilter, period: { from: win.from, to: win.to } }),
    [ctx, typeFilter, officeFilter, win.from, win.to]
  );
  const accById = useMemo(() => new Map((ctx.accounts || []).map((a) => [a.id, a])), [ctx.accounts]);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <span className="text-[13px] font-semibold text-slate-700">{t("cashier_deals_title")}</span>
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex items-center gap-1.5">
          {TYPES.map((tp) => (
            <button
              key={tp}
              onClick={() => setTypeFilter(tp)}
              className={`px-2 py-1 rounded-[8px] text-[11px] font-medium ${typeFilter === tp ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t(`trv2_journal_type_${tp}`)}
            </button>
          ))}
        </div>
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_journal_no_tx")}</div>
        ) : (
          tree.map((node) => (
            <TransactionRow
              key={node.tx.id}
              node={node}
              summaryLine={node.tx.kind === "deal" ? formatDealSummary(dealSummary(node, accById), t) : null}
            />
          ))
        )}
      </section>
    </div>
  );
}
