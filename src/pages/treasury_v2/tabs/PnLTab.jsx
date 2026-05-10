// src/pages/treasury_v2/tabs/PnLTab.jsx
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { pnlForPeriod } from "../../../lib/treasury/v2selectors.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

function Section({ titleKey, total, sign, formatBase, baseCurrency, accounts }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <h3 className="text-[13px] font-bold text-slate-900">{t(titleKey)}</h3>
        <span className="text-[14px] font-semibold tabular-nums">{sign}{formatBase(Math.abs(total), baseCurrency)}</span>
      </header>
      {open && (accounts.length === 0 ? (
        <div className="px-4 py-3 text-[12px] text-slate-400">—</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {accounts.map((a) => (
              <tr key={a.code} className="border-t border-slate-100">
                <td className="px-4 py-2"><span className="font-mono text-[11px] text-slate-400 mr-2">{a.code}</span>{a.name}</td>
                <td className="px-4 py-2 text-right text-slate-400 text-[11px] w-16">{a.entryCount}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium w-32">{a.amountInBase < 0 ? "−" : ""}{formatBase(Math.abs(a.amountInBase), baseCurrency)}</td>
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
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_pnl_period") || "month"; } catch { return "month"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_pnl_period", v); } catch {} };
  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) {
      ctx.extendWindow(win.from);
    }
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  const pnl = useMemo(() => pnlForPeriod(ctx, { from: win.from, to: win.to }, officeFilter), [ctx, win.from, win.to, officeFilter]);

  const hasAnything = pnl.revenue.accounts.length || pnl.expense.accounts.length || pnl.fxAccounts.length;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3">
        <PeriodPicker value={period} onChange={setP} />
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      {!hasAnything ? (
        <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_pnl_no_data")}</div>
      ) : (
        <>
          <Section titleKey="trv2_pnl_revenue" total={pnl.revenue.total} sign="+" accounts={pnl.revenue.accounts} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_expense" total={pnl.expense.total} sign="−" accounts={pnl.expense.accounts} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_fx" total={pnl.fxNet} sign={pnl.fxNet < 0 ? "−" : "+"} accounts={pnl.fxAccounts} formatBase={formatBase} baseCurrency={baseCurrency} />
          <div className="bg-slate-900 text-white rounded-[14px] px-5 py-4 flex items-center justify-between">
            <span className="text-[14px] font-bold">{t("trv2_pnl_net_profit")}</span>
            <span className={`text-[20px] font-bold tabular-nums ${pnl.netProfit < 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {pnl.netProfit < 0 ? "−" : "+"}{formatBase(Math.abs(pnl.netProfit), baseCurrency)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
