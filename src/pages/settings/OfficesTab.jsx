// src/pages/settings/OfficesTab.jsx
// CRUD офисов. Использует useOffices() для state.
// Подсчёт accounts per office — через useAccounts (read-only).

import React, { useState, useMemo, useEffect } from "react";
import { Building2, Plus, Pencil, Power, RotateCcw, Clock } from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { DEFAULT_OFFICE_OPS } from "../../store/data.js";
import { getOfficeOpenState } from "../../utils/officeSchedule.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import {
  insertOfficeRow,
  updateOfficeRow,
  closeOfficeRow,
  reopenOfficeRow,
  withToast,
} from "../../lib/supabaseWrite.js";

const TIMEZONES = [
  "Europe/Istanbul",
  "Europe/Moscow",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Tbilisi",
  "UTC",
];

const ISO_DAYS = [
  { n: 1, short: "Mon" },
  { n: 2, short: "Tue" },
  { n: 3, short: "Wed" },
  { n: 4, short: "Thu" },
  { n: 5, short: "Fri" },
  { n: 6, short: "Sat" },
  { n: 7, short: "Sun" },
];

function formatWorkingDays(days) {
  if (!Array.isArray(days) || days.length === 0) return "—";
  return ISO_DAYS.filter((d) => days.includes(d.n)).map((d) => d.short).join(" · ");
}

