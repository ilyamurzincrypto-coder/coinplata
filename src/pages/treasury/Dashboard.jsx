// src/pages/treasury/Dashboard.jsx
import React, { useMemo } from "react";
import { useAccounts } from "../../store/accounts.jsx";
import { useObligations } from "../../store/obligations.jsx";
import { useTransactions } from "../../store/transactions.jsx";
import { useRates } from "../../store/rates.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";
import {
  computeKPIs,
  computeAlerts,
  groupByAccountType,
  groupByCurrency,
  lastNMovements,
} from "../../lib/treasury/selectors.js";
import AlertBar from "./components/AlertBar.jsx";
import KPICards from "./components/KPICards.jsx";
import BalancesByTypeTable from "./components/BalancesByTypeTable.jsx";
import CurrencyBreakdownTable from "./components/CurrencyBreakdownTable.jsx";
import MovementTimeline from "./components/MovementTimeline.jsx";
import EmptyState from "./components/EmptyState.jsx";

export default function Dashboard({ officeId }) {
  const { t } = useTranslation();
  const { accounts, balanceOf, reservedOf, movements } = useAccounts();
  const { obligations } = useObligations();
  const { transactions } = useTransactions();
  const ratesCtx = useRates();
  const lastConfirmedAt = ratesCtx.confirmedAt || null;
  const modifiedAfterConfirmation = !!ratesCtx.modifiedAfterConfirmation;
  const { findOffice } = useOffices();
  const { toBase, formatBase, baseCurrency } = useBaseCurrency();

  const office = findOffice(officeId);
  const officeAccounts = useMemo(
    () => accounts.filter((a) => a.officeId === officeId),
    [accounts, officeId]
  );

  const ctx = useMemo(() => ({
    officeId,
    accounts,
    movements,
    obligations,
    transactions,
    rates: ratesCtx.rates || [],
    lastConfirmedAt,
    modifiedAfterConfirmation,
    balanceOf,
    reservedOf,
    toBase,
    baseCurrency,
  }), [officeId, accounts, movements, obligations, transactions, ratesCtx.rates,
       lastConfirmedAt, modifiedAfterConfirmation, balanceOf, reservedOf, toBase, baseCurrency]);

  const alerts        = useMemo(() => computeAlerts(ctx),       [ctx]);
  const kpis          = useMemo(() => computeKPIs(ctx),         [ctx]);
  const byType        = useMemo(() => groupByAccountType(ctx),  [ctx]);
  const byCurrency    = useMemo(() => groupByCurrency(ctx),     [ctx]);
  const timeline      = useMemo(() => lastNMovements(ctx, 50),  [ctx]);

  if (officeAccounts.length === 0) {
    return (
      <main className="max-w-[1300px] mx-auto px-6 py-6">
        <EmptyState officeName={office?.name} />
      </main>
    );
  }

  const freshTime = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <header>
        <h1 className="text-[24px] font-bold tracking-tight">
          {t("tr_dashboard_title")}{office?.name ? ` · ${office.name}` : ""}
        </h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {t("tr_data_freshness").replace("{time}", freshTime)} · base: {baseCurrency}
        </p>
      </header>

      <AlertBar alerts={alerts} />

      <KPICards kpis={kpis} formatBase={formatBase} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <BalancesByTypeTable rows={byType} formatBase={formatBase} baseCurrency={baseCurrency} />
        <CurrencyBreakdownTable rows={byCurrency} formatBase={formatBase} baseCurrency={baseCurrency} />
      </div>

      <MovementTimeline items={timeline} />
    </main>
  );
}
