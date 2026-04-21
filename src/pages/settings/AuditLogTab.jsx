// src/pages/settings/AuditLogTab.jsx
// Таблица событий лога. Append-only, без фильтров в первой версии.

import React, { useMemo, useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const ACTION_STYLES = {
  create: "bg-emerald-50 text-emerald-700",
  update: "bg-sky-50 text-sky-700",
  delete: "bg-rose-50 text-rose-700",
  deactivate: "bg-amber-50 text-amber-800",
  reactivate: "bg-indigo-50 text-indigo-700",
};

export default function AuditLogTab() {
  const { t } = useTranslation();
  const { log } = useAudit();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return log;
    const q = search.trim().toLowerCase();
    return log.filter(
      (e) =>
        e.userName.toLowerCase().includes(q) ||
        e.entity.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q)
    );
  }, [log, search]);

  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-slate-500" />
          <h3 className="text-[15px] font-semibold tracking-tight">{t("audit_title")}</h3>
          <span className="text-[11px] text-slate-400">· {log.length} events</span>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200/70 focus:bg-white focus:border-slate-300 rounded-[8px] text-[13px] outline-none w-56 transition-colors placeholder:text-slate-400"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
              <th className="px-5 py-2.5 font-bold">{t("audit_when")}</th>
              <th className="px-3 py-2.5 font-bold">{t("audit_who")}</th>
              <th className="px-3 py-2.5 font-bold">{t("audit_what")}</th>
              <th className="px-3 py-2.5 font-bold">{t("audit_entity")}</th>
              <th className="px-3 py-2.5 font-bold">{t("audit_summary")}</th>
              <th className="px-5 py-2.5 font-bold">{t("audit_ip")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const actionLabel = t(`action_${e.action}`) !== `action_${e.action}` ? t(`action_${e.action}`) : e.action;
              const entityLabel = t(`entity_${e.entity}`) !== `entity_${e.entity}` ? t(`entity_${e.entity}`) : e.entity;
              return (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <div className="font-medium text-slate-900 tabular-nums">{relativeTime(e.timestamp)}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap font-semibold text-slate-700">{e.userName}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                        ACTION_STYLES[e.action] || "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {actionLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{entityLabel}</td>
                  <td className="px-3 py-3 text-slate-600 max-w-md truncate" title={e.summary}>
                    {e.summary}
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] text-slate-500 tabular-nums">{e.ip}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-[13px] text-slate-400">
                  {t("audit_empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
