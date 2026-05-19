// src/pages/treasury_v2/tabs/PnLTab.jsx
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { pnlForPeriod } from "../../../lib/treasury/v2selectors.js";
import { mergePnlSection, csvRowsForPnl } from "../../../lib/treasury/pnlCompare.js";
import { exportCSV } from "../../../utils/csv.js";
import PeriodPicker, { presetWindow, previousWindow } from "../PeriodPicker.jsx";
import PeriodCloseModal from "../parts/PeriodCloseModal.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";

const fmtSigned = (formatBase, baseCurrency, n) => `${n < 0 ? "−" : ""}${formatBase(Math.abs(n), baseCurrency)}`;

function Section({ titleKey, total, prevTotal, sign, formatBase, baseCurrency, accounts, prevAccounts }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const compare = prevAccounts != null;
  const rows = compare ? mergePnlSection(accounts, prevAccounts) : null;
  const isEmpty = compare ? rows.length === 0 : accounts.length === 0;
  return (
    <section className="bg-surface rounded-card overflow-hidden">
      <header className="px-card py-2.5 bg-surface-soft/40 border-b border-border-soft flex items-center justify-between cursor-pointer hover:bg-surface-soft transition-colors" onClick={() => setOpen((v) => !v)}>
        <h3 className="text-h3 text-ink font-semibold">{t(titleKey)}</h3>
        <span className="text-body-sm font-mono tabular font-bold text-ink flex items-center gap-3">
          <span>{sign}{formatBase(Math.abs(total), baseCurrency)}</span>
          {compare && (
            <>
              <span className="text-muted-soft text-caption">{t("trv2_pnl_col_prev")} {sign}{formatBase(Math.abs(prevTotal || 0), baseCurrency)}</span>
              <span className={`text-caption font-semibold ${(total - (prevTotal || 0)) < 0 ? "text-danger" : "text-success"}`}>Δ {fmtSigned(formatBase, baseCurrency, total - (prevTotal || 0))}</span>
            </>
          )}
        </span>
      </header>
      {open && (isEmpty ? (
        <div className="px-card py-3 text-caption text-muted-soft">—</div>
      ) : (
        <table className="w-full text-body-sm">
          <tbody>
            {(compare ? rows : accounts).map((a) => (
              <tr key={a.code} className="border-t border-border-soft hover:bg-surface-soft transition-colors">
                <td className="px-card py-2 text-ink"><span className="font-mono text-tiny text-muted-soft mr-2">{a.code}</span>{a.name}</td>
                <td className="px-card py-2 text-right text-muted-soft text-tiny font-mono w-16">{a.entryCount}</td>
                <td className="px-card py-2 text-right font-mono tabular font-semibold text-ink w-32">{fmtSigned(formatBase, baseCurrency, a.amountInBase)}</td>
                {compare && <td className="px-card py-2 text-right font-mono tabular text-muted-soft w-32">{fmtSigned(formatBase, baseCurrency, a.prevInBase)}</td>}
                {compare && <td className={`px-card py-2 text-right font-mono tabular font-semibold w-28 ${a.delta < 0 ? "text-danger" : "text-success"}`}>Δ {fmtSigned(formatBase, baseCurrency, a.delta)}</td>}
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
  const [addOpen, setAddOpen] = useState(false);
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
      <div className="bg-surface rounded-card p-3 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggleCompare}
          className={`h-7 px-2.5 rounded-button text-caption font-semibold transition-colors ${
            compare ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
          }`}
        >
          {t("trv2_pnl_compare")}
        </button>
        <button
          type="button"
          onClick={doExport}
          className="h-7 px-2.5 rounded-button text-caption font-semibold bg-surface-sunk text-ink-soft hover:bg-surface-soft transition-colors"
        >
          {t("trv2_pnl_export_csv")}
        </button>
        {can("accounting", "edit") && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="h-7 px-2.5 rounded-button text-caption font-semibold bg-surface-sunk text-ink-soft hover:bg-surface-soft transition-colors"
          >
            {t("trv2_chart_add_btn")}
          </button>
        )}
        {can("accounting", "edit") && (
          <button
            type="button"
            onClick={() => setCloseOpen(true)}
            className="h-7 px-2.5 rounded-button text-caption font-semibold bg-surface-sunk text-ink-soft hover:bg-surface-soft transition-colors"
          >
            {t("trv2_pc_button")}
          </button>
        )}
      </div>
      {closeOpen && <PeriodCloseModal open onClose={() => setCloseOpen(false)} />}
      {addOpen && <ChartAccountModal open defaultType="expense" onClose={() => setAddOpen(false)} />}
      {truncated && (
        <div className="rounded-card px-card py-2 text-caption bg-warning-soft text-warning border border-warning/20">{t("trv2_window_partial")}</div>
      )}
      {!hasAnything && !prevHasAnything ? (
        <div className="bg-surface rounded-card px-card py-8 text-center text-body-sm text-muted">{t("trv2_pnl_no_data")}</div>
      ) : (
        <>
          <Section titleKey="trv2_pnl_revenue" total={pnl.revenue.total} prevTotal={pnlPrev?.revenue.total} sign="+" accounts={pnl.revenue.accounts} prevAccounts={compare ? (pnlPrev?.revenue.accounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_expense" total={pnl.expense.total} prevTotal={pnlPrev?.expense.total} sign="−" accounts={pnl.expense.accounts} prevAccounts={compare ? (pnlPrev?.expense.accounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_fx" total={pnl.fxNet} prevTotal={pnlPrev?.fxNet} sign={pnl.fxNet < 0 ? "−" : "+"} accounts={pnl.fxAccounts} prevAccounts={compare ? (pnlPrev?.fxAccounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <div className="bg-ink text-white rounded-card px-5 py-4 flex items-center justify-between flex-wrap gap-2 shadow-soft-deep">
            <span className="text-body font-bold">{t("trv2_pnl_net_profit")}</span>
            <span className="flex items-center gap-4">
              <span className={`text-[20px] font-bold font-mono tabular ${pnl.netProfit < 0 ? "text-rose-400" : "text-accent-glow"}`}>{fmtSigned(formatBase, baseCurrency, pnl.netProfit)}</span>
              {compare && pnlPrev && (
                <>
                  <span className="text-body-sm text-white/60 font-mono tabular">{t("trv2_pnl_col_prev")} {fmtSigned(formatBase, baseCurrency, pnlPrev.netProfit)}</span>
                  <span className={`text-body-sm font-mono tabular font-semibold ${(pnl.netProfit - pnlPrev.netProfit) < 0 ? "text-rose-400" : "text-accent-glow"}`}>Δ {fmtSigned(formatBase, baseCurrency, pnl.netProfit - pnlPrev.netProfit)}</span>
                </>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
