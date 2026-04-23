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
import RatesConfirmationBanner from "./components/RatesConfirmationBanner.jsx";

import { I18nProvider, useTranslation } from "./i18n/translations.jsx";
import { RatesProvider } from "./store/rates.jsx";
import { AuthProvider } from "./store/auth.jsx";
import { OfficesProvider } from "./store/offices.jsx";
import { CurrenciesProvider } from "./store/currencies.jsx";
import { TransactionsProvider } from "./store/transactions.jsx";
import { AccountsProvider } from "./store/accounts.jsx";
import { PermissionsProvider, useCan } from "./store/permissions.jsx";
import { AuditProvider } from "./store/audit.jsx";
import { IncomeExpenseProvider } from "./store/incomeExpense.jsx";
import { WalletsProvider } from "./store/wallets.jsx";
import { MonitoringProvider } from "./store/monitoring.jsx";
import { CategoriesProvider } from "./store/categories.jsx";
import { RateHistoryProvider } from "./store/rateHistory.jsx";
import { ObligationsProvider } from "./store/obligations.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import { supabase, isSupabaseConfigured } from "./lib/supabase.js";
import { useAuth } from "./store/auth.jsx";
import { DataVersionProvider } from "./lib/dataVersion.jsx";
import { ToastProvider } from "./lib/toast.jsx";
import { RealtimeProvider } from "./lib/realtime.jsx";

const PAGE_SECTION = {
  cashier: "transactions",
  capital: "capital",
  accounts: "accounts",
  clients: "capital",
  referrals: "referrals",
  settings: "settings",
};

function Root() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const [page, setPage] = useState("cashier");
  const [currentOffice, setCurrentOffice] = useState("mark");
  const can = useCan();

  // Activation gate: приглашённый пользователь кликнул magic-link, имеет
  // валидную session, но profile.status = 'invited' → заставляем установить
  // пароль прежде чем пустить в приложение. После save он станет 'active'
  // (через bumpDataVersion в SetPasswordPage → AuthProvider реhydrate).
  if (isSupabaseConfigured && currentUser?.status === "invited") {
    return <SetPasswordPage />;
  }

  // Exchange mode lifted сюда чтобы переживать unmount CashierPage при
  // переходе на Clients/Capital и т.д. Форма формально сбрасывается (ExchangeForm
  // не выживает unmount), но sessionStorage draft восстановит ввод при возврате.
  const [exchangeMode, setExchangeMode] = useState("dashboard");
  const [formMounted, setFormMounted] = useState(false);

  // AUTO-MINIMIZE: при переходе на любую страницу кроме cashier —
  // сворачиваем сделку (mode → dashboard). formMounted остаётся true,
  // так что при возврате на cashier кассир увидит "Resume exchange" CTA
  // + draft восстановится из sessionStorage в ExchangeForm.
  const handlePageChange = (nextPage) => {
    if (nextPage !== "cashier" && exchangeMode === "create") {
      setExchangeMode("dashboard");
    }
    setPage(nextPage);
  };

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
      {!isSupabaseConfigured && (
        <div className="bg-amber-500 text-slate-900 text-[12px] font-semibold text-center px-4 py-2 border-b border-amber-600">
          {t("demo_banner")}
        </div>
      )}
      <Header
        page={page}
        onPageChange={handlePageChange}
        currentOffice={currentOffice}
        onOfficeChange={setCurrentOffice}
      />
      <RatesConfirmationBanner currentOffice={currentOffice} />
      {page === "cashier" && canShow("cashier") && (
        <CashierPage
          currentOffice={currentOffice}
          mode={exchangeMode}
          setMode={setExchangeMode}
          formMounted={formMounted}
          setFormMounted={setFormMounted}
        />
      )}
      {page === "capital" && canShow("capital") && <CapitalPage />}
      {page === "accounts" && canShow("accounts") && <AccountsPage />}
      {page === "clients" && canShow("clients") && <ClientsPage />}
      {page === "referrals" && canShow("referrals") && <ReferralsPage />}
      {page === "settings" && canShow("settings") && <SettingsPage />}
    </div>
  );
}

// Gate перед app: если Supabase настроен и нет session → LoginPage.
// Плюс: `?login=1` или `#login` форсит preview LoginPage без Supabase (удобно
// смотреть дизайн до миграции).
function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [forcePreview, setForcePreview] = useState(false);

  useEffect(() => {
    // Preview-режим через URL
    const url = new URL(window.location.href);
    if (url.searchParams.get("login") === "1" || window.location.hash === "#login") {
      setForcePreview(true);
    }
    const onHash = () => {
      setForcePreview(window.location.hash === "#login");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null);
      return;
    }
    let unsub;
    // Safety timeout: если getSession по какой-то причине висит > 5s,
    // не держим пользователя на Loading экране — переводим в "нет сессии"
    // → покажется LoginPage, можно войти заново.
    const stuckTimer = setTimeout(() => {
      setSession((prev) => (prev === undefined ? null : prev));
    }, 5000);
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          // eslint-disable-next-line no-console
          console.warn("[auth] getSession error", error);
        }
        setSession(data?.session || null);
        const sub = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
        unsub = sub.data.subscription;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[auth] getSession threw", err);
        setSession(null);
      }
    })();
    return () => {
      clearTimeout(stuckTimer);
      try { unsub?.unsubscribe?.(); } catch {}
    };
  }, []);

  // Preview форсится даже когда demo / сессия есть.
  if (forcePreview) return <LoginPage />;

  // Supabase настроен — ждём session и гейтим.
  if (isSupabaseConfigured) {
    if (session === undefined) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-[13px]">
          Loading…
        </div>
      );
    }
    if (!session) return <LoginPage />;
  }
  // Demo-режим или authenticated — рендерим приложение.
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <DataVersionProvider>
        <RealtimeProvider>
        <AuthGate>
          <I18nProvider>
            <AuthProvider>
              <OfficesProvider>
                <CurrenciesProvider>
                  <PermissionsProvider>
                    <AuditProvider>
                      <RatesProvider>
                        <RateHistoryProvider>
                        <AccountsProvider>
                          <CategoriesProvider>
                          <IncomeExpenseProvider>
                            <TransactionsProvider>
                              <ObligationsProvider>
                              <WalletsProvider>
                                <MonitoringProvider>
                                  <Root />
                                </MonitoringProvider>
                              </WalletsProvider>
                              </ObligationsProvider>
                            </TransactionsProvider>
                          </IncomeExpenseProvider>
                          </CategoriesProvider>
                        </AccountsProvider>
                        </RateHistoryProvider>
                      </RatesProvider>
                    </AuditProvider>
                  </PermissionsProvider>
                </CurrenciesProvider>
              </OfficesProvider>
            </AuthProvider>
          </I18nProvider>
        </AuthGate>
        </RealtimeProvider>
      </DataVersionProvider>
    </ToastProvider>
  );
}
