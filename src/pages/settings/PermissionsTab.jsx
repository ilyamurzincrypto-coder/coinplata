// src/pages/settings/PermissionsTab.jsx
// Матрица прав: строки = users, колонки = sections, ячейка = segmented Disabled/View/Edit.

import React from "react";
import { Shield, RotateCcw } from "lucide-react";
import { useAuth, ROLES } from "../../store/auth.jsx";
import { usePermissions, SECTIONS, LEVELS } from "../../store/permissions.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

const LEVEL_STYLES = {
  disabled: "bg-slate-100 text-slate-500",
  view: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  edit: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

export default function PermissionsTab() {
  const { t } = useTranslation();
  const { users, isAdmin } = useAuth();
  const { getPermissions, setPermission, resetUserPermissions } = usePermissions();

  const activeUsers = users.filter((u) => u.active !== false);

  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Shield className="w-4 h-4 text-slate-500" />
        <h3 className="text-[15px] font-semibold tracking-tight">{t("settings_permissions")}</h3>
      </div>

      {!isAdmin && (
        <div className="m-5 p-3 bg-amber-50 border border-amber-200 rounded-[10px] text-[12px] text-amber-900">
          Viewing as non-admin — changes are disabled.
        </div>
      )}

      <div className="p-5">
        <p className="text-[12px] text-slate-500 mb-4">
          Each cell defines access level for a user in a specific section. Admin always has full access.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left sticky left-0 bg-white z-10 py-2.5 pr-4 text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                  User
                </th>
                {SECTIONS.map((s) => (
                  <th
                    key={s}
                    className="text-center px-2 py-2.5 text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 whitespace-nowrap"
                  >
                    {t(`section_${s}`)}
                  </th>
                ))}
                <th className="w-10 border-b border-slate-100"></th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.map((u) => {
                const perms = getPermissions(u.id);
                const isRoleAdmin = u.role === "admin";
                return (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="sticky left-0 bg-white py-2 pr-4 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold ${
                            u.role === "admin"
                              ? "bg-gradient-to-br from-indigo-500 to-indigo-700"
                              : u.role === "accountant"
                              ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
                              : "bg-gradient-to-br from-slate-700 to-slate-900"
                          }`}
                        >
                          {u.initials}
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-slate-900">{u.name}</div>
                          <div className="text-[10px] text-slate-500">{ROLES[u.role]?.label}</div>
                        </div>
                      </div>
                    </td>
                    {SECTIONS.map((s) => {
                      const level = perms[s] || "disabled";
                      return (
                        <td key={s} className="px-2 py-2 border-b border-slate-100">
                          {isRoleAdmin ? (
                            <div
                              className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-[11px] font-semibold ${LEVEL_STYLES.edit}`}
                              title="Admin has full access everywhere"
                            >
                              EDIT
                            </div>
                          ) : (
                            <LevelCell
                              level={level}
                              disabled={!isAdmin}
                              onChange={(next) => setPermission(u.id, s, next)}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 border-b border-slate-100">
                      {isAdmin && !isRoleAdmin && (
                        <button
                          onClick={() => resetUserPermissions(u.id)}
                          className="p-1 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          title={t("reset_to_defaults")}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Legend:</span>
          {LEVELS.map((lv) => (
            <span
              key={lv}
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${LEVEL_STYLES[lv]}`}
            >
              {t(`level_${lv}`)}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

function LevelCell({ level, onChange, disabled }) {
  return (
    <div className="inline-flex bg-slate-100 p-0.5 rounded-[8px] gap-0.5">
      {LEVELS.map((lv) => {
        const isActive = level === lv;
        return (
          <button
            key={lv}
            type="button"
            disabled={disabled}
            onClick={() => onChange(lv)}
            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-[6px] transition-all disabled:cursor-not-allowed ${
              isActive
                ? lv === "edit"
                  ? "bg-emerald-500 text-white shadow-sm"
                  : lv === "view"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "bg-slate-400 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {lv[0].toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
