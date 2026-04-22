// src/pages/AccountsPage.jsx
// Office → Accounts layout. Для каждого офиса — блок со счетами.
// Кнопки Top up / Transfer / History в каждой карточке.

import React, { useState, useMemo } from "react";
import { Wallet, Plus, ArrowLeftRight, History as HistoryIcon, Building2 } from "lucide-react";
import { useAccounts } from "../store/accounts.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useTranslation } from "../i18n/translations.jsx";
import { useOffices } from "../store/offices.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import TopUpModal from "../components/accounts/TopUpModal.jsx";
import TransferModal from "../components/accounts/TransferModal.jsx";
import AccountHistoryModal from "../components/accounts/AccountHistoryModal.jsx";
import AddAccountModal from "../components/accounts/AddAccountModal.jsx";

const TYPE_ICONS = {
  bank: "🏦",
  cash: "💵",
  crypto: "🪙",
  exchange: "📈",
};

export default function AccountsPage() {
  const { t } = useTranslation();
  const { accounts, balanceOf } = useAccounts();
  const { activeOffices } = useOffices();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const [topUpFor, setTopUpFor] = useState(null);
  const [transferFrom, setTransferFrom] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [addAccountFor, setAddAccountFor] = useState(null); // {id, name} офиса

  // Группировка по офисам (только активные)
  const grouped = useMemo(() => {
    return activeOffices.map((o) => {
      const accs = accounts.filter((a) => a.officeId === o.id && a.active);
      const totalInBase = accs.reduce(
        (s, a) => s + toBase(balanceOf(a.id), a.currency),
        0
      );
      return { office: o, accounts: accs, totalInBase };
    });
  }, [accounts, activeOffices, balanceOf, toBase]);

  const grandTotal = grouped.reduce((s, g) => s + g.totalInBase, 0);

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">{t("accounts_title")}</h1>
          <p className="text-[13px] text-slate-500 mt-1">{t("accounts_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-white border border-slate-200 rounded-[10px] px-4 py-2">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Total ({base})
            </div>
            <div className="text-[18px] font-bold tabular-nums tracking-tight text-slate-900">
              {sym}
              {fmt(grandTotal, base)}
            </div>
          </div>
          <button
            onClick={() => {
              setTransferFrom(null);
              setTransferOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            {t("acc_transfer")}
          </button>
        </div>
      </div>

      {grouped.map(({ office, accounts: accs, totalInBase }) => (
        <section key={office.id} className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-500" />
              <h2 className="text-[15px] font-semibold tracking-tight">{office.name}</h2>
              <span className="text-[11px] text-slate-400">· {accs.length} accounts</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[13px] tabular-nums">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-2">
                  {t("acc_total_by_office")}
                </span>
                <span className="font-bold text-slate-900">
                  {sym}
                  {fmt(totalInBase, base)}
                </span>
              </div>
              <button
                onClick={() => setAddAccountFor({ id: office.id, name: office.name })}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t("acc_add") || "Add account"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-5">
            {accs.map((a) => {
              const bal = balanceOf(a.id);
              return (
                <div
                  key={a.id}
                  className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-4 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[18px]">{TYPE_ICONS[a.type] || "•"}</span>
                      <div>
                        <div className="text-[13px] font-semibold text-slate-900 leading-tight">
                          {a.name}
                        </div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">
                          {t(`acc_type_${a.type}`) !== `acc_type_${a.type}` ? t(`acc_type_${a.type}`) : a.type}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-md px-1.5 py-0.5">
                      {a.currency}
                    </span>
                  </div>

                  <div className="text-[20px] font-bold tabular-nums tracking-tight text-slate-900 mb-3">
                    {curSymbol(a.currency)}
                    {fmt(bal, a.currency)}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTopUpFor(a)}
                      className="flex-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-[8px] px-2 py-1.5 transition-colors inline-flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      {t("acc_topup")}
                    </button>
                    <button
                      onClick={() => {
                        setTransferFrom(a);
                        setTransferOpen(true);
                      }}
                      className="flex-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-[8px] px-2 py-1.5 transition-colors inline-flex items-center justify-center gap-1"
                    >
                      <ArrowLeftRight className="w-3 h-3" />
                      {t("acc_transfer")}
                    </button>
                    <button
                      onClick={() => setHistoryFor(a)}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-[8px] px-2 py-1.5 transition-colors"
                      title={t("acc_history")}
                    >
                      <HistoryIcon className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            {accs.length === 0 && (
              <div className="col-span-full text-center text-[13px] text-slate-400 py-8">
                No accounts in this office
              </div>
            )}
          </div>
        </section>
      ))}

      <TopUpModal account={topUpFor} onClose={() => setTopUpFor(null)} />
      <TransferModal
        open={transferOpen}
        fromAccount={transferFrom}
        onClose={() => {
          setTransferOpen(false);
          setTransferFrom(null);
        }}
      />
      <AccountHistoryModal account={historyFor} onClose={() => setHistoryFor(null)} />
      <AddAccountModal
        open={!!addAccountFor}
        officeId={addAccountFor?.id}
        officeName={addAccountFor?.name}
        onClose={() => setAddAccountFor(null)}
      />
    </main>
  );
}
