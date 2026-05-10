// src/pages/treasury_v2/tabs/TurnoverTab.jsx
// «Обороты» tab: a period turnover report with two views — ОСВ (trial balance) and
// Шахматка (account×account cross-tab). Read-only. Mirrors JournalTab/PnLTab patterns.
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import TrialBalanceTable from "../parts/TrialBalanceTable.jsx";
import ChessSheetTable from "../parts/ChessSheetTable.jsx";

const VIEWS = ["osv", "chess"];

export default function TurnoverTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_turnover_period") || "month"; } catch { return "month"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_turnover_period", v); } catch {} };
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_turnover_view") || "osv"; } catch { return "osv"; }
  });
  const setV = (v) => { setView(v); try { localStorage.setItem("coinplata.treasury_turnover_view", v); } catch {} };

  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex items-center gap-1.5">
          {VIEWS.map((v) => (
            <button key={v} onClick={() => setV(v)}
              className={`px-2.5 py-1 rounded-[8px] text-[12px] font-medium ${view === v ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {t(v === "osv" ? "trv2_to_view_osv" : "trv2_to_view_chess")}
            </button>
          ))}
        </div>
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      {view === "osv"
        ? <TrialBalanceTable ctx={ctx} window={win} officeFilter={officeFilter} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
        : <ChessSheetTable ctx={ctx} window={win} officeFilter={officeFilter} formatBase={formatBase} baseCurrency={baseCurrency} />}
    </div>
  );
}
