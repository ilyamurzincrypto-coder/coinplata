// src/pages/settings/SettingsLayout.jsx
// Layout в стиле Supabase: слева sidebar с табами, справа контент.
// Active tab хранится локально в state; URL не трогаем (нет роутера).

import React, { useState } from "react";
import { Settings as SettingsIcon, Users, Shield, ScrollText, Building2, Book, Handshake, Hash, HelpCircle } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useAuth } from "../../store/auth.jsx";
import GeneralTab from "./GeneralTab.jsx";
import OfficesTab from "./OfficesTab.jsx";
import UsersTab from "./UsersTab.jsx";
import PermissionsTab from "./PermissionsTab.jsx";
import AuditLogTab from "./AuditLogTab.jsx";
import MasterDataTab from "./MasterDataTab.jsx";
import PartnersTab from "./PartnersTab.jsx";
import AccountingCodesTab from "./AccountingCodesTab.jsx";

const TABS = [
  { id: "general", labelKey: "settings_general", icon: SettingsIcon, component: GeneralTab },
  { id: "offices", labelKey: "settings_offices", icon: Building2, component: OfficesTab, adminOnly: true },
  { id: "users", labelKey: "settings_users", icon: Users, component: UsersTab, adminOnly: true },
  { id: "partners", label: "Партнёры", icon: Handshake, component: PartnersTab },
  { id: "accounting_codes", label: "План счетов", icon: Hash, component: AccountingCodesTab, adminOnly: true },
  { id: "permissions", labelKey: "settings_permissions", icon: Shield, component: PermissionsTab, adminOnly: true },
  { id: "master_data", labelKey: "settings_master_data", icon: Book, component: MasterDataTab, adminOnly: true },
  { id: "audit", labelKey: "settings_audit", icon: ScrollText, component: AuditLogTab, adminOnly: true },
];

export default function SettingsLayout({ onOpenHelp = null }) {
  const { t } = useTranslation();
  const { isAdmin, currentUser } = useAuth();
  const [active, setActive] = useState("general");

  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);
  const ActiveComponent = visibleTabs.find((x) => x.id === active)?.component || GeneralTab;

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h1 className="text-[24px] font-bold tracking-tight">{t("settings_title")}</h1>
          {onOpenHelp && (
            <button
              type="button"
              onClick={() => onOpenHelp({ sectionId: "settings", subId: active })}
              title="Справка по разделу «Настройки»"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-muted-soft hover:text-ink-soft hover:bg-surface-sunk transition-colors"
            >
              <HelpCircle className="w-4 h-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
        <p className="text-[13px] text-muted mt-1">
          {t("logged_in_as")}{" "}
          <span className="font-semibold text-ink">{currentUser.name}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 items-start">
        {/* Sidebar */}
        <nav className="bg-white border border-border-soft rounded-card p-1.5 md:sticky md:top-[76px]">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-button text-[13px] text-left transition-colors ${
                  isActive
                    ? "bg-surface-sunk text-ink font-semibold"
                    : "text-ink-soft hover:bg-surface-soft hover:text-ink"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-ink" : "text-muted-soft"}`} />
                {tab.label || t(tab.labelKey)}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="bg-white border border-border-soft rounded-card-lg overflow-hidden">
          <ActiveComponent />
        </div>
      </div>
    </main>
  );
}
