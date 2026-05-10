// src/pages/treasury_v2/TreasuryShell.jsx
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useLedger } from "../../store/ledger.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useCan } from "../../store/permissions.jsx";
import { balanceCheckTotals, transactionTree } from "../../lib/treasury/v2selectors.js";
import OfficePicker from "./OfficePicker.jsx";
import BalanceCheckBar from "./BalanceCheckBar.jsx";
import TransactionDetail from "./parts/TransactionDetail.jsx";
import AssetsTab from "./tabs/AssetsTab.jsx";
import LiabilitiesTab from "./tabs/LiabilitiesTab.jsx";
import EquityTab from "./tabs/EquityTab.jsx";
import PnLTab from "./tabs/PnLTab.jsx";
import TurnoverTab from "./tabs/TurnoverTab.jsx";
import JournalTab from "./tabs/JournalTab.jsx";
import PostingTab from "./tabs/PostingTab.jsx";

const BASE_TABS = [
  { id: "assets", labelKey: "trv2_tab_assets", component: AssetsTab },
  { id: "liabilities", labelKey: "trv2_tab_liabilities", component: LiabilitiesTab },
  { id: "equity", labelKey: "trv2_tab_equity", component: EquityTab },
  { id: "pnl", labelKey: "trv2_tab_pnl", component: PnLTab },
  { id: "turnover", labelKey: "trv2_tab_turnover", component: TurnoverTab },
  { id: "journal", labelKey: "trv2_tab_journal", component: JournalTab },
];

export default function TreasuryShell() {
  const { t } = useTranslation();
  const { accounts, balances, transactions, entries, loading, sinceIso, extendWindow } = useLedger();
  // useBaseCurrency() exposes the base code as `base`; alias it to baseCurrency
  // so the rest of Treasury (selectors + tabs) can use a consistent name.
  const { toBase, formatBase, base: baseCurrency } = useBaseCurrency();

  const can = useCan();
  const canPost = can("accounting", "edit");
  const TABS = useMemo(
    () => (canPost ? [...BASE_TABS, { id: "posting", labelKey: "trv2_pm_tab", component: PostingTab }] : BASE_TABS),
    [canPost]
  );

  const [officeFilter, setOfficeFilter] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_office") || "all"; } catch { return "all"; }
  });
  const setOffice = (v) => {
    setOfficeFilter(v);
    try { localStorage.setItem("coinplata.treasury_office", v); } catch {}
  };

  const [activeTab, setActiveTab] = useState("assets");

  // if the active tab disappeared (e.g. lost accounting:edit), fall back to assets
  useEffect(() => {
    if (!TABS.some((x) => x.id === activeTab)) setActiveTab("assets");
  }, [TABS, activeTab]);

  const ActiveComp = TABS.find((x) => x.id === activeTab)?.component || AssetsTab;

  const ctx = useMemo(
    () => ({ accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, sinceIso, extendWindow }),
    [accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, sinceIso, extendWindow]
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
          <h1 className="text-[24px] font-bold tracking-tight">{t("trv2_title")}</h1>
          <div className="flex items-center gap-4">
            <OfficePicker value={officeFilter} onChange={setOffice} />
            <span className="text-[12px] text-slate-400">{t("trv2_data_freshness").replace("{time}", freshTime)} · base: {baseCurrency}</span>
          </div>
        </header>

        <div className="bg-white border border-slate-200/70 rounded-[12px] p-1 flex gap-0.5 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-medium whitespace-nowrap transition-colors ${
                  isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {t(tab.labelKey)}
              </button>
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
