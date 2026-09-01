// src/App.jsx
// Корневой компонент: оборачивает всё в providers, рендерит Header и текущую страницу.

import React, { useState, useEffect } from "react";
import Header from "./components/Header.jsx";
import CashierPage from "./pages/CashierPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import CounterpartiesPage from "./pages/CounterpartiesPage.jsx";
import TreasuryPage from "./pages/TreasuryPage.jsx";
import AccountsPage from "./pages/AccountsPage.jsx";
import InfoPage from "./pages/InfoPage.jsx";
import ShareAccountsView from "./pages/ShareAccountsView.jsx";
import DesignPreview from "./pages/DesignPreview.jsx";
import RatesConfirmationBanner from "./components/RatesConfirmationBanner.jsx";
import RateChangeBanner from "./components/RateChangeBanner.jsx";
import OfficeGate from "./components/OfficeGate.jsx";

import { I18nProvider, useTranslation } from "./i18n/translations.jsx";
import { RatesProvider } from "./store/rates.jsx";
import { AuthProvider } from "./store/auth.jsx";
import { OfficesProvider, useOffices } from "./store/offices.jsx";
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
import { PartnersProvider } from "./store/partners.jsx";
import { PartnerAccountsProvider } from "./store/partnerAccounts.jsx";
import { LedgerProvider } from "./store/ledger.jsx";
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
  accounts: "accounts",
  counterparties: "counterparties",
  // Казначейство переиспользует permission «capital» — финансовый раздел.
  // Отдельной страницы «Капитал» больше нет (её дашборд переехал в Казначейство),
  // но permission-секция `capital` остаётся — на ней висит Казначейство.
  treasury: "capital",
  settings: "settings",
};

