// src/pages/treasury_v2/parts/ChessSheetTable.jsx
// Шахматка: account×account turnover matrix for a period. Rows = Dr accounts, columns =
// Cr accounts. By default in the base currency; a currency selector switches to a native
// per-currency view (only legs in that currency, no base conversion). Multi-leg
// transactions are allocated proportionally (see chessTurnover).
import React, { useMemo, useState } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { chessTurnover } from "../../../lib/treasury/v2selectors.js";
import { deriveCurrencies } from "../../../lib/treasury/postingEntry.js";

const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function ChessSheetTable({ ctx, window: win, officeFilter, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const currencies = useMemo(() => deriveCurrencies(ctx.accounts || []), [ctx.accounts]);
  const [cur, setCur] = useState(""); // "" → base-currency view
  const ch = useMemo(() => chessTurnover(ctx, win, officeFilter, cur || null), [ctx, win, officeFilter, cur]);
  const fmt = ch.isNative ? ((v) => `${fmtNum(v)} ${ch.currency}`) : ((v) => formatBase(v, baseCurrency));

  const selector = (
    <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
      {t("trv2_to_chess_currency") || "Валюта"}:
      <select value={cur} onChange={(e) => setCur(e.target.value)}
        className="bg-slate-50 border border-slate-200 rounded-[6px] px-1.5 py-0.5 text-[11px] outline-none">
        <option value="">{t("trv2_to_chess_currency_base") || "Базовая"} ({baseCurrency})</option>
        {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );

  if (ch.accounts.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">{selector}</div>
        <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_to_empty_chess")}</div>
      </div>
    );
  }
  const cols = ch.accounts;
  const rowsAccts = ch.accounts;
  const cell = (drId, crId) => {
    const v = ch.rows.get(drId)?.get(crId) || 0;
    return Math.abs(v) < 1e-9 ? "" : fmt(v);
  };
  return (
    <div className="space-y-2">
      <div className="flex justify-end">{selector}</div>
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
                <td className="px-2 py-1.5 border border-slate-200 text-right tabular-nums font-medium bg-slate-50">{fmt(ch.rowTotals.get(r.accountId) || 0)}</td>
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 border border-slate-200 text-[10px] text-slate-500 text-left whitespace-nowrap">{t("trv2_to_chess_col_total")}</th>
              {cols.map((c) => (
                <td key={c.accountId} className="px-2 py-1.5 border border-slate-200 text-right tabular-nums font-medium bg-slate-50">{fmt(ch.colTotals.get(c.accountId) || 0)}</td>
              ))}
              <td className="px-2 py-1.5 border border-slate-300 text-right tabular-nums font-bold bg-slate-900 text-white">{fmt(ch.grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">{t("trv2_to_chess_note").replace("{cur}", ch.currency)}</p>
      {ch.isNative && (
        <p className="text-[11px] text-amber-600">{t("trv2_to_chess_native_note") || "Для кросс-валютных сделок суммы по столбцам могут не сходиться — недостающая нога в другой валюте."}</p>
      )}
    </div>
  );
}
