// src/pages/settings/AuditLogTab.jsx
// Таблица событий лога. Append-only из БД (audit_log) — limit 500.
// Фильтры: action, entity, user, date range, search. CSV export.

import React, { useMemo, useState } from "react";
import { ScrollText, Search, Download, Filter } from "lucide-react";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import DateRangePicker, { rangeForPreset, inRange } from "../../components/ui/DateRangePicker.jsx";
import Select from "../../components/ui/Select.jsx";
import { exportCSV } from "../../utils/csv.js";
import { toISODate } from "../../utils/date.js";

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
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [range, setRange] = useState(() => {
    const r = rangeForPreset("month");
    return { preset: "month", ...r };
  });

  // Уникальные значения для selects — вычисляем из загруженного log.
  const uniqueActions = useMemo(() => {
    const s = new Set();
    log.forEach((e) => s.add(e.action));
    return [...s].sort();
  }, [log]);

  const uniqueEntities = useMemo(() => {
    const s = new Set();
    log.forEach((e) => s.add(e.entity));
    return [...s].sort();
  }, [log]);

  const uniqueUsers = useMemo(() => {
    const map = new Map();
    log.forEach((e) => {
      if (e.userName && !map.has(e.userName)) map.set(e.userName, e.userId || e.userName);
    });
    return [...map.keys()].sort();
  }, [log]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return log.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (entityFilter !== "all" && e.entity !== entityFilter) return false;
      if (userFilter !== "all" && e.userName !== userFilter) return false;
      // Date — по timestamp (ISO). inRange ожидает YYYY-MM-DD.
      if (!inRange(toISODate(e.timestamp), range)) return false;
      if (q) {
        const hay = `${e.userName} ${e.entity} ${e.action} ${e.summary} ${e.entityId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [log, search, actionFilter, entityFilter, userFilter, range]);

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCSV({
      filename: `coinplata-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "timestamp", label: "Timestamp" },
        { key: "userName", label: "User" },
        { key: "action", label: "Action" },
        { key: "entity", label: "Entity" },
        { key: "entityId", label: "Entity ID" },
        { key: "summary", label: "Summary" },
        { key: "ip", label: "IP" },
      ],
      rows: filtered.map((e) => ({
        timestamp: e.timestamp,
        userName: e.userName,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        summary: e.summary,
        ip: e.ip,
      })),
    });
  };

  const clearFilters = () => {
    setSearch("");
    setActionFilter("all");
    setEntityFilter("all");
    setUserFilter("all");
    const r = rangeForPreset("month");
    setRange({ preset: "month", ...r });
  };

  const hasActive =
    search ||
    actionFilter !== "all" ||
    entityFilter !== "all" ||
    userFilter !== "all" ||
    range?.preset !== "month";

  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-slate-500" />
          <h3 className="text-[15px] font-semibold tracking-tight">{t("audit_title")}</h3>
          <span className="text-[11px] text-slate-400">
            · {filtered.length} of {log.length} events
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3 h-3" />
            Export CSV
          </button>
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
      </div>

      {/* Filter row */}
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap bg-slate-50/40">
        <Filter className="w-3.5 h-3.5 text-slate-400" />
        <Select
          value={actionFilter}
          onChange={setActionFilter}
          options={[
            { value: "all", label: "All actions" },
            ...uniqueActions.map((a) => ({ value: a, label: a })),
          ]}
          compact
        />
        <Select
          value={entityFilter}
          onChange={setEntityFilter}
          options={[
            { value: "all", label: "All entities" },
            ...uniqueEntities.map((a) => ({ value: a, label: a })),
          ]}
          compact
        />
        <Select
          value={userFilter}
          onChange={setUserFilter}
          options={[
            { value: "all", label: "All users" },
            ...uniqueUsers.map((a) => ({ value: a, label: a })),
          ]}
          compact
        />
        <DateRangePicker value={range} onChange={setRange} />
        {hasActive && (
          <button
            onClick={clearFilters}
            className="ml-auto px-2 py-1 rounded-[8px] text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200"
          >
            Clear
          </button>
        )}
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
                      {new Date(e.timestamp).toLocaleString()}
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
                  <td className="px-3 py-3 text-slate-700">
                    {entityLabel}
                    {e.entityId && (
                      <span className="ml-1 text-[10px] text-slate-400 font-mono">
                        #{String(e.entityId).slice(0, 8)}
                      </span>
                    )}
                  </td>
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
                  {log.length === 0 ? t("audit_empty") : "No events match the current filter"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
