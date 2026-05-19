// src/pages/treasury_v2/parts/TrialBalanceTable.jsx
// Оборотно-сальдовая ведомость for a period: per-class sections, expandable account
// rows (→ AccountInlineEntries filtered to the window), a balance-check footer, CSV export.
import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Search } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { trialBalance } from "../../../lib/treasury/v2selectors.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountInlineEntries from "./AccountInlineEntries.jsx";
import TrialBalanceSubcontoRow from "./TrialBalanceSubcontoRow.jsx";

const num = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function AccountRow({ ctx, window: win, row, onOpenTx }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-border-soft hover:bg-surface-soft cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <td className="px-2 py-1.5 w-6 text-muted-soft">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
        <td className="px-2 py-1.5 font-mono text-[11px] text-muted-soft w-14">{row.code}</td>
        <td className="px-2 py-1.5 text-[12.5px] text-ink">{row.name}</td>
        <td className="px-2 py-1.5 text-muted w-12">{row.currency}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28">{num(row.opening)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-success">{num(row.debitTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-danger">{num(row.creditTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 font-medium">{num(row.closing)}</td>
      </tr>
      {open && (row.dims
        ? (row.dims.length === 0
            ? <tr><td colSpan={8} className="px-6 py-2 text-[11px] text-muted-soft">—</td></tr>
            : row.dims.map((d, i) => (
                <TrialBalanceSubcontoRow key={`${d.clientId || ""}-${d.partnerId || ""}-${i}`} ctx={ctx} accountId={row.accountId} dim={d} window={win} onOpenTx={onOpenTx} />
              )))
        : <tr><td colSpan={8} className="p-0"><AccountInlineEntries ctx={ctx} accountId={row.accountId} period={win} onOpenTx={onOpenTx} /></td></tr>)}
    </>
  );
}

export default function TrialBalanceTable({ ctx, window: win, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const tb = useMemo(() => trialBalance(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const allRows = tb.classes.flatMap((c) => c.accounts);
  // Client-side "find" over account rows by code or name. Purely a viewport filter:
  // class subtotals, the grand total, and the balance-check chips keep showing the
  // true whole-ledger figures (they're explicitly labelled), so the books still
  // visibly reconcile even while a filter is active.
  const [q, setQ] = useState("");
  const nq = q.trim().toLowerCase();
  const matches = (a) => !nq || String(a.code).toLowerCase().includes(nq) || String(a.name).toLowerCase().includes(nq);
  const visibleClasses = tb.classes
    .map((c) => ({ ...c, _rows: c.accounts.filter(matches) }))
    .filter((c) => c._rows.length > 0);
  const visibleCount = visibleClasses.reduce((s, c) => s + c._rows.length, 0);

  function doExport() {
    exportCSV({
      filename: `osv_${(win.from || "").slice(0, 10)}_${(win.to || "").slice(0, 10)}.csv`,
      columns: [
        { key: "class", label: t("trv2_to_col_account") + " class" },
        { key: "code", label: "code" },
        { key: "name", label: t("trv2_to_col_account") },
        { key: "currency", label: t("trv2_to_col_currency") },
        { key: "opening", label: t("trv2_to_col_opening") },
        { key: "debit", label: t("trv2_to_col_debit") },
        { key: "credit", label: t("trv2_to_col_credit") },
        { key: "closing", label: t("trv2_to_col_closing") },
      ],
      rows: tb.classes.flatMap((c) => c.accounts.map((a) => ({
        class: t(c.labelKey), code: a.code, name: a.name, currency: a.currency,
        opening: a.opening, debit: a.debitTurnover, credit: a.creditTurnover, closing: a.closing,
      }))),
    });
  }

  if (allRows.length === 0) {
    return <div className="bg-white rounded-card-lg border border-border-soft px-4 py-8 text-center text-[12.5px] text-muted-soft">{t("trv2_to_empty_osv")}</div>;
  }

  const chip = (ok) => ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-surface-soft border border-border-soft rounded-button px-2 py-1 min-w-[220px] max-w-[320px] flex-1">
          <Search className="w-3.5 h-3.5 text-muted-soft shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("trv2_to_filter_ph")}
            className="flex-1 min-w-0 bg-transparent text-[12px] outline-none"
          />
          {nq && <button onClick={() => setQ("")} className="shrink-0 text-muted-soft hover:text-ink-soft text-[12px]" title={t("trv2_to_filter_clear")}>×</button>}
        </div>
        {nq && <span className="text-[11px] text-muted-soft">{t("trv2_to_filter_count")} {visibleCount} / {allRows.length}</span>}
        <div className="flex-1" />
        <button onClick={doExport} className="text-[12px] px-2.5 py-1 rounded-button bg-surface-sunk text-ink-soft hover:bg-surface-sunk">{t("trv2_to_export_csv")}</button>
      </div>
      {nq && visibleClasses.length === 0 ? (
        <div className="bg-white rounded-card-lg border border-border-soft px-4 py-8 text-center text-[12.5px] text-muted-soft">{t("trv2_to_filter_no_match")}</div>
      ) : (
      <div className="bg-white rounded-card-lg border border-border-soft overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-surface-soft text-muted-soft text-[10px] uppercase tracking-wider">
              <th className="w-6" /><th className="text-left px-2 py-1.5">{t("trv2_to_col_account")}</th><th /><th className="text-left px-2 py-1.5">{t("trv2_to_col_currency")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_opening")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_debit")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_credit")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_closing")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleClasses.map((cls) => (
              <React.Fragment key={cls.type}>
                <tr className="bg-surface-sunk/70">
                  <td className="px-2 py-1.5" colSpan={4}><span className="font-bold text-[12px] text-ink-soft">{t(cls.labelKey)}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-muted">{formatBase(cls.subtotalInBase.opening, baseCurrency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-muted">{formatBase(cls.subtotalInBase.debitTurnover, baseCurrency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-muted">{formatBase(cls.subtotalInBase.creditTurnover, baseCurrency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-muted">{formatBase(cls.subtotalInBase.closing, baseCurrency)}</td>
                </tr>
                {cls._rows.map((row) => <AccountRow key={row.accountId} ctx={ctx} window={win} row={row} onOpenTx={onOpenTx} />)}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-ink text-white">
              <td className="px-2 py-2" colSpan={4}><span className="font-bold text-[12px]">{t("trv2_to_total")}</span></td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.openingDr, baseCurrency)} / {formatBase(tb.totalInBase.openingCr, baseCurrency)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.debitTurnover, baseCurrency)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.creditTurnover, baseCurrency)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.closingDr, baseCurrency)} / {formatBase(tb.totalInBase.closingCr, baseCurrency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      )}
      <div className="flex flex-wrap gap-2 text-[11.5px]">
        <span className={`px-2 py-1 rounded ${chip(tb.check.turnoverOk)}`}>{t("trv2_to_check_turnover")} {tb.check.turnoverOk ? "✓" : `(Δ ${formatBase(tb.check.turnoverDelta, baseCurrency)})`}</span>
        <span className={`px-2 py-1 rounded ${chip(tb.check.openingOk)}`}>{t("trv2_to_check_opening")} {tb.check.openingOk ? "✓" : `(Δ ${formatBase(tb.check.openingDelta, baseCurrency)})`}</span>
        <span className={`px-2 py-1 rounded ${chip(tb.check.closingOk)}`}>{t("trv2_to_check_closing")} {tb.check.closingOk ? "✓" : `(Δ ${formatBase(tb.check.closingDelta, baseCurrency)})`}</span>
      </div>
    </div>
  );
}
