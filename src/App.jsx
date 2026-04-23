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
import ObligationsPage from "./pages/ObligationsPage.jsx";
import RatesConfirmationBanner from "./components/RatesConfirmationBanner.jsx";
import RateChangeBanner from "./components/RateChangeBanner.jsx";

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
import { NotificationsProvider } from "./store/notifications.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import { supabase, isSupabaseConfigured } from "./lib/supabase.js";
import { useAuth } from "./store/auth.jsx";
import { onDataBump } from "./lib/dataVersion.jsx";
import { DataVersionProvider } from "./lib/dataVersion.jsx";
import { ToastProvider } from "./lib/toast.jsx";
import { RealtimeProvider } from "./lib/realtime.jsx";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import CommandPalette from "./components/CommandPalette.jsx";

const PAGE_SECTION = {
  cashier: "transactions",
  capital: "capital",
  accounts: "accounts",
  clients: "clients",
  obligations: "obligations",
  referrals: "referrals",
  settings: "settings",
};

function Root() {
  // CRITICAL: все хуки вызываются безусловно на каждом рендере.
  // Early return'ы — ТОЛЬКО после всех useXxx вызовов (Rules of Hooks).
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const [page, setPage] = useState("cashier");
  const [currentOffice, setCurrentOffice] = useState("mark");
  const [exchangeMode, setExchangeMode] = useState("dashboard");
  const [formMounted, setFormMounted] = useState(false);
  const can = useCan();

  // AUTO-MINIMIZE: при переходе на любую страницу кроме cashier —
  // сворачиваем сделку. Draft остаётся в sessionStorage.
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

  // Глобальные хоткеи:
  //   N — новая сделка (только на cashier, иначе переключит и откроет)
  //   /  — фокус на поиск в транзакциях
  //   Esc — свернуть форму создания сделки
  //   G+C cashier, G+K capital, G+A accounts, G+L clients, G+O obligations,
  //   G+S settings, G+R referrals
  useKeyboardShortcuts({
    n: () => {
      if (!canShow("cashier")) return;
      if (page !== "cashier") setPage("cashier");
      setExchangeMode("create");
    },
    "/": () => {
      // Находим поле поиска в активной таблице (rough — первый input[placeholder*=Search])
      const el = document.querySelector('input[placeholder*="Search" i], input[placeholder*="Поиск" i]');
      if (el) el.focus();
    },
    escape: () => {
      if (exchangeMode === "create") setExchangeMode("dashboard");
    },
    "g c": () => handlePageChange("cashier"),
    "g k": () => handlePageChange("capital"),
    "g a": () => handlePageChange("accounts"),
    "g l": () => handlePageChange("clients"),
    "g o": () => handlePageChange("obligations"),
    "g r": () => handlePageChange("referrals"),
    "g s": () => handlePageChange("settings"),
  });

  // === Early returns AFTER all hooks ===
  // Activation gate: invited → SetPasswordPage; _loading → ждём, чтобы
  // invited-user не увидел основное приложение даже на долю секунды.
  if (isSupabaseConfigured) {
    if (currentUser?.status === "_loading") {
      return (
        <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-slate-500 text-[13px]">
          Loading workspace…
        </div>
      );
    }
    if (currentUser?.status === "invited") {
      return <SetPasswordPage />;
    }
  }

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
      <RateChangeBanner />
      <RatesConfirmationBanner currentOffice={currentOffice} />
      {page === "cashier" && canShow("cashier") && (
        <CashierPage
          currentOffice={currentOffice}
          mode={exchangeMode}
          setMode={setExchangeMode}
          formMounted={formMounted}
          setFormMounted={setFormMounted}
          onNavigate={handlePageChange}
        />
      )}
      {page === "capital" && canShow("capital") && <CapitalPage />}
      {page === "accounts" && canShow("accounts") && <AccountsPage />}
      {page === "clients" && canShow("clients") && <ClientsPage />}
      {page === "obligations" && canShow("obligations") && <ObligationsPage />}
      <CommandPalette onNavigate={handlePageChange} />
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
  // profileStatus: undefined = loading, null = no row, 'active'|'invited'|'disabled'
  // Нужен чтобы invited-user сразу попал на SetPasswordPage без мельканий
  // основного приложения.
  const [profileStatus, setProfileStatus] = useState(undefined);

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
      setProfileStatus(null);
      return;
    }
    let unsub;
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

  // Fetch profile status отдельным запросом — до рендера children. Нужен для
  // магического линка: invited-юзер должен ПРЯМО сразу попасть на
  // SetPasswordPage, без промелькания основного приложения.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!session?.user?.id) {
      setProfileStatus(null);
      return;
    }
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("status")
          .eq("id", session.user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          // eslint-disable-next-line no-console
          console.warn("[authgate] profile status error", error);
          setProfileStatus(null);
          return;
        }
        // Если row нет (триггер не успел / RLS заблокировал) — трактуем как
        // invited (безопаснее): лучше лишний раз отправить на SetPasswordPage
        // чем пустить в приложение без профиля.
        setProfileStatus(data?.status || "invited");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[authgate] profile status threw", err);
        setProfileStatus(null);
      }
    };
    fetchStatus();
    // Re-check при bumpDataVersion (сохранение пароля → status='active'
    // → AuthGate увидит и пустит в приложение).
    const unsub = onDataBump(fetchStatus);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [session]);

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
    // Есть session — показываем loading до того как profileStatus подгрузится,
    // чтобы invited-юзер не видел ни мельком основного приложения.
    if (profileStatus === undefined) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-[13px]">
          Loading…
        </div>
      );
    }
    // disabled (отключённый админом) → обратно на login + close session.
    if (profileStatus === "disabled") {
      supabase.auth.signOut().catch(() => {});
      return <LoginPage />;
    }
    // status='invited' — дальше рендерим children, но Root увидит это через
    // useAuth().currentUser.status и покажет SetPasswordPage.
  }
  // Demo или authenticated — рендерим children (Root сам проверит invited).
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
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
                              <NotificationsProvider>
                              <WalletsProvider>
                                <MonitoringProvider>
                                  <Root />
                                </MonitoringProvider>
                              </WalletsProvider>
                              </NotificationsProvider>
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
    </ErrorBoundary>
  );
}
