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
import JournalTab from "./tabs/JournalTab.jsx";

// Treasury — 5 вкладок: Дашборд / Активы / Пассивы / Капитал / Транзакции
// (Сделки, Платёжный календарь, ДДС, Корр-счета, P&L, Обороты выпилены
// 2026-05-26 по решению Кирилла; ключевые сценарии переехали в детальные
// модалы и транзакционный журнал).
const BASE_TABS = [
  { id: "dashboard", labelKey: "trv2_tab_dashboard", component: DashboardTab },
  { id: "assets", labelKey: "trv2_tab_assets", component: AssetsTab },
  { id: "liabilities", labelKey: "trv2_tab_liabilities", component: LiabilitiesTab },
  { id: "equity", labelKey: "trv2_tab_equity", component: EquityTab },
  { id: "journal", labelKey: "trv2_tab_transactions", component: JournalTab },
];

// Manual journal entries used to be a standalone tab; they now live as a "+ Ручная
// проводка" button + modal inside the Журнал tab (so a posted entry appears in the
// list right away, no tab switch). See JournalTab.jsx.
const TABS = BASE_TABS;

export default function TreasuryShell({ onOpenHelp = null }) {
  const { t } = useTranslation();
  const { accounts, balances, transactions, entries, loading, sinceIso, extendWindow, counterpartyName, counterpartyOptions, clientById, partnerById, clients, partners } = useLedger();
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
    () => ({ accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, sinceIso, extendWindow, counterpartyName, counterpartyOptions, clientById, partnerById, clients, partners }),
    [accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, sinceIso, extendWindow, counterpartyName, counterpartyOptions, clientById, partnerById, clients, partners]
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
    return <main className="max-w-[1300px] mx-auto px-6 py-10 text-center text-muted-soft">{t("trv2_loading")}</main>;
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
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-muted-soft hover:text-violet-600 hover:bg-violet-50 transition-colors"
              >
                <HelpCircle className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <OfficePicker value={officeFilter} onChange={setOffice} />
            <span className="text-caption text-muted-soft">{t("trv2_data_freshness").replace("{time}", freshTime)} · base: {baseCurrency}</span>
          </div>
        </header>

        <div className="bg-white border border-border-soft rounded-card p-1 flex gap-0.5 items-center overflow-x-auto">
          {TABS.map((tab, idx) => {
            const isActive = activeTab === tab.id;
            // Тонкий вертикальный разделитель ПЕРЕД табом, открывающим
            // новую логическую группу (кроме самого первого).
            const showDivider = tab.groupStart && idx > 0;
            return (
              <React.Fragment key={tab.id}>
                {showDivider && (
                  <span className="mx-1 w-px h-6 bg-surface-sunk shrink-0" aria-hidden />
                )}
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-button text-body-sm font-medium whitespace-nowrap transition-colors ${
                    isActive ? "bg-ink text-white" : "text-ink-soft hover:bg-surface-soft hover:text-ink"
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
