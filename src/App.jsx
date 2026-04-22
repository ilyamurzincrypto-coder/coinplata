// src/App.jsx
// Корневой компонент: оборачивает всё в providers, рендерит Header и текущую страницу.

import React, { useState, useEffect } from "react";
import Header from "./components/Header.jsx";
import CashierPage from "./pages/CashierPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ReferralsPage from "./pages/ReferralsPage.jsx";
import CapitalPage from "./pages/CapitalPage.jsx";
import ClientsPage from "./pages/ClientsPage.jsx";
import AccountsPage from "./pages/AccountsPage.jsx";

import { I18nProvider } from "./i18n/translations.jsx";
import { RatesProvider } from "./store/rates.jsx";
import { AuthProvider } from "./store/auth.jsx";
import { TransactionsProvider } from "./store/transactions.jsx";
import { AccountsProvider } from "./store/accounts.jsx";
import { PermissionsProvider, useCan } from "./store/permissions.jsx";
import { AuditProvider } from "./store/audit.jsx";
import { IncomeExpenseProvider } from "./store/incomeExpense.jsx";

const PAGE_SECTION = {
  cashier: "transactions",
  capital: "capital",
  accounts: "accounts",
  clients: "capital",
  referrals: "referrals",
  settings: "settings",
};

function Root() {
  const [page, setPage] = useState("cashier");
  const [currentOffice, setCurrentOffice] = useState("mark");
  const can = useCan();

  // Если на текущую страницу нет прав — отправляем на cashier
  useEffect(() => {
    const section = PAGE_SECTION[page];
    if (section && !can(section)) {
      setPage("cashier");
    }
  }, [page, can]);

  const canShow = (p) => can(PAGE_SECTION[p] || "transactions");

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-slate-900 font-sans">
      <Header
        page={page}
        onPageChange={setPage}
        currentOffice={currentOffice}
        onOfficeChange={setCurrentOffice}
      />
      {page === "cashier" && canShow("cashier") && <CashierPage currentOffice={currentOffice} />}
      {page === "capital" && canShow("capital") && <CapitalPage />}
      {page === "accounts" && canShow("accounts") && <AccountsPage />}
      {page === "clients" && canShow("clients") && <ClientsPage />}
      {page === "referrals" && canShow("referrals") && <ReferralsPage />}
      {page === "settings" && canShow("settings") && <SettingsPage />}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <PermissionsProvider>
          <AuditProvider>
            <RatesProvider>
              <AccountsProvider>
                <IncomeExpenseProvider>
                  <TransactionsProvider>
                    <Root />
                  </TransactionsProvider>
                </IncomeExpenseProvider>
              </AccountsProvider>
            </RatesProvider>
          </AuditProvider>
        </PermissionsProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
