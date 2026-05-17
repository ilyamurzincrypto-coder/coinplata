// src/pages/treasury_v2/TreasuryShell.jsx
import React, { useState, useMemo, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useLedger } from "../../store/ledger.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { balanceCheckTotals, transactionTree } from "../../lib/treasury/v2selectors.js";
import OfficePicker from "./OfficePicker.jsx";
import BalanceCheckBar from "./BalanceCheckBar.jsx";
import TransactionDetail from "./parts/TransactionDetail.jsx";
import DashboardTab from "./tabs/DashboardTab.jsx";
import AssetsTab from "./tabs/AssetsTab.jsx";
import LiabilitiesTab from "./tabs/LiabilitiesTab.jsx";
import EquityTab from "./tabs/EquityTab.jsx";
import PnLTab from "./tabs/PnLTab.jsx";
import TurnoverTab from "./tabs/TurnoverTab.jsx";
import CashFlowTab from "./tabs/CashFlowTab.jsx";
import JournalTab from "./tabs/JournalTab.jsx";
import DealsTab from "./tabs/DealsTab.jsx";
import PaymentCalendarTab from "./tabs/PaymentCalendarTab.jsx";
import CorrespondentsTab from "./tabs/CorrespondentsTab.jsx";

// Порядок вкладок выстроен по частоте использования для обменника:
//   ОБЗОР:    Дашборд
//   ОПЕРАЦИИ: Сделки, Платёжный календарь, ДДС  ← менеджер каждый день
//   БАЛАНС:   Активы, Пассивы, Капитал, Корр-счета  ← на дату
//   ОТЧЁТЫ:   P&L, Обороты  ← за период для бухгалтера
//   ИСТОРИЯ:  Журнал  ← все транзакции с проводками
//
// `groupStart: true` — после этого таба рисуется тонкий разделитель в
// tab strip, чтобы границы групп были видны глазом.
const BASE_TABS = [
  // ── Обзор ──
  { id: "dashboard", labelKey: "trv2_tab_dashboard", component: DashboardTab, groupStart: true },
  // ── Операции (управленческое) ──
  { id: "deals", labelKey: "trv2_tab_deals", component: DealsTab, groupStart: true },
  { id: "calendar", labelKey: "trv2_tab_calendar", component: PaymentCalendarTab },
  { id: "cashflow", labelKey: "trv2_tab_cashflow", component: CashFlowTab },
  // ── Баланс на дату ──
  { id: "assets", labelKey: "trv2_tab_assets", component: AssetsTab, groupStart: true },
  { id: "liabilities", labelKey: "trv2_tab_liabilities", component: LiabilitiesTab },
  { id: "equity", labelKey: "trv2_tab_equity", component: EquityTab },
  { id: "correspondents", labelKey: "trv2_tab_correspondents", component: CorrespondentsTab },
  // ── Отчёты за период ──
  { id: "pnl", labelKey: "trv2_tab_pnl", component: PnLTab, groupStart: true },
  { id: "turnover", labelKey: "trv2_tab_turnover", component: TurnoverTab },
  // ── История ──
  { id: "journal", labelKey: "trv2_tab_journal", component: JournalTab, groupStart: true },
];

// Manual journal entries used to be a standalone tab; they now live as a "+ Ручная
// проводка" button + modal inside the Журнал tab (so a posted entry appears in the
// list right away, no tab switch). See JournalTab.jsx.
const TABS = BASE_TABS;

export default function TreasuryShell({ onOpenHelp = null }) {
  const { t } = useTranslation();
  const { accounts, balances, transactions, entries, loading, sinceIso, extendWindow, counterpartyName, counterpartyOptions } = useLedger();
  // useBaseCurrency() exposes the base code as `base`; alias it to baseCurrency
  // so the rest of Treasury (selectors + tabs) can use a consistent name.
  const { toBase, formatBase, base: baseCurrency } = useBaseCurrency();

  const [officeFilter, setOfficeFilter] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_office") || "all"; } catch { return "all"; }
  });
  const setOffice = (v) => {
    setOfficeFilter(v);
    try { localStorage.setItem("coinplata.treasury_office", v); } catch {}
  };

  const [activeTab, setActiveTab] = useState("dashboard");

  // if the active tab id ever becomes invalid, fall back to dashboard
  useEffect(() => {
    if (!TABS.some((x) => x.id === activeTab)) setActiveTab("dashboard");
  }, [activeTab]);

  const ActiveComp = TABS.find((x) => x.id === activeTab)?.component || DashboardTab;

  const ctx = useMemo(
    () => ({ accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, sinceIso, extendWindow, counterpartyName, counterpartyOptions }),
    [accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, sinceIso, extendWindow, counterpartyName, counterpartyOptions]
  );

  const totals = useMemo(() => balanceCheckTotals(ctx, officeFilter), [ctx, officeFilter]);
  const freshTime = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  // txId → { tx, entries } node, used to resolve drill-down clicks into the detail modal.
  const txNodeById = useMemo(() => {
    const m = new Map();
    for (const node of transactionTree({ transactions, entries, accounts }, { type: "all", officeFilter: "all" })) m.set(node.tx.id, node);
    return m;
  }, [transactions, entries, accounts]);
  const [selectedTx, setSelectedTx] = useState(null);
  const openTx = (txId) => setSelectedTx(txNodeById.get(txId) || null);
  const openSource = (tx) => setSelectedTx(txNodeById.get(tx?.id) || null);

  if (loading) {
    return <main className="max-w-[1300px] mx-auto px-6 py-10 text-center text-slate-400">{t("trv2_loading")}</main>;
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col">
      <main className="flex-1 max-w-[1300px] w-full mx-auto px-6 py-6 space-y-5">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-[24px] font-bold tracking-tight">{t("trv2_title")}</h1>
            {onOpenHelp && (
              <button
                type="button"
                onClick={() => onOpenHelp({ sectionId: "treasury", subId: activeTab })}
                title={`Справка по разделу «${t(TABS.find((x) => x.id === activeTab)?.labelKey || "trv2_title")}»`}
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
              >
                <HelpCircle className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <OfficePicker value={officeFilter} onChange={setOffice} />
            <span className="text-[12px] text-slate-400">{t("trv2_data_freshness").replace("{time}", freshTime)} · base: {baseCurrency}</span>
          </div>
        </header>

        <div className="bg-white border border-slate-200/70 rounded-[12px] p-1 flex gap-0.5 items-center overflow-x-auto">
          {TABS.map((tab, idx) => {
            const isActive = activeTab === tab.id;
            // Тонкий вертикальный разделитель ПЕРЕД табом, открывающим
            // новую логическую группу (кроме самого первого).
            const showDivider = tab.groupStart && idx > 0;
            return (
              <React.Fragment key={tab.id}>
                {showDivider && (
                  <span className="mx-1 w-px h-6 bg-slate-200 shrink-0" aria-hidden />
                )}
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-medium whitespace-nowrap transition-colors ${
                    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {t(tab.labelKey)}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <ActiveComp ctx={ctx} officeFilter={officeFilter} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={openTx} onOpenSource={openSource} />
      </main>
      <BalanceCheckBar totals={totals} formatBase={formatBase} baseCurrency={baseCurrency} />
      <TransactionDetail node={selectedTx} onClose={() => setSelectedTx(null)} />
    </div>
  );
}
