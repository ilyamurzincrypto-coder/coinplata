// src/components/Header.jsx
import React, { useMemo } from "react";
import { Globe } from "lucide-react";
import Select from "./ui/Select.jsx";
import { Pill } from "./ui/redesign.jsx";
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
  const scopedOffices = activeOffices;

  // ЗДЕСЬ БЫЛА АВТОПОДСТАНОВКА «падаем на первый доступный». Она молча
  // подсовывала кассиру Стамбула Анталью — после чистки хранилища или когда
  // его офис закрыли. Офис определяет остатки, заявки и закрытие кассы, то
  // есть деньги: угадывать нельзя, можно только спросить. Решение о сбросе
  // выбора принимает App (один раз, в одном месте), показывая OfficeGate.

  return (
    <header className="sticky top-0 z-40 bg-cream/80 backdrop-blur-xl">
      <div className="max-w-[1680px] mx-auto px-4 h-16 flex items-center gap-3">
        {/* Logo — coinpoint mark, без текстовой подписи */}
        <div className="flex items-center shrink-0">
          <img
            src="/logo.png"
            alt="coinpoint"
            className="h-9 w-9 select-none"
            draggable={false}
          />
        </div>

        {/* Nav — таблетки: активная тёмная, прочие — контурные */}
        <nav className="hidden lg:flex items-center gap-1.5">
          {visibleNav.map((p) => (
            <Pill
              key={p.id}
              variant={page === p.id ? "dark" : "line"}
              onClick={() => onPageChange(p.id)}
              className="!py-2 !px-4 hover:!border-ink/40"
            >
              {t(p.key)}
            </Pill>
          ))}
        </nav>

        {/* Закрытие кассы (только на Cashier). Селектор офиса переехал в
            шапку панели «Балансы» (заменяет тогл «Выбранный/Все офисы»). */}
        {page === "cashier" && (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <CashClosureBadge currentOffice={currentOffice} />
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right cluster: lang + bell + profile */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-[92px]">
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
      <div className="lg:hidden px-4 pb-2 pt-1 flex items-center gap-1.5 overflow-x-auto">
        {visibleNav.map((p) => (
          <Pill
            key={p.id}
            variant={page === p.id ? "dark" : "line"}
            onClick={() => onPageChange(p.id)}
            className="!py-1.5 !px-3 !text-[12px]"
          >
            {t(p.key)}
          </Pill>
        ))}
      </div>

      {/* Mobile: только закрытие кассы (селектор офиса — в «Балансах») */}
      {page === "cashier" && (
        <div className="md:hidden px-4 pb-3 pt-1 flex items-center gap-2">
          <CashClosureBadge currentOffice={currentOffice} />
        </div>
      )}
    </header>
  );
}
