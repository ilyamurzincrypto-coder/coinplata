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
    <div className="border-b border-border-soft">
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-card py-2 text-caption text-ink-soft hover:bg-surface-soft transition-colors"
      >
        <Filter className="w-3 h-3 text-muted" strokeWidth={2} />
        <span className="font-semibold">{t("open_obligations_filter_button")}</span>
        {activeCount > 0 && (
          <span className="text-tiny tabular-nums text-info font-mono">
            {t("open_obligations_filter_active").replace("{{n}}", String(activeCount))}
          </span>
        )}
        {staleCount > 0 && (
          <span className="text-tiny tabular-nums text-danger inline-flex items-center gap-0.5 font-mono">
            <AlertTriangle className="w-3 h-3" strokeWidth={2} />
            {t("open_obligations_filter_stale_count").replace("{{n}}", String(staleCount))}
          </span>
        )}
        <span className="ml-auto text-muted-soft">
          {open ? <ChevronUp className="w-3 h-3" strokeWidth={2.2} /> : <ChevronDown className="w-3 h-3" strokeWidth={2.2} />}
        </span>
      </button>

      {open && (
        <div className="px-card py-2.5 space-y-2 bg-surface-soft/50 border-t border-border-soft">
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
                className="bg-surface border border-border rounded-button px-2 py-1 text-tiny outline-none focus:ring-1 focus:ring-accent text-ink"
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
              className="text-tiny text-muted hover:text-ink font-semibold transition-colors"
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
      <span className="text-[10px] text-muted-soft uppercase tracking-wider w-20 shrink-0 font-semibold">
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
        "inline-flex items-center h-6 px-2 rounded-button border text-tiny font-semibold transition-colors " +
        (active
          ? "bg-accent-bg hover:bg-accent-soft border-accent text-success"
          : "bg-surface hover:bg-surface-soft border-border text-ink-soft")
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
