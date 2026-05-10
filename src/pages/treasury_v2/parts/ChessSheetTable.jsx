// src/pages/treasury_v2/parts/ChessSheetTable.jsx
// Шахматка: account×account base-currency turnover matrix for a period. Rows = Dr accounts,
// columns = Cr accounts. Multi-leg transactions are allocated proportionally (see selector).
import React, { useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { chessTurnover } from "../../../lib/treasury/v2selectors.js";

export default function ChessSheetTable({ ctx, window: win, officeFilter, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const ch = useMemo(() => chessTurnover(ctx, win, officeFilter), [ctx, win, officeFilter]);

  if (ch.accounts.length === 0) {
    return <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_to_empty_chess")}</div>;
  }
  const cols = ch.accounts;
  const rowsAccts = ch.accounts;
  const cell = (drId, crId) => {
    const v = ch.rows.get(drId)?.get(crId) || 0;
    return Math.abs(v) < 1e-9 ? "" : formatBase(v, baseCurrency);
  };
  return (
    <div className="space-y-2">
      <div className="bg-white rounded-[14px] border border-slate-200/70 overflow-auto">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-100 px-2 py-1.5 border border-slate-200 text-slate-400 text-[10px] uppercase">Дт ╲ Кт</th>
              {cols.map((c) => (
                <th key={c.accountId} title={c.name} className="bg-slate-100 px-2 py-1.5 border border-slate-200 font-mono text-[10px] text-slate-600 whitespace-nowrap">{c.code}</th>
              ))}
              <th className="bg-slate-100 px-2 py-1.5 border border-slate-200 text-[10px] text-slate-500 whitespace-nowrap">{t("trv2_to_chess_row_total")}</th>
            </tr>
          </thead>
          <tbody>
            {rowsAccts.map((r) => (
              <tr key={r.accountId}>
                <th title={r.name} className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 border border-slate-200 font-mono text-[10px] text-slate-600 text-left whitespace-nowrap">{r.code}</th>
                {cols.map((c) => (
                  <td key={c.accountId} className="px-2 py-1.5 border border-slate-100 text-right tabular-nums">{cell(r.accountId, c.accountId)}</td>
                ))}
                <td className="px-2 py-1.5 border border-slate-200 text-right tabular-nums font-medium bg-slate-50">{formatBase(ch.rowTotals.get(r.accountId) || 0, baseCurrency)}</td>
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 border border-slate-200 text-[10px] text-slate-500 text-left whitespace-nowrap">{t("trv2_to_chess_col_total")}</th>
              {cols.map((c) => (
                <td key={c.accountId} className="px-2 py-1.5 border border-slate-200 text-right tabular-nums font-medium bg-slate-50">{formatBase(ch.colTotals.get(c.accountId) || 0, baseCurrency)}</td>
              ))}
              <td className="px-2 py-1.5 border border-slate-300 text-right tabular-nums font-bold bg-slate-900 text-white">{formatBase(ch.grandTotal, baseCurrency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">{t("trv2_to_chess_note").replace("{cur}", baseCurrency)}</p>
    </div>
  );
}
