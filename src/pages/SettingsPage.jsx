// src/pages/SettingsPage.jsx
import React, { useState } from "react";
import { UserPlus, ShieldCheck, User as UserIcon, Settings as SettingsIcon, TrendingUp } from "lucide-react";
import { useAuth } from "../store/auth.jsx";
import { useRates, FEATURED_PAIRS, rateKey } from "../store/rates.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import SegmentedControl from "../components/ui/SegmentedControl.jsx";

function Section({ title, icon, children, right }) {
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { users, updateUserRole, addUser, settings, updateSettings, isAdmin, currentUser } = useAuth();
  const { rates, setRate, lastUpdated } = useRates();

  const [minFee, setMinFee] = useState(settings.minFeeUsd);
  const [refPct, setRefPct] = useState(settings.referralPct);
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState("manager");

  const saveSystem = () => {
    updateSettings({
      minFeeUsd: parseFloat(minFee) || 10,
      referralPct: parseFloat(refPct) || 0.1,
    });
  };

  const handleAddUser = () => {
    if (!newUserName.trim()) return;
    const initials = newUserName
      .trim()
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    addUser({
      id: `u_${Date.now()}`,
      name: newUserName.trim(),
      initials,
      role: newUserRole,
    });
    setNewUserName("");
  };

  return (
    <main className="max-w-[900px] mx-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight">{t("settings_title")}</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {t("logged_in_as")} <span className="font-semibold text-slate-900">{currentUser.name}</span> ·{" "}
          {isAdmin ? t("admin") : t("manager")}
        </p>
      </div>

      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-[12px] px-4 py-3 text-[13px] text-amber-900">
          Some actions are admin-only. Switch to an admin account in the header to edit rates, users, and system settings.
        </div>
      )}

      {/* USERS & ROLES */}
      <Section title={t("users_and_roles")} icon={<UserIcon className="w-4 h-4 text-slate-500" />}>
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between bg-slate-50/60 border border-slate-200 rounded-[10px] px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold ${
                    u.role === "admin"
                      ? "bg-gradient-to-br from-indigo-500 to-indigo-700"
                      : "bg-gradient-to-br from-slate-700 to-slate-900"
                  }`}
                >
                  {u.initials}
                </div>
                <div>
                  <div className="text-[13px] font-semibold">{u.name}</div>
                  <div className="text-[11px] text-slate-500 capitalize flex items-center gap-1">
                    {u.role === "admin" && <ShieldCheck className="w-3 h-3 text-indigo-500" />}
                    {u.role === "admin" ? t("role_admin") : t("role_manager")}
                  </div>
                </div>
              </div>
              {isAdmin && (
                <SegmentedControl
                  options={[
                    { id: "manager", name: t("role_manager") },
                    { id: "admin", name: t("role_admin") },
                  ]}
                  value={u.role}
                  onChange={(v) => updateUserRole(u.id, v)}
                  size="sm"
                />
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <div className="mt-4 p-3 border border-dashed border-slate-300 rounded-[10px]">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t("add_user")}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Name"
                className="flex-1 min-w-[160px] bg-white border border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none"
              />
              <SegmentedControl
                options={[
                  { id: "manager", name: t("role_manager") },
                  { id: "admin", name: t("role_admin") },
                ]}
                value={newUserRole}
                onChange={setNewUserRole}
                size="sm"
              />
              <button
                onClick={handleAddUser}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" /> {t("add_user")}
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* RATES SUMMARY */}
      <Section
        title={t("rates_management")}
        icon={<TrendingUp className="w-4 h-4 text-slate-500" />}
        right={
          <span className="text-[11px] text-slate-500">
            {t("rate_updated")}: {lastUpdated.toLocaleTimeString()}
          </span>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURED_PAIRS.map(([from, to]) => (
            <div key={`${from}-${to}`} className="flex items-center gap-2">
              <div className="flex-1 text-[11px] font-bold text-slate-500 tracking-wide">
                {from} → {to}
              </div>
              <input
                type="text"
                inputMode="decimal"
                disabled={!isAdmin}
                value={rates[rateKey(from, to)] ?? ""}
                onChange={(e) => setRate(from, to, e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                className="w-32 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500 disabled:cursor-not-allowed"
              />
            </div>
          ))}
        </div>
      </Section>

      {/* SYSTEM SETTINGS */}
      <Section title={t("system_settings")} icon={<SettingsIcon className="w-4 h-4 text-slate-500" />}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-[13px] text-slate-700 font-medium">{t("min_fee_label")}</label>
            <input
              type="text"
              inputMode="decimal"
              disabled={!isAdmin}
              value={minFee}
              onChange={(e) => setMinFee(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              className="w-40 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500"
            />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-[13px] text-slate-700 font-medium">{t("referral_pct_label")}</label>
            <input
              type="text"
              inputMode="decimal"
              disabled={!isAdmin}
              value={refPct}
              onChange={(e) => setRefPct(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              className="w-40 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500"
            />
          </div>
          {isAdmin && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={saveSystem}
                className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
              >
                {t("save")}
              </button>
            </div>
          )}
        </div>
      </Section>
    </main>
  );
}