// --- Add / Edit modal ---
function OfficeFormModal({ open, office, onClose }) {
  const { t } = useTranslation();
  const { addOffice, updateOffice } = useOffices();
  const { addEntry: logAudit } = useAudit();

  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_OFFICE_OPS.timezone);
  const [workingDays, setWorkingDays] = useState(DEFAULT_OFFICE_OPS.workingDays);
  const [startTime, setStartTime] = useState(DEFAULT_OFFICE_OPS.workingHours.start);
  const [endTime, setEndTime] = useState(DEFAULT_OFFICE_OPS.workingHours.end);
  const [minFee, setMinFee] = useState(String(DEFAULT_OFFICE_OPS.minFeeUsd));
  const [feePct, setFeePct] = useState(String(DEFAULT_OFFICE_OPS.feePercent));

  React.useEffect(() => {
    if (open) {
      setName(office?.name || "");
      setCity(office?.city || "");
      setTimezone(office?.timezone || DEFAULT_OFFICE_OPS.timezone);
      setWorkingDays(
        Array.isArray(office?.workingDays) ? office.workingDays : DEFAULT_OFFICE_OPS.workingDays
      );
      setStartTime(office?.workingHours?.start || DEFAULT_OFFICE_OPS.workingHours.start);
      setEndTime(office?.workingHours?.end || DEFAULT_OFFICE_OPS.workingHours.end);
      setMinFee(
        String(
          Number.isFinite(Number(office?.minFeeUsd))
            ? Number(office.minFeeUsd)
            : DEFAULT_OFFICE_OPS.minFeeUsd
        )
      );
      setFeePct(
        String(
          Number.isFinite(Number(office?.feePercent))
            ? Number(office.feePercent)
            : DEFAULT_OFFICE_OPS.feePercent
        )
      );
    }
  }, [open, office]);

  const toggleDay = (n) => {
    setWorkingDays((prev) => {
      const has = prev.includes(n);
      const next = has ? prev.filter((d) => d !== n) : [...prev, n];
      return next.sort((a, b) => a - b);
    });
  };

  const validTimeRange = /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime);
  const canSubmit =
    name.trim().length > 0 && workingDays.length > 0 && validTimeRange;
  const isEdit = !!office;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const minFeeNum = Number.isFinite(Number(minFee)) ? Number(minFee) : DEFAULT_OFFICE_OPS.minFeeUsd;
    const feePctNum = Number.isFinite(Number(feePct)) ? Number(feePct) : DEFAULT_OFFICE_OPS.feePercent;
    const patch = {
      name: name.trim(),
      city: city.trim(),
      timezone,
      workingDays,
      workingHours: { start: startTime, end: endTime },
      minFeeUsd: minFeeNum,
      feePercent: feePctNum,
    };
    if (isEdit) {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () => updateOfficeRow(office.id, patch),
          { success: "Office updated", errorPrefix: "Office update failed" }
        );
        if (!res.ok) return;
      } else {
        updateOffice(office.id, patch);
      }
      logAudit({
        action: "update",
        entity: "office",
        entityId: office.id,
        summary: `Edited office ${office.name} · ${timezone} · ${formatWorkingDays(workingDays)} · ${startTime}–${endTime} · min fee $${minFeeNum}${feePctNum ? ` · ${feePctNum}%` : ""}`,
      });
    } else {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () => insertOfficeRow(patch),
          { success: "Office created", errorPrefix: "Office create failed" }
        );
        if (!res.ok || !res.result) return;
        logAudit({
          action: "create",
          entity: "office",
          entityId: res.result.id,
          summary: `Added office ${res.result.name}${res.result.city ? ` (${res.result.city})` : ""} · ${timezone}`,
        });
      } else {
        const created = addOffice(patch);
        if (created) {
          logAudit({
            action: "create",
            entity: "office",
            entityId: created.id,
            summary: `Added office ${created.name}${created.city ? ` (${created.city})` : ""} · ${timezone}`,
          });
        }
      }
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t("office_edit_title") : t("office_add_title")}
      width="md"
    >
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("office_name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Istanbul Main"
              autoFocus
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("office_city")}
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Istanbul"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold outline-none"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            Working days
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ISO_DAYS.map((d) => {
              const active = workingDays.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDay(d.n)}
                  className={`px-3 py-1.5 rounded-[8px] text-[12px] font-semibold border transition-colors ${
                    active
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
          {workingDays.length === 0 && (
            <p className="text-[11px] text-rose-700 mt-1">Pick at least one day.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              Open at
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] tabular-nums outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              Close at
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] tabular-nums outline-none"
            />
          </div>
        </div>

        {/* Fees — per-office */}
        <div className="border-t border-slate-100 pt-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            Fees
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
                Minimum fee (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={minFee}
                  onChange={(e) =>
                    setMinFee(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                  }
                  placeholder="10"
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] pl-7 pr-3 py-2.5 text-[14px] tabular-nums outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
                Fee % (optional)
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={feePct}
                  onChange={(e) =>
                    setFeePct(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                  }
                  placeholder="0"
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] pl-3 pr-7 py-2.5 text-[14px] tabular-nums outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]">%</span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">
            Applied to deals created in this office. Minimum fee is the floor — if
            the rate margin is lower, the min kicks in.
          </p>
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {isEdit ? t("save") : t("office_add")}
        </button>
      </div>
    </Modal>
  );
}

// Live clock + open/closed indicator в таймзоне офиса. Тикает каждую минуту
// (достаточно для live-status; секундной точности не надо).
function LiveClock({ office }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const tz = office?.timezone;
  if (!tz) {
    return <span className="text-[11px] text-slate-400">—</span>;
  }
  let display = "";
  let offset = "";
  try {
    display = now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    offset = tzPart?.value || "";
  } catch {
    return <span className="text-[11px] text-rose-500 font-mono">invalid tz</span>;
  }
  const state = getOfficeOpenState(office, now);
  return (
    <div className="inline-flex items-center gap-2 text-[13px]">
      <span
        className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full ${
          state.open ? "bg-emerald-500" : "bg-rose-500"
        } ${state.open ? "animate-pulse" : ""}`}
        title={state.open ? "Open now" : `Closed (${state.reason || "—"})`}
      />
      <span className="font-bold tabular-nums text-slate-900">{display}</span>
      {offset && <span className="text-[10px] text-slate-500 tabular-nums">{offset}</span>}
    </div>
  );
}

