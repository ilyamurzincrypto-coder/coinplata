// src/App.jsx
// Корневой компонент: оборачивает всё в providers, рендерит Header и текущую страницу.

import React, { useState } from "react";
import Header from "./components/Header.jsx";
import CashierPage from "./pages/CashierPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ReferralsPage from "./pages/ReferralsPage.jsx";
import CapitalPage from "./pages/CapitalPage.jsx";

import { I18nProvider } from "./i18n/translations.jsx";
import { RatesProvider } from "./store/rates.jsx";
import { AuthProvider } from "./store/auth.jsx";
import { TransactionsProvider } from "./store/transactions.jsx";

function Root() {
  const [page, setPage] = useState("cashier");
  const [currentOffice, setCurrentOffice] = useState("mark");

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-slate-900 font-sans">
      <Header
        page={page}
        onPageChange={setPage}
        currentOffice={currentOffice}
        onOfficeChange={setCurrentOffice}
      />
      {page === "cashier" && <CashierPage currentOffice={currentOffice} />}
      {page === "capital" && <CapitalPage />}
      {page === "referrals" && <ReferralsPage />}
      {page === "settings" && <SettingsPage />}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <RatesProvider>
          <TransactionsProvider>
            <Root />
          </TransactionsProvider>
        </RatesProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
