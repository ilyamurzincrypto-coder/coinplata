// src/components/cashier/CashierLedgerDeals.jsx
// The Cashier's deal list — a manager-friendly deal board, NOT an accounting journal.
// Reads straight from the v2 ledger (ledger.transactions / journal_entries via
// LedgerProvider) so an operator sees the deals they just created, scoped to the
// current office. Each row is a deal "slip" (time · counterparty · «пришло → ушло» ·
// маржа · статус); expanded → <DealDetail> in manager language. Raw Dr/Cr trees live
// in the Treasury "Сделки"/"Журнал" tabs, not here — see CashierDealRow.
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useLedger } from "../../store/ledger.jsx";
import { transactionTree } from "../../lib/treasury/v2selectors.js";
import PeriodPicker, { presetWindow } from "../../pages/treasury_v2/PeriodPicker.jsx";
import CashierDealRow from "./CashierDealRow.jsx";

export default function CashierLedgerDeals({ officeFilter }) {
  const { t } = useTranslation();
  const ctx = useLedger();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.cashier_deals_period") || "30d"; } catch { return "30d"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.cashier_deals_period", v); } catch {} };

  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  // Managers see deals only — no type chips. The accounting journal (transfers/topups/
  // adjustments + Dr/Cr) is the Treasury's job.
  const tree = useMemo(
    () => transactionTree(ctx, { type: "deal", officeFilter, period: { from: win.from, to: win.to } }),
    [ctx, officeFilter, win.from, win.to]
  );
  const accById = useMemo(() => new Map((ctx.accounts || []).map((a) => [a.id, a])), [ctx.accounts]);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <span className="text-[13px] font-semibold text-slate-700">{t("cashier_deals_title")}</span>
        <PeriodPicker value={period} onChange={setP} />
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_journal_no_tx")}</div>
        ) : (
          tree.map((node) => (
            <CashierDealRow
              key={node.tx.id}
              node={node}
              accById={accById}
              counterpartyName={ctx.counterpartyName}
            />
          ))
        )}
      </section>
    </div>
  );
}
