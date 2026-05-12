// src/pages/treasury_v2/tabs/DealsTab.jsx
// Treasury "Сделки" tab — the accounting deal report. All offices (respects the
// Treasury office picker), real-time. Each deal row shows the «пришло → ушло · спред»
// one-liner collapsed; expanded → the Dr/Cr <TransactionEntries> tree (this IS the
// bookkeeping view — the manager-language version lives on the Cashier main page).
// Type chips default to "deal" but can be widened (all / transfer / topup / …).
import React, { useState, useMemo, useEffect } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { transactionTree, nodeMatchesSearch } from "../../../lib/treasury/v2selectors.js";
import { dealSummary } from "../../../lib/treasury/dealSummary.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import TransactionRow from "../parts/TransactionRow.jsx";

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

export default function DealsTab({ ctx, officeFilter, onOpenSource }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_deals_period") || "30d"; } catch { return "30d"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_deals_period", v); } catch {} };
  const [typeFilter, setTypeFilter] = useState("deal");

  // Free-text search across the (already period/type-filtered) tree, debounced ~200ms.
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [searchRaw]);

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
  const summaryOf = (node) => (node.tx.kind === "deal" ? formatDealSummary(dealSummary(node, accById), t) : null);
  const filtered = useMemo(
    () => (search ? tree.filter((n) => nodeMatchesSearch(n, search, ctx, accById, summaryOf(n) || "")) : tree),
    [tree, search, ctx, accById, t]
  );

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
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
        <div className="flex items-center gap-1.5 min-w-[200px] flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder={t("trv2_search_placeholder")}
            className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1 text-[12px] outline-none"
          />
        </div>
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">
            {search ? t("trv2_search_no_results") : t("trv2_journal_no_tx")}
          </div>
        ) : (
          filtered.map((node) => (
            <TransactionRow
              key={node.tx.id}
              node={node}
              onOpenSource={onOpenSource}
              summaryLine={summaryOf(node)}
            />
          ))
        )}
      </section>
    </div>
  );
}
