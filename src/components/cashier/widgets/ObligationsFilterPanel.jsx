// src/components/cashier/widgets/ObligationsFilterPanel.jsx
// Collapsible filter panel для OpenObligationsWidget.
// Filters: status (multi), owner (single), stale (toggle), office (admin only).

import React, { useState, useEffect } from "react";
import { Filter, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { useAuth } from "../../../store/auth.jsx";

const STATUS_OPTIONS = [
  { value: "draft",             labelKey: "open_obligations_status_draft" },
  { value: "awaiting_payment",  labelKey: "open_obligations_status_awaiting_payment" },
  { value: "awaiting_release",  labelKey: "open_obligations_status_awaiting_release" },
  { value: "partial",           labelKey: "open_obligations_status_partial" },
];

export function defaultFilters() {
  return {
    status: STATUS_OPTIONS.map((o) => o.value), // default: все 4
    owner: "all",                                // 'all' | 'mine'
    stale: false,
    office: null,                                // null = все офисы
  };
}

function isDefault(filters) {
  return (
    filters.status.length === STATUS_OPTIONS.length &&
    filters.owner === "all" &&
    filters.stale === false &&
    filters.office === null
  );
}

function countActive(filters) {
  let n = 0;
  if (filters.status.length !== STATUS_OPTIONS.length) n += 1;
  if (filters.owner !== "all") n += 1;
  if (filters.stale) n += 1;
  if (filters.office !== null) n += 1;
  return n;
}

const STORAGE_PREFIX = "coinplata.openObligations.filters.";

export default function ObligationsFilterPanel({
  filters,
  setFilters,
  staleCount = 0,
}) {
  const { t } = useTranslation();
  const { activeOffices } = useOffices();
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);

  // localStorage persist (debounced 300ms)
  useEffect(() => {
    if (!currentUser?.id) return;
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_PREFIX + currentUser.id, JSON.stringify(filters));
      } catch {
        /* noop */
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [filters, currentUser]);

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "owner";
  const activeCount = countActive(filters);

  const toggleStatus = (value) => {
    setFilters((prev) => {
      const next = prev.status.includes(value)
        ? prev.status.filter((s) => s !== value)
        : [...prev.status, value];
      return { ...prev, status: next };
    });
  };

  const setOwner = (val) => setFilters((p) => ({ ...p, owner: val }));
  const toggleStale = () => setFilters((p) => ({ ...p, stale: !p.stale }));
  const setOffice = (val) => setFilters((p) => ({ ...p, office: val || null }));
  const clearAll = () => setFilters(defaultFilters());

  return (
    <div className="border-b border-slate-100">
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50/40"
      >
        <Filter className="w-3 h-3" />
        <span className="font-semibold">{t("open_obligations_filter_button")}</span>
        {activeCount > 0 && (
          <span className="text-[10px] tabular-nums text-indigo-600">
            {t("open_obligations_filter_active").replace("{{n}}", String(activeCount))}
          </span>
        )}
        {staleCount > 0 && (
          <span className="text-[10px] tabular-nums text-rose-600 inline-flex items-center gap-0.5">
            <AlertTriangle className="w-3 h-3" />
            {t("open_obligations_filter_stale_count").replace("{{n}}", String(staleCount))}
          </span>
        )}
        <span className="ml-auto">
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>

      {open && (
        <div className="px-3 py-2 space-y-2 bg-slate-50/30 border-t border-slate-100">
          {/* Status (multi) */}
          <Row label={t("open_obligations_filter_status_label")}>
            {STATUS_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                active={filters.status.includes(opt.value)}
                onClick={() => toggleStatus(opt.value)}
              >
                {t(opt.labelKey)}
              </Chip>
            ))}
          </Row>

          {/* Owner (single) */}
          <Row label={t("open_obligations_filter_owner_label")}>
            <Chip active={filters.owner === "all"} onClick={() => setOwner("all")}>
              {t("open_obligations_filter_owner_all")}
            </Chip>
            <Chip active={filters.owner === "mine"} onClick={() => setOwner("mine")}>
              {t("open_obligations_filter_owner_mine")}
            </Chip>
          </Row>

          {/* Stale toggle */}
          <Row label={t("open_obligations_filter_stale_label")}>
            <Chip active={filters.stale} onClick={toggleStale}>
              {filters.stale ? "✓" : "○"}
            </Chip>
          </Row>

          {/* Office (admin only) */}
          {isAdmin && (
            <Row label={t("open_obligations_filter_office_label")}>
              <select
                value={filters.office || ""}
                onChange={(e) => setOffice(e.target.value)}
                className="bg-white border border-slate-200 rounded-[var(--radius-cell)] px-2 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-slate-300"
              >
                <option value="">{t("open_obligations_filter_office_all")}</option>
                {activeOffices.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </Row>
          )}

          {/* Clear */}
          {!isDefault(filters) && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[10px] text-slate-500 hover:text-slate-800 underline"
            >
              {t("open_obligations_filter_clear_all")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-slate-400 uppercase tracking-wider w-20 shrink-0">
        {label}:
      </span>
      <div className="flex items-center gap-1 flex-wrap">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center px-2 py-0.5 rounded-[var(--radius-cell)] border text-[11px] font-semibold " +
        (active
          ? "bg-indigo-50 hover:bg-indigo-100 border-indigo-300 text-indigo-700"
          : "bg-white hover:bg-slate-100 border-slate-200 text-slate-600")
      }
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (для widget)
// ─────────────────────────────────────────────────────────────────────

export function loadFiltersFromStorage(userId) {
  if (!userId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      status: Array.isArray(parsed.status) ? parsed.status : defaultFilters().status,
      owner: parsed.owner === "mine" ? "mine" : "all",
      stale: !!parsed.stale,
      office: parsed.office || null,
    };
  } catch {
    return null;
  }
}

export function applyFilters(items, filters, userId) {
  if (!filters) return items;
  return items.filter((w) => {
    if (!filters.status.includes(w.status)) return false;
    if (filters.owner === "mine" && w.assigned_to !== userId) return false;
    if (filters.stale && !w.is_stale) return false;
    if (filters.office && w.office_id !== filters.office) return false;
    return true;
  });
}