function Root() {
  // CRITICAL: все хуки вызываются безусловно на каждом рендере.
  // Early return'ы — ТОЛЬКО после всех useXxx вызовов (Rules of Hooks).
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { forceSetPassword } = useRecovery();
  // Persist текущей страницы и офиса в localStorage чтобы F5 не сбрасывал
  // юзера на дефолт. PAGE_SECTION гард ниже всё равно отбрасывает на
  // cashier если у роли нет прав на сохранённую страницу.
  const [page, setPage] = useState(() => {
    try {
      let saved = localStorage.getItem("coinplata.page");
      // Страница «Капитал» удалена — её дашборд переехал в Казначейство.
      if (saved === "capital") saved = "treasury";
      return saved && PAGE_SECTION[saved] !== undefined ? saved : "cashier";
    } catch {
      return "cashier";
    }
  });
  // Дефолта нет: подставленный сидовый "mark" ронял каждый запрос с фильтром
  // по офису (заявки, закрытия кассы) в 400, и ошибка глоталась. Пусто —
  // значит спросим человека, см. OfficeGate.
  const [currentOffice, setCurrentOffice] = useState(() => {
    try {
      return localStorage.getItem("coinplata.office") || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try { localStorage.setItem("coinplata.page", page); } catch {}
  }, [page]);
  useEffect(() => {
    try {
      if (currentOffice) localStorage.setItem("coinplata.office", currentOffice);
      else localStorage.removeItem("coinplata.office");
    } catch { /* приватное окно */ }
  }, [currentOffice]);

  // Сверка сохранённого выбора с ЖИВЫМ списком офисов. Проверяем не форму id,
  // а факт существования: в демо-режиме офисы сидовые ("mark") и это законно,
  // а в проде тот же "mark" — мусор из прошлой жизни.
  // Сверяем с АКТИВНЫМИ: закрытый офис — тоже повод спросить заново, а не
  // молча показывать чужие остатки.
  const { activeOffices } = useOffices();
  useEffect(() => {
    if (!activeOffices || activeOffices.length === 0) return; // ещё грузится
    if (currentOffice && !activeOffices.some((o) => o.id === currentOffice)) {
      setCurrentOffice(null);
    }
  }, [activeOffices, currentOffice]);
  const [exchangeMode, setExchangeMode] = useState("dashboard");
  const [formMounted, setFormMounted] = useState(false);
  // Demo seed from the Справка «Попробовать» button — when set, the Кассa deal
  // form opens pre-filled with these example values. Cleared once the form is
  // closed / a fresh «Новый обмен» is started (see CashierPage.onDemoConsumed).
  const [demoDealSeed, setDemoDealSeed] = useState(null);
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

  // «Попробовать в форме» из Справки: переходим в Кассу и открываем форму
  // создания сделки, пред-заполненную значениями примера (initialData).
  const handleTryDeal = (seed) => {
    if (!canShow("cashier")) return;
    setDemoDealSeed(seed || null);
    setFormMounted(true);
    setExchangeMode("create");
    setPage("cashier");
  };

  // Контекстная справка: страница вызывает onOpenHelp({sectionId, subId?}),
  // перекидываем на InfoPage с предраскрытой нужной секцией.
  const [infoInitialSection, setInfoInitialSection] = useState(null);
  const handleOpenHelp = (target) => {
    setInfoInitialSection(target || null);
    setPage("info");
  };

  // Если на текущую страницу нет прав — отправляем на cashier.
  // «Капитал» больше не существует как страница — редиректим на Казначейство.
  useEffect(() => {
    if (page === "capital") {
      setPage("treasury");
      return;
    }
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
  //   G+C cashier, G+K treasury, G+A accounts, G+P counterparties,
  //   G+T treasury, G+S settings
  useKeyboardShortcuts({
    // N — новая сделка. На cashier открывает create-форму; с других
    // страниц переключает на Кассу и открывает её.
    n: () => {
      if (!canShow("cashier")) return;
      setDemoDealSeed(null);
      setFormMounted(true);
      setExchangeMode("create");
      setPage("cashier");
    },
    "/": () => {
      const el = document.querySelector('input[placeholder*="Search" i], input[placeholder*="Поиск" i]');
      if (el) el.focus();
    },
    escape: () => {
      if (exchangeMode === "create" || exchangeMode === "rates") setExchangeMode("dashboard");
    },
    "g c": () => handlePageChange("cashier"),
    "g k": () => handlePageChange("treasury"),
    "g a": () => handlePageChange("accounts"),
    "g p": () => handlePageChange("counterparties"),
    "g t": () => handlePageChange("treasury"),
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
        <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-muted text-body-sm">
          Loading workspace…
        </div>
      );
    }
    if (forceSetPassword || currentUser?.status === "invited") {
      return <SetPasswordPage />;
    }
  }

  return (
    // Тёплый «стол» (крем-2) + рамка-экран 32 со свечением — как в design/reference.html.
    // Рамка = скролл-контейнер (h-full/overflow-y-auto) → топбар и плашка курсов
    // липнут к её верху (sticky внутри контейнера), фон крем-токеном.
    <div className="h-screen bg-[#E5DECD] text-ink font-sans flex flex-col overflow-hidden">
      {!isSupabaseConfigured && (
        <div className="flex-none bg-warning text-ink text-caption font-semibold text-center px-4 py-2">
          {t("demo_banner")}
        </div>
      )}
      <div className="flex-1 min-h-0 px-2 sm:px-3 pt-2 pb-2 sm:pb-3">
        <div className="h-full max-w-[1720px] mx-auto rounded-screen bg-cream bg-frame-glow overflow-y-auto pb-8">
          <Header
            page={page}
            onPageChange={handlePageChange}
            currentOffice={currentOffice}
            onOfficeChange={setCurrentOffice}
          />
          {/* Курс-баннеры прячем, когда открыт дровер редактора курсов. */}
          {exchangeMode !== "rates" && <RateChangeBanner />}
          {exchangeMode !== "rates" && <RatesConfirmationBanner currentOffice={currentOffice} />}
          {/* Без офиса страницы не рисуем: считать остатки и заявки не по чему,
              а угадать офис нельзя — это деньги. Хедер оставляем, чтобы
              переключатель офиса и выход были доступны. */}
          {!currentOffice && activeOffices && activeOffices.length > 0 ? (
            <OfficeGate offices={activeOffices} onPick={setCurrentOffice} />
          ) : (
          <>
          {page === "cashier" && canShow("cashier") && (
            <CashierPage
              currentOffice={currentOffice}
              onOfficeChange={setCurrentOffice}
              mode={exchangeMode}
              setMode={setExchangeMode}
              formMounted={formMounted}
              setFormMounted={setFormMounted}
              onNavigate={handlePageChange}
              demoDealSeed={demoDealSeed}
              onDemoConsumed={() => setDemoDealSeed(null)}
              onOpenHelp={handleOpenHelp}
            />
          )}
          {page === "accounts" && canShow("accounts") && <AccountsPage onOpenHelp={handleOpenHelp} />}
          {page === "counterparties" && canShow("counterparties") && <CounterpartiesPage onOpenHelp={handleOpenHelp} />}
          {page === "treasury" && canShow("capital") && <TreasuryPage onOpenHelp={handleOpenHelp} />}
          <CommandPalette onNavigate={handlePageChange} />
          {page === "settings" && canShow("settings") && <SettingsPage onOpenHelp={handleOpenHelp} />}
          {page === "info" && canShow("info") && (
            <InfoPage
              onNavigate={handlePageChange}
              onTryDeal={handleTryDeal}
              initialTarget={infoInitialSection}
            />
          )}
          </>
          )}
        </div>
      </div>
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
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-muted text-body-sm">
          Loading…
        </div>
      );
    }
    if (!session) return <LoginPage />;
    // Есть session — ждём profile.
    if (profile === undefined) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-muted text-body-sm">
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
  // Dev-витрина примитивов редизайна — /design-preview (вне авторизации/провайдеров).
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/design-preview")) {
    return (
      <ErrorBoundary>
        <DesignPreview />
      </ErrorBoundary>
    );
  }

  // Публичная read-only ссылка /share/accounts/<token> — рендерим ВНЕ авторизации
  // и провайдеров (нет логина, нет доступа к мутациям). Данные — через share-API.
  const shareMatch =
    typeof window !== "undefined" &&
    window.location.pathname.match(/^\/share\/accounts\/([^/?#]+)/);
  if (shareMatch) {
    const token = decodeURIComponent(shareMatch[1]);
    return (
      <ErrorBoundary>
        <ShareAccountsView token={token} />
      </ErrorBoundary>
    );
  }

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
                              <LedgerProvider>
                              <ObligationsProvider>
                              <NotificationsProvider>
                              <PartnersProvider>
                              <PartnerAccountsProvider>
                              <WalletsProvider>
                                <MonitoringProvider>
                                  <Root />
                                </MonitoringProvider>
                              </WalletsProvider>
                              </PartnerAccountsProvider>
                              </PartnersProvider>
                              </NotificationsProvider>
                              </ObligationsProvider>
                              </LedgerProvider>
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
