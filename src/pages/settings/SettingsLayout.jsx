// src/pages/settings/SettingsLayout.jsx
// Layout в стиле Supabase: слева sidebar с табами, справа контент.
// Active tab хранится локально в state; URL не трогаем (нет роутера).

import React, { useState } from "react";
import { Settings as SettingsIcon, Users, Shield, ScrollText } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useAuth } from "../../store/auth.jsx";
import GeneralTab from "./GeneralTab.jsx";
import UsersTab from "./UsersTab.jsx";
import PermissionsTab from "./PermissionsTab.jsx";
import AuditLogTab from "./AuditLogTab.jsx";

const TABS = [
  { id: "general", labelKey: "settings_general", icon: SettingsIcon, component: GeneralTab },
  { id: "users", labelKey: "settings_users", icon: Users, component: UsersTab, adminOnly: true },
  { id: "permissions", labelKey: "settings_permissions", icon: Shield, component: PermissionsTab, adminOnly: true },
  { id: "audit", labelKey: "settings_audit", icon: ScrollText, component: AuditLogTab, adminOnly: true },
];

export default function SettingsLayout() {
  const { t } = useTranslation();
  const { isAdmin, currentUser } = useAuth();
  const [active, setActive] = useState("general");

  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);
  const ActiveComponent = visibleTabs.find((x) => x.id === active)?.component || GeneralTab;

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6">
      <div className="mb-5">
        <h1 className="text-[24px] font-bold tracking-tight">{t("settings_title")}</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {t("logged_in_as")}{" "}
          <span className="font-semibold text-slate-900">{currentUser.name}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 items-start">
        {/* Sidebar */}
        <nav className="bg-white border border-slate-200/70 rounded-[12px] p-1.5 md:sticky md:top-[76px]">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-[13px] text-left transition-colors ${
                  isActive
                    ? "bg-slate-100 text-slate-900 font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-slate-900" : "text-slate-400"}`} />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="bg-white border border-slate-200/70 rounded-[14px] overflow-hidden">
          <ActiveComponent />
        </div>
      </div>
    </main>
  );
}