// --- Main ---
export default function OfficesTab() {
  const { t } = useTranslation();
  const { offices, closeOffice, reopenOffice } = useOffices();
  const { accounts } = useAccounts();
  const { addEntry: logAudit } = useAudit();
  const { isAdmin } = useAuth();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState(null);

  const accountsPerOffice = useMemo(() => {
    const map = new Map();
    accounts.forEach((a) => {
      if (!a.active) return;
      map.set(a.officeId, (map.get(a.officeId) || 0) + 1);
    });
    return map;
  }, [accounts]);

  const handleClose = async (office) => {
    if (!confirm(t("office_close_confirm"))) return;
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => closeOfficeRow(office.id),
        { success: "Office closed", errorPrefix: "Close failed" }
      );
      if (!res.ok) return;
    } else {
      closeOffice(office.id);
    }
    logAudit({
      action: "delete",
      entity: "office",
      entityId: office.id,
      summary: `Closed office ${office.name}`,
    });
  };

  const handleReopen = async (office) => {
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => reopenOfficeRow(office.id),
        { success: "Office reopened", errorPrefix: "Reopen failed" }
      );
      if (!res.ok) return;
    } else {
      reopenOffice(office.id);
    }
    logAudit({
      action: "update",
      entity: "office",
      entityId: office.id,
      summary: `Reopened office ${office.name}`,
    });
  };

  const openEdit = (office) => {
    setEditingOffice(office);
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingOffice(null);
    setModalOpen(true);
  };

  return (
    <div>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">{t("offices_title")}</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">{t("offices_subtitle")}</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("office_add")}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
              <th className="px-5 py-2.5 font-bold">{t("office_name")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_city")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_local_time") || "Local time"}</th>
              <th className="px-3 py-2.5 font-bold">Schedule</th>
              <th className="px-3 py-2.5 font-bold">Fees</th>
              <th className="px-3 py-2.5 font-bold">{t("office_status")}</th>
              <th className="px-3 py-2.5 font-bold text-right">Accounts</th>
              <th className="px-5 py-2.5 font-bold w-24"></th>
            </tr>
          </thead>
          <tbody>
            {offices.map((o) => {
              const count = accountsPerOffice.get(o.id) || 0;
              const isClosed = o.status === "closed" || o.active === false;
              return (
                <tr
                  key={o.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    isClosed ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-semibold text-slate-900">{o.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{o.city || "—"}</td>
                  <td className="px-3 py-3">
                    <LiveClock office={o} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="inline-flex items-start gap-1.5 text-[11px]">
                      <Clock className="w-3 h-3 text-slate-400 mt-0.5" />
                      <div>
                        <div className="text-slate-700 font-semibold tabular-nums">
                          {o.workingHours?.start || "—"}–{o.workingHours?.end || "—"}
                        </div>
                        <div className="text-slate-500">
                          {formatWorkingDays(o.workingDays)} · {o.timezone || "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-[11px] tabular-nums">
                      <span className="font-semibold text-slate-700">
                        min ${Number(o.minFeeUsd ?? 10)}
                      </span>
                      {Number(o.feePercent ?? 0) > 0 && (
                        <span className="ml-1.5 text-slate-500">
                          · {Number(o.feePercent)}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                        isClosed
                          ? "bg-slate-100 text-slate-500"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {isClosed ? t("office_status_closed") : t("office_status_active")}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {count > 0 ? (
                      <span className="font-semibold text-slate-700">{count}</span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">{t("office_no_accounts")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {isAdmin && (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openEdit(o)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors"
                          title={t("edit")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {isClosed ? (
                          <button
                            onClick={() => handleReopen(o)}
                            className="p-1.5 rounded-md text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition-colors"
                            title={t("office_reopen")}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleClose(o)}
                            className="p-1.5 rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                            title={t("office_close")}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {offices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-[13px] text-slate-400">
                  No offices
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <OfficeFormModal
        open={modalOpen}
        office={editingOffice}
        onClose={() => {
          setModalOpen(false);
          setEditingOffice(null);
        }}
      />
    </div>
  );
}
