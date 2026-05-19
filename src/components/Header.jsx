// src/components/Header.jsx
import React, { useMemo } from "react";
import { Globe, Building2 } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import Select from "./ui/Select.jsx";
import OfficeSwitcher from "./OfficeSwitcher.jsx";
import CashClosureBadge from "./CashClosureBadge.jsx";
import ProfileMenu from "./ProfileMenu.jsx";
import NotificationsBell from "./NotificationsBell.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useCan } from "../store/permissions.jsx";

const NAV_PAGES = [
  { id: "cashier", key: "nav_cashier", section: "transactions" },
  { id: "accounts", key: "nav_accounts", section: "accounts" },
  { id: "counterparties", key: "nav_counterparties", section: "counterparties" },
  // Казначейство переиспользует permission-секцию «capital» (отдельной
  // страницы «Капитал» больше нет — её дашборд переехал сюда).
  { id: "treasury", key: "nav_treasury", section: "capital" },
  { id: "settings", key: "nav_settings", section: "settings" },
  { id: "info", key: "nav_info", section: "transactions" },
];

export default function Header({ currentOffice, onOfficeChange, page, onPageChange }) {
  // onPageChange прокинут из Root — используем для navigate из bell-dropdown
  const { t, lang, setLang } = useTranslation();
  const { activeOffices } = useOffices();
  const { currentUser } = useAuth();
  const can = useCan();

  const visibleNav = NAV_PAGES.filter((p) => can(p.section));

  // Раньше manager scoping принудительно ограничивал менеджера его
  // собственным офисом. Задумка пересмотрена: менеджер видит счета и
  // балансы ВСЕХ офисов (RLS расширен в 0034). Scoping отключён.
  const isScopedManager = false;
  const scopedOffices = activeOffices;

  // Если currentOffice не совпадает ни с одним активным офисом — падаем
  // на первый доступный (например офис был закрыт).
  React.useEffect(() => {
    if (!scopedOffices.some((o) => o.id === currentOffice) && scopedOffices[0]) {
      onOfficeChange(scopedOffices[0].id);
    }
  }, [currentOffice, scopedOffices, onOfficeChange]);

  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-border-soft">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-4">
        {/* Logo — coinpoint mark, без текстовой подписи */}
        <div className="flex items-center shrink-0">
          <img
            src="/logo.png"
            alt="coinpoint"
            className="h-9 w-9 select-none"
            draggable={false}
          />
        </div>

        {/* Nav */}
        <nav className="hidden lg:flex items-center gap-0.5">
          {visibleNav.map((p) => (
            <button
              key={p.id}
              onClick={() => onPageChange(p.id)}
              className={`px-2.5 py-1.5 rounded-[8px] text-[13px] transition-colors ${
                page === p.id
                  ? "bg-surface-sunk text-ink font-semibold"
                  : "text-muted hover:text-ink hover:bg-surface-soft"
              }`}
            >
              {t(p.key)}
            </button>
          ))}
        </nav>

        {/* Office + closure (только на Cashier) */}
        {page === "cashier" && (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {isScopedManager ? (
              <div className="inline-flex items-center gap-1.5 bg-white border border-border-soft rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-ink-soft">
                <Building2 className="w-3.5 h-3.5 text-muted-soft" />
                {scopedOffices[0]?.name || "—"}
              </div>
            ) : (
              <div className="w-[200px]">
                <OfficeSwitcher
                  value={currentOffice}
                  onChange={onOfficeChange}
                  offices={scopedOffices}
                />
              </div>
            )}
            <CashClosureBadge currentOffice={currentOffice} />
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right cluster: lang + bell + profile */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-20">
            <Select
              value={lang}
              onChange={setLang}
              options={["EN", "RU", "TR"]}
              icon={<Globe className="w-3.5 h-3.5 text-muted-soft flex-shrink-0" />}
              compact
            />
          </div>
          <NotificationsBell onNavigate={onPageChange} />
          <ProfileMenu />
        </div>
      </div>

      {/* Mobile nav */}
      <div className="lg:hidden px-4 pb-2 pt-1 flex items-center gap-2 overflow-x-auto">
        {visibleNav.map((p) => (
          <button
            key={p.id}
            onClick={() => onPageChange(p.id)}
            className={`px-3 py-1 rounded-[8px] text-[12px] whitespace-nowrap transition-colors ${
              page === p.id
                ? "bg-surface-sunk text-ink font-medium"
                : "text-muted hover:text-ink"
            }`}
          >
            {t(p.key)}
          </button>
        ))}
      </div>

      {/* Mobile office switcher + badge */}
      {page === "cashier" && (
        <div className="md:hidden px-4 pb-3 pt-1 flex items-center gap-2">
          {!isScopedManager && (
            <div className="flex-1 min-w-0">
              <SegmentedControl options={scopedOffices} value={currentOffice} onChange={onOfficeChange} size="sm" />
            </div>
          )}
          <CashClosureBadge currentOffice={currentOffice} />
        </div>
      )}
    </header>
  );
}
