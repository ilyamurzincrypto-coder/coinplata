// src/pages/treasury_v2/tabs/PnLTab.jsx
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { pnlForPeriod } from "../../../lib/treasury/v2selectors.js";
import { mergePnlSection, csvRowsForPnl } from "../../../lib/treasury/pnlCompare.js";
import { exportCSV } from "../../../utils/csv.js";
import PeriodPicker, { presetWindow, previousWindow } from "../PeriodPicker.jsx";
import PeriodCloseModal from "../parts/PeriodCloseModal.jsx";

const fmtSigned = (formatBase, baseCurrency, n) => `${n < 0 ? "−" : ""}${formatBase(Math.abs(n), baseCurrency)}`;

function Section({ titleKey, total, prevTotal, sign, formatBase, baseCurrency, accounts, prevAccounts }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const compare = prevAccounts != null;
  const rows = compare ? mergePnlSection(accounts, prevAccounts) : null;
  const isEmpty = compare ? rows.length === 0 : accounts.length === 0;
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <h3 className="text-[13px] font-bold text-slate-900">{t(titleKey)}</h3>
        <span className="text-[13.5px] font-semibold tabular-nums flex items-center gap-3">
          <span>{sign}{formatBase(Math.abs(total), baseCurrency)}</span>
          {compare && (
            <>
              <span className="text-slate-400 text-[12px]">{t("trv2_pnl_col_prev")} {sign}{formatBase(Math.abs(prevTotal || 0), baseCurrency)}</span>
              <span className={`text-[12px] ${(total - (prevTotal || 0)) < 0 ? "text-rose-600" : "text-emerald-700"}`}>Δ {fmtSigned(formatBase, baseCurrency, total - (prevTotal || 0))}</span>
            </>
          )}
        </span>
      </header>
      {open && (isEmpty ? (
        <div className="px-4 py-3 text-[12px] text-slate-400">—</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {(compare ? rows : accounts).map((a) => (
              <tr key={a.code} className="border-t border-slate-100">
                <td className="px-4 py-2"><span className="font-mono text-[11px] text-slate-400 mr-2">{a.code}</span>{a.name}</td>
                <td className="px-4 py-2 text-right text-slate-400 text-[11px] w-16">{a.entryCount}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium w-32">{fmtSigned(formatBase, baseCurrency, a.amountInBase)}</td>
                {compare && <td className="px-4 py-2 text-right tabular-nums text-slate-400 w-32">{fmtSigned(formatBase, baseCurrency, a.prevInBase)}</td>}
                {compare && <td className={`px-4 py-2 text-right tabular-nums w-28 ${a.delta < 0 ? "text-rose-600" : "text-emerald-700"}`}>Δ {fmtSigned(formatBase, baseCurrency, a.delta)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}

export default function PnLTab({ ctx, officeFilter, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const can = useCan();
  const [closeOpen, setCloseOpen] = useState(false);
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_pnl_period") || "month"; } catch { return "month"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_pnl_period", v); } catch {} };
  const [compare, setCompare] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_pnl_compare") === "1"; } catch { return false; }
  });
  const toggleCompare = () => { const v = !compare; setCompare(v); try { localStorage.setItem("coinplata.treasury_pnl_compare", v ? "1" : "0"); } catch {} };

  const win = useMemo(() => presetWindow(period), [period]);
  const prevWin = useMemo(() => previousWindow(win), [win.from, win.to]);
  const needFrom = compare ? prevWin.from : win.from;
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(needFrom) < new Date(ctx.sinceIso)) ctx.extendWindow(needFrom);
  }, [needFrom, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(needFrom) < new Date(ctx.sinceIso);

  const pnl = useMemo(() => pnlForPeriod(ctx, { from: win.from, to: win.to }, officeFilter), [ctx, win.from, win.to, officeFilter]);
  const pnlPrev = useMemo(() => (compare ? pnlForPeriod(ctx, { from: prevWin.from, to: prevWin.to }, officeFilter) : null), [compare, ctx, prevWin.from, prevWin.to, officeFilter]);
  const hasAnything = pnl.revenue.accounts.length || pnl.expense.accounts.length || pnl.fxAccounts.length;
  const prevHasAnything = pnlPrev && (pnlPrev.revenue.accounts.length || pnlPrev.expense.accounts.length || pnlPrev.fxAccounts.length);

  function doExport() {
    const cmp = compare && pnlPrev;
    const columns = [
      { key: "section", label: "section" }, { key: "code", label: "code" }, { key: "name", label: "name" },
      { key: "currency", label: t("trv2_to_col_currency") }, { key: "amount", label: "amount_base" }, { key: "entryCount", label: "entries" },
    ];
    if (cmp) { columns.push({ key: "amountPrev", label: t("trv2_pnl_col_prev") }, { key: "delta", label: t("trv2_pnl_col_delta") }); }
    const f = win.from.slice(0, 10), tt = win.to.slice(0, 10);
    exportCSV({ filename: cmp ? `pnl_${f}_${tt}_vs_${prevWin.from.slice(0, 10)}.csv` : `pnl_${f}_${tt}.csv`, columns, rows: csvRowsForPnl(pnl, cmp ? pnlPrev : null) });
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex-1" />
        <button onClick={toggleCompare} className={`px-2.5 py-1 rounded-[8px] text-[12px] font-medium ${compare ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{t("trv2_pnl_compare")}</button>
        <button onClick={doExport} className="px-2.5 py-1 rounded-[8px] text-[12px] bg-slate-100 text-slate-700 hover:bg-slate-200">{t("trv2_pnl_export_csv")}</button>
        {can("accounting", "edit") && (
          <button onClick={() => setCloseOpen(true)} className="px-2.5 py-1 rounded-[8px] text-[12px] bg-slate-100 text-slate-700 hover:bg-slate-200">{t("trv2_pc_button")}</button>
        )}
      </div>
      {closeOpen && <PeriodCloseModal open onClose={() => setCloseOpen(false)} />}
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      {!hasAnything && !prevHasAnything ? (
        <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_pnl_no_data")}</div>
      ) : (
        <>
          <Section titleKey="trv2_pnl_revenue" total={pnl.revenue.total} prevTotal={pnlPrev?.revenue.total} sign="+" accounts={pnl.revenue.accounts} prevAccounts={compare ? (pnlPrev?.revenue.accounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_expense" total={pnl.expense.total} prevTotal={pnlPrev?.expense.total} sign="−" accounts={pnl.expense.accounts} prevAccounts={compare ? (pnlPrev?.expense.accounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_fx" total={pnl.fxNet} prevTotal={pnlPrev?.fxNet} sign={pnl.fxNet < 0 ? "−" : "+"} accounts={pnl.fxAccounts} prevAccounts={compare ? (pnlPrev?.fxAccounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <div className="bg-slate-900 text-white rounded-[14px] px-5 py-4 flex items-center justify-between flex-wrap gap-2">
            <span className="text-[14px] font-bold">{t("trv2_pnl_net_profit")}</span>
            <span className="flex items-center gap-4">
              <span className={`text-[20px] font-bold tabular-nums ${pnl.netProfit < 0 ? "text-rose-400" : "text-emerald-400"}`}>{fmtSigned(formatBase, baseCurrency, pnl.netProfit)}</span>
              {compare && pnlPrev && (
                <>
                  <span className="text-[12.5px] text-slate-400">{t("trv2_pnl_col_prev")} {fmtSigned(formatBase, baseCurrency, pnlPrev.netProfit)}</span>
                  <span className={`text-[12.5px] ${(pnl.netProfit - pnlPrev.netProfit) < 0 ? "text-rose-400" : "text-emerald-400"}`}>Δ {fmtSigned(formatBase, baseCurrency, pnl.netProfit - pnlPrev.netProfit)}</span>
                </>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
