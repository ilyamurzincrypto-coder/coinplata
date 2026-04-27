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
import { RecoveryContext, useRecovery } from "./lib/recovery.jsx";
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
  const { forceSetPassword } = useRecovery();
  const [page, setPage] = useState("cashier");
  const [currentOffice, setCurrentOffice] = useState("mark");
  const [exchangeMode, setExchangeMode] = useState("dashboard");
  const [formMounted, setFormMounted] = useState(false);
  const can = useCan();

  // AUTO-MINIMIZE: любой клик в Header (включая повторный "Касса" будучи
  // на cashier) сворачивает create/rates обратно в dashboard.
  // Сценарии которые это покрывает:
  //   - "Создать сделку" → клик "Касса"   → главная Кассира
  //   - "Курсы"          → клик "Касса"   → главная Кассира
  //   - cashier+create   → клик "Капитал" → cashier dashboard сохранён
  // Draft формы переживает, потому что formMounted остаётся true и
  // ExchangeForm пишет в sessionStorage.
  const handlePageChange = (nextPage) => {
    if (exchangeMode === "create" || exchangeMode === "rates") {
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
      const el = document.querySelector('input[placeholder*="Search" i], input[placeholder*="Поиск" i]');
      if (el) el.focus();
    },
    escape: () => {
      if (exchangeMode === "create" || exchangeMode === "rates") setExchangeMode("dashboard");
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
  // Activation gate. forceSetPassword (из AuthGate) истина если:
  //   а) password_set=false в public.users
  //   б) PASSWORD_RECOVERY event / type=recovery в hash
  // Эти случаи — magic-link / recovery flow, требуем установить пароль.
  // _loading → ждём, чтобы invited-user не увидел приложение даже мельком.
  if (isSupabaseConfigured) {
    if (currentUser?.status === "_loading") {
      return (
        <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-slate-500 text-[13px]">
          Loading workspace…
        </div>
      );
    }
    if (forceSetPassword || currentUser?.status === "invited") {
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
//
// Дополнительно: detect-им password recovery / magic-link сценарий и
// принудительно отправляем юзера на SetPasswordPage — независимо от
// public.users.status. Это закрывает дыру где юзер мог зайти через
// magic-link без когда-либо установленного пароля.
// CRITICAL: парсим URL hash на module-level — синхронно при импорте App.jsx,
// ДО того как Supabase SDK с detectSessionInUrl=true успевает его почистить.
// Если бы парсили в useEffect, race-condition: SDK иногда чистит hash раньше
// чем компонент маунтится → мы теряем type=magiclink и не взводим recoveryMode.
//
// Implicit flow Supabase кладёт в hash:
//   #access_token=...&refresh_token=...&type=magiclink|recovery|invite|signup
//
// Любой из этих типов означает "юзер только что залогинился через email link
// и должен установить/обновить пароль" — форсим SetPasswordPage.
const INITIAL_RECOVERY_FROM_HASH = (() => {
  if (typeof window === "undefined") return false;
  try {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#")) return false;
    const params = new URLSearchParams(hash.slice(1));
    const type = params.get("type");
    const hasToken = !!params.get("access_token");
    // Любой email-link login (по type) ИЛИ любой access_token в hash
    // (defensive: если type не пришёл, но access_token есть — это всё равно
    // magic-link / recovery, не обычный login).
    if (
      type === "recovery" ||
      type === "magiclink" ||
      type === "invite" ||
      type === "signup" ||
      (hasToken && !type)
    ) {
      return true;
    }
  } catch {}
  return false;
})();

function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [forcePreview, setForcePreview] = useState(false);
  // profile: undefined = loading, null = no row, иначе { status, password_set }
  const [profile, setProfile] = useState(undefined);
  // recoveryMode: true если URL hash был из email-link, либо
  // onAuthStateChange выдал PASSWORD_RECOVERY. Принудительно показываем
  // SetPasswordPage. Сбрасывается после save через clearRecovery().
  const [recoveryMode, setRecoveryMode] = useState(INITIAL_RECOVERY_FROM_HASH);

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
      setProfile(null);
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
        const sub = supabase.auth.onAuthStateChange((evt, s) => {
          // PASSWORD_RECOVERY — Supabase выдаёт когда юзер кликнул recovery
          // link (resetPasswordForEmail). Форсим SetPasswordPage.
          if (evt === "PASSWORD_RECOVERY") setRecoveryMode(true);
          setSession(s);
        });
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

  // Fetch profile (status + password_set) — до рендера children. Нужно
  // чтобы invited / без пароля юзер сразу попал на SetPasswordPage,
  // без мельканий основного приложения.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!session?.user?.id) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    const fetchProfile = async () => {
      try {
        // Сначала пробуем с password_set (миграция 0039). Если колонки нет
        // — fallback на status-only (graceful degradation для случая когда
        // фронт задеплоен раньше миграции БД).
        let resp = await supabase
          .from("users")
          .select("status, password_set")
          .eq("id", session.user.id)
          .maybeSingle();
        let pwdSetKnown = true;
        if (resp.error) {
          const msg = resp.error.message || "";
          if (/password_set|column .* does not exist/i.test(msg)) {
            // Колонка ещё не задеплоена — fallback.
            pwdSetKnown = false;
            resp = await supabase
              .from("users")
              .select("status")
              .eq("id", session.user.id)
              .maybeSingle();
          }
        }
        if (cancelled) return;
        if (resp.error) {
          // eslint-disable-next-line no-console
          console.warn("[authgate] profile fetch error", resp.error);
          // Без profile row безопаснее: status='invited' гарантирует
          // SetPasswordPage. password_set ставим в true чтобы не блокировать
          // legacy active юзеров когда колонка отсутствует.
          setProfile({ status: "invited", password_set: true });
          return;
        }
        const data = resp.data || null;
        setProfile({
          status: data?.status || "invited",
          // Если колонка есть — берём её значение; если нет — считаем что
          // password_set=true чтобы не запирать active юзеров до миграции.
          password_set: pwdSetKnown ? !!data?.password_set : true,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[authgate] profile fetch threw", err);
        setProfile({ status: "invited", password_set: true });
      }
    };
    fetchProfile();
    // Re-check при bumpDataVersion (sehapasswordset → AuthGate обновит).
    const unsub = onDataBump(fetchProfile);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [session]);

  const clearRecovery = React.useCallback(() => setRecoveryMode(false), []);

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
    // Есть session — ждём profile.
    if (profile === undefined) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-[13px]">
          Loading…
        </div>
      );
    }
    // disabled (отключённый админом) → обратно на login + close session.
    if (profile?.status === "disabled") {
      supabase.auth.signOut().catch(() => {});
      return <LoginPage />;
    }
    // forceSetPassword: recovery flow ИЛИ password_set=false ИЛИ status=invited.
    // Эта сводная проверка делает Set Password железобетонной — даже если
    // одна из branch'ей не сработала, другая поймает.
    const forceSetPassword =
      recoveryMode ||
      profile?.status === "invited" ||
      profile?.password_set === false;
    return (
      <RecoveryContext.Provider value={{ recoveryMode, clearRecovery, forceSetPassword }}>
        {children}
      </RecoveryContext.Provider>
    );
  }
  // Demo — рендерим children как есть, recovery всегда false.
  return (
    <RecoveryContext.Provider value={{ recoveryMode: false, clearRecovery: () => {}, forceSetPassword: false }}>
      {children}
    </RecoveryContext.Provider>
  );
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
