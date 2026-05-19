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
      <div className="bg-white border border-border-soft rounded-card p-3 flex flex-wrap items-center gap-4">
        <span className="text-body-sm font-semibold text-ink-soft">{t("cashier_deals_title")}</span>
        <PeriodPicker value={period} onChange={setP} />
      </div>
      {truncated && (
        <div className="rounded-card px-3 py-2 text-caption bg-warning-soft text-warning border border-warning/20">{t("trv2_window_partial")}</div>
      )}
      <section className="bg-white rounded-card-lg border border-border-soft overflow-hidden">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center text-caption text-muted-soft">{t("trv2_journal_no_tx")}</div>
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
