// src/pages/settings/OfficesTab.jsx
// CRUD офисов. Использует useOffices() для state.
// Подсчёт accounts per office — через useAccounts (read-only).

import React, { useState, useMemo, useEffect } from "react";
import { Building2, Plus, Pencil, Power, RotateCcw, Clock, ChevronUp, ChevronDown, Globe, Loader2, RefreshCw } from "lucide-react";
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
  fetchSiteOffices,
  setSiteOfficeDay,
  pushSiteSchedule,
  officeToSiteWorkingHours,
  siteWorkingHoursToOffice,
  officeLocalToday,
} from "../../lib/cashdeskSite.js";
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

// Компактный диапазон рабочих дней: [1..6] → «Mon–Sat», [1..5,7] → «Mon–Fri, Sun».
function formatWorkingDays(days) {
  if (!Array.isArray(days) || days.length === 0) return "—";
  const sorted = [...new Set(days)].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (!sorted.length) return "—";
  const short = (n) => ISO_DAYS.find((d) => d.n === n)?.short || String(n);
  const runs = [];
  let s = sorted[0], p = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === p + 1) { p = sorted[i]; continue; }
    runs.push([s, p]); s = sorted[i]; p = sorted[i];
  }
  runs.push([s, p]);
  return runs.map(([a, b]) => (a === b ? short(a) : `${short(a)}–${short(b)}`)).join(", ");
}

// Короткая таймзона: «Europe/Istanbul» → «Istanbul».
function shortTz(tz) {
  if (!tz) return "—";
  return String(tz).split("/").pop().replace(/_/g, " ");
}

// iOS-style переключатель (Apple switch). role=switch, клавиатура/фокус, busy-спиннер.
function AppleToggle({ checked, onChange, disabled, busy, size = "md" }) {
  const sm = size === "sm";
  const track = sm ? "h-6 w-11" : "h-7 w-[52px]";
  const knob = sm ? "h-5 w-5" : "h-6 w-6";
  const onX = sm ? "translate-x-[22px]" : "translate-x-[26px]";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex ${track} shrink-0 items-center rounded-full transition-colors duration-300 ease-out outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-success" : "bg-black/15"
      }`}
    >
      <span
        className={`inline-flex ${knob} items-center justify-center rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-300 ease-out ${
          checked ? onX : "translate-x-0.5"
        }`}
      >
        {busy && <Loader2 className="w-3 h-3 animate-spin text-muted" />}
      </span>
    </button>
  );
}

// --- Site (coinpoint) binding + live availability controls ---
// Привязка кассового офиса к офису сайта + управление доступностью касса→сайт.
// Пока рубильник на бэке выключен (CASHDESK_SYNC_TO_SITE≠'on') — запись
// отвечает { dryRun:true } и мы показываем «предпросмотр», сайт не трогается.
function SiteOfficeControls({ open, code, setCode, scheduleSource, timezone, onApplySite }) {
  const [list, setList] = useState(null); // null=загрузка, []=нет/ошибка
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, dryRun, text }
  const [dayDate, setDayDate] = useState("");
  const [dayReason, setDayReason] = useState("");
  const [dayOpen, setDayOpen] = useState(true); // положение тумблера (оптимистично)

  const reload = React.useCallback(async () => {
    setList(null);
    setLoadErr("");
    try {
      const { offices, syncEnabled: se } = await fetchSiteOffices();
      setList(offices);
      setSyncEnabled(se);
    } catch (e) {
      setList([]);
      setLoadErr(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDayReason("");
    setDayOpen(true);
    setDayDate(officeLocalToday({ timezone }));
    reload();
  }, [open, timezone, reload]);

  const codeKnown = !list ? true : list.some((o) => o.code === code);

  const runAction = async (fn, describe) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fn();
      const dry = !!res?.dryRun;
      setResult({
        ok: true,
        dryRun: dry,
        text: dry ? `Предпросмотр: ${describe} (синхронизация выключена — сайт не тронут)` : `${describe} — применено на сайте`,
      });
    } catch (e) {
      setResult({ ok: false, dryRun: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  // Тумблер Открыт/Выходной: оптимистично двигаем, при ошибке откатываем.
  const toggleDay = async (next) => {
    const date = dayDate || officeLocalToday({ timezone });
    const status = next ? "open" : "closed";
    setDayOpen(next);
    setBusy(true);
    setResult(null);
    try {
      const res = await setSiteOfficeDay({ code, date, status, reason: dayReason || undefined });
      const dry = !!res?.dryRun;
      const label = next ? `открыть ${code} на ${date}` : `выходной ${code} на ${date}`;
      setResult({
        ok: true,
        dryRun: dry,
        text: dry ? `Предпросмотр: ${label} (синхронизация выключена — сайт не тронут)` : `${label} — применено на сайте`,
      });
    } catch (e) {
      setDayOpen(!next); // откат
      setResult({ ok: false, dryRun: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  const doSchedule = () =>
    runAction(
      () => pushSiteSchedule({ code, workingHours: officeToSiteWorkingHours(scheduleSource) }),
      `расписание ${code}`
    );

  return (
    <div className="border-t border-border-soft pt-4 lg:border-t-0 lg:pt-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-tiny font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" /> Офис на сайте (coinpoint)
        </div>
        <button
          type="button"
          onClick={reload}
          className="text-tiny text-muted hover:text-ink inline-flex items-center gap-1"
          title="Обновить список офисов сайта"
        >
          <RefreshCw className={`w-3 h-3 ${list === null ? "animate-spin" : ""}`} /> обновить
        </button>
      </div>

      {/* Привязка: дропдаун из живого списка + ручной ввод как фолбэк */}
      {list && list.length > 0 ? (
        <select
          value={codeKnown ? code : "__manual__"}
          onChange={(e) => setCode(e.target.value === "__manual__" ? code : e.target.value === "__none__" ? "" : e.target.value)}
          className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
        >
          <option value="__none__">— не привязан (не на сайте) —</option>
          {list.map((o) => (
            <option key={o.code} value={o.code}>
              {o.code}{o.city ? ` · ${o.city}` : ""}{o.is_active === false ? " · выкл" : ""}
            </option>
          ))}
          <option value="__manual__">ввести код вручную…</option>
        </select>
      ) : (
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          placeholder="напр. antalya_lara / ist_taksim / msk_arbat"
          className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body font-mono outline-none"
        />
      )}
      {(!codeKnown && list && list.length > 0) && (
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          placeholder="код офиса сайта вручную"
          className="w-full mt-2 bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body font-mono outline-none"
        />
      )}
      {loadErr && (
        <p className="text-tiny text-muted mt-1.5">Список офисов сайта недоступен ({loadErr}). Введите код вручную.</p>
      )}
      <p className="text-tiny text-muted mt-1.5">
        Пусто = офис не отражается на сайте. Управление «выходной / открыт» ниже применяется именно к этому офису сайта.
      </p>

      {/* Живые действия — только когда офис привязан */}
      {code ? (
        <div className="mt-3 rounded-card border border-border-soft bg-surface-soft/50 p-3 space-y-3">
          {/* Рубильник-статус */}
          <div
            className={`text-tiny font-semibold px-2 py-1.5 rounded-md inline-flex items-center gap-1.5 ${
              syncEnabled ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${syncEnabled ? "bg-success" : "bg-warning"}`} />
            {syncEnabled ? "Синхронизация с сайтом включена" : "Предпросмотр — запись на сайт выключена"}
          </div>

          {/* Apple-тумблер: Открыт ↔ Выходной на выбранную дату */}
          <div className="flex items-center justify-between gap-3 rounded-card bg-white border border-border-soft px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-body-sm font-semibold ${dayOpen ? "text-success" : "text-danger"}`}>
                  {dayOpen ? "Открыт" : "Выходной"}
                </span>
                {busy && <Loader2 className="w-3 h-3 animate-spin text-muted-soft" />}
              </div>
              <div className="text-tiny text-muted mt-0.5 truncate">
                {dayDate === officeLocalToday({ timezone }) ? "сегодня" : dayDate} · офис на сайте
              </div>
            </div>
            <AppleToggle checked={dayOpen} onChange={toggleDay} disabled={busy} busy={busy} />
          </div>

          {/* Дата (по умолчанию сегодня) + причина выходного */}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wide">Дата</label>
              <input
                type="date"
                value={dayDate}
                onChange={(e) => setDayDate(e.target.value)}
                className="bg-white border border-border-soft rounded-card px-2.5 py-2 text-body-sm outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wide">Причина выходного (необяз.)</label>
              <input
                type="text"
                value={dayReason}
                onChange={(e) => setDayReason(e.target.value)}
                placeholder="напр. праздник"
                className="w-full bg-white border border-border-soft rounded-card px-2.5 py-2 text-body-sm outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {onApplySite && (
              <button
                type="button"
                disabled={busy || !list}
                onClick={() => {
                  const so = (list || []).find((o) => o.code === code);
                  if (so) { onApplySite(so); setResult({ ok: true, dryRun: false, text: `Настройки офиса ${code} подтянуты с сайта — проверьте и нажмите «Сохранить».` }); }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk disabled:opacity-50 transition"
                title="Заполнить расписание кассового офиса реальными настройками с сайта"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Настройки ← сайт
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={doSchedule}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-ink text-white text-body-sm font-semibold hover:bg-ink disabled:opacity-50 transition"
              title="Отправить текущее недельное расписание кассы на сайт"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />} Расписание → сайт
            </button>
          </div>

          {result && (
            <div
              className={`text-tiny rounded-md px-2 py-1.5 ${
                !result.ok
                  ? "bg-danger-soft text-danger"
                  : result.dryRun
                  ? "bg-warning-soft text-warning"
                  : "bg-success-soft text-success"
              }`}
            >
              {result.text}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
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
  // Код офиса на сайте (coinpoint.offices.code) — управление доступностью касса→сайт.
  const [coinpointCode, setCoinpointCode] = useState("");
  // Per-day hours override: { "6": {start, end} | null } — null = закрыт в этот день
  const [workingHoursByDay, setWorkingHoursByDay] = useState(null);
  // Holidays (YYYY-MM-DD строки)
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState("");
  // Temp closure
  const [tempClosedUntil, setTempClosedUntil] = useState("");
  const [tempClosedReason, setTempClosedReason] = useState("");

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
      setWorkingHoursByDay(
        office?.workingHoursByDay && typeof office.workingHoursByDay === "object"
          ? office.workingHoursByDay
          : null
      );
      setHolidays(Array.isArray(office?.holidays) ? office.holidays : []);
      setNewHoliday("");
      setTempClosedUntil(
        office?.tempClosedUntil
          ? new Date(office.tempClosedUntil).toISOString().slice(0, 16)
          : ""
      );
      setTempClosedReason(office?.tempClosedReason || "");
      setCoinpointCode(office?.coinpointOfficeCode || "");
    }
  }, [open, office]);

  const toggleDayOverride = (n) => {
    // 3 состояния: same as общие часы (key не в объекте) → own hours →
    // closed (null) → same (remove key). Click циклит.
    setWorkingHoursByDay((prev) => {
      const cur = prev || {};
      const key = String(n);
      const state = cur[key] === undefined ? "same" : cur[key] === null ? "closed" : "custom";
      const next = { ...cur };
      if (state === "same") {
        // → custom: copy общие часы
        next[key] = { start: startTime, end: endTime };
      } else if (state === "custom") {
        next[key] = null;
      } else {
        delete next[key];
      }
      // Если всё пустое — вернуть null (использовать общие для всех)
      return Object.keys(next).length === 0 ? null : next;
    });
  };

  const setDayHours = (n, field, value) => {
    setWorkingHoursByDay((prev) => {
      const cur = prev || {};
      const key = String(n);
      const existing = cur[key] && typeof cur[key] === "object"
        ? cur[key]
        : { start: startTime, end: endTime };
      const next = { ...cur, [key]: { ...existing, [field]: value } };
      return next;
    });
  };

  const addHoliday = () => {
    const val = newHoliday.trim();
    if (!val) return;
    if (holidays.includes(val)) {
      setNewHoliday("");
      return;
    }
    setHolidays([...holidays, val].sort());
    setNewHoliday("");
  };

  const removeHoliday = (d) => setHolidays(holidays.filter((x) => x !== d));

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
      workingHoursByDay: workingHoursByDay && Object.keys(workingHoursByDay).length > 0
        ? workingHoursByDay
        : null,
      holidays: holidays.filter(Boolean),
      tempClosedUntil: tempClosedUntil ? new Date(tempClosedUntil).toISOString() : null,
      tempClosedReason: tempClosedReason.trim() || null,
      minFeeUsd: minFeeNum,
      feePercent: feePctNum,
      coinpointOfficeCode: coinpointCode.trim() || null,
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
      width="4xl"
    >
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4 items-start">
        {/* Левая колонка — расписание и комиссии офиса */}
        <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-tiny font-semibold text-muted mb-1.5 uppercase tracking-wide">
              {t("office_name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Istanbul Main"
              autoFocus
              className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2.5 text-body outline-none"
            />
          </div>
          <div>
            <label className="block text-tiny font-semibold text-muted mb-1.5 uppercase tracking-wide">
              {t("office_city")}
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Istanbul"
              className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2.5 text-body outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-tiny font-semibold text-muted mb-1.5 uppercase tracking-wide">
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body font-semibold outline-none"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-tiny font-semibold text-muted mb-1.5 uppercase tracking-wide">
            {t("office_working_days")}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ISO_DAYS.map((d) => {
              const active = workingDays.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDay(d.n)}
                  className={`px-3 py-1.5 rounded-button text-caption font-semibold border transition-colors ${
                    active
                      ? "bg-ink text-white border-ink"
                      : "bg-white text-ink-soft border-border-soft hover:border-border"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
          {workingDays.length === 0 && (
            <p className="text-tiny text-danger mt-1">Pick at least one day.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-tiny font-semibold text-muted mb-1.5 uppercase tracking-wide">
              {t("office_open_at")}
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body tabular-nums outline-none"
            />
          </div>
          <div>
            <label className="block text-tiny font-semibold text-muted mb-1.5 uppercase tracking-wide">
              {t("office_close_at")}
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body tabular-nums outline-none"
            />
          </div>
        </div>

        {/* Per-day hours override (expandable) */}
        <details className="border-t border-border-soft pt-4">
          <summary className="cursor-pointer text-tiny font-bold text-muted uppercase tracking-wider hover:text-ink select-none">
            {t("office_per_day_title")}
            <span className="ml-2 text-tiny font-normal normal-case text-muted-soft">
              {t("office_per_day_hint")}
            </span>
          </summary>
          <div className="mt-3 space-y-1">
            {ISO_DAYS.filter((d) => workingDays.includes(d.n)).map((d) => {
              const key = String(d.n);
              const override = workingHoursByDay?.[key];
              const state =
                override === undefined ? "same" : override === null ? "closed" : "custom";
              return (
                <div key={d.n} className="flex items-center gap-2 text-caption">
                  <span className="w-10 text-ink-soft font-semibold">{d.short}</span>
                  <button
                    type="button"
                    onClick={() => toggleDayOverride(d.n)}
                    className={`px-2 py-1 rounded-[6px] text-tiny font-bold uppercase tracking-wider ${
                      state === "same"
                        ? "bg-surface-sunk text-ink-soft"
                        : state === "closed"
                        ? "bg-rose-100 text-danger"
                        : "bg-indigo-100 text-accent"
                    }`}
                  >
                    {state === "same" ? t("office_day_same") : state === "closed" ? t("office_day_closed") : t("office_day_custom")}
                  </button>
                  {state === "custom" && override && (
                    <>
                      <input
                        type="time"
                        value={override.start || ""}
                        onChange={(e) => setDayHours(d.n, "start", e.target.value)}
                        className="bg-white border border-border-soft rounded-[6px] px-2 py-1 text-caption tabular-nums outline-none"
                      />
                      <span className="text-muted-soft">–</span>
                      <input
                        type="time"
                        value={override.end || ""}
                        onChange={(e) => setDayHours(d.n, "end", e.target.value)}
                        className="bg-white border border-border-soft rounded-[6px] px-2 py-1 text-caption tabular-nums outline-none"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </details>

        {/* Holidays */}
        <details className="border-t border-border-soft pt-4">
          <summary className="cursor-pointer text-tiny font-bold text-muted uppercase tracking-wider hover:text-ink select-none">
            {t("office_holidays")}
            <span className="ml-2 text-tiny font-normal normal-case text-muted-soft">
              ({holidays.length})
            </span>
          </summary>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={newHoliday}
                onChange={(e) => setNewHoliday(e.target.value)}
                className="flex-1 bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-button px-2.5 py-1.5 text-caption tabular-nums outline-none"
              />
              <button
                type="button"
                onClick={addHoliday}
                disabled={!newHoliday}
                className="px-3 py-1.5 rounded-button bg-ink text-white text-tiny font-semibold hover:bg-ink disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + {t("office_holiday_add")}
              </button>
            </div>
            {holidays.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {holidays.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger-soft border border-danger/20 text-tiny font-medium text-danger tabular-nums"
                  >
                    {d}
                    <button
                      type="button"
                      onClick={() => removeHoliday(d)}
                      className="text-danger hover:text-danger"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </details>

        {/* Temporary closure */}
        <details className="border-t border-border-soft pt-4">
          <summary className="cursor-pointer text-tiny font-bold text-muted uppercase tracking-wider hover:text-ink select-none">
            {t("office_temp_closure")}
            {tempClosedUntil && (
              <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-danger text-micro font-bold tracking-wider uppercase">
                {t("office_temp_active")}
              </span>
            )}
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wide">
                {t("office_temp_until")}
              </label>
              <input
                type="datetime-local"
                value={tempClosedUntil}
                onChange={(e) => setTempClosedUntil(e.target.value)}
                className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body-sm tabular-nums outline-none"
              />
            </div>
            <div>
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wide">
                {t("office_temp_reason")}
              </label>
              <input
                type="text"
                value={tempClosedReason}
                onChange={(e) => setTempClosedReason(e.target.value)}
                placeholder={t("office_temp_reason_ph")}
                className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body-sm outline-none"
              />
            </div>
            {tempClosedUntil && (
              <div className="col-span-2">
                <button
                  type="button"
                  onClick={() => { setTempClosedUntil(""); setTempClosedReason(""); }}
                  className="text-tiny font-semibold text-ink-soft hover:text-danger"
                >
                  {t("office_temp_reopen")}
                </button>
              </div>
            )}
          </div>
        </details>

        {/* Fees — per-office */}
        <div className="border-t border-border-soft pt-4">
          <div className="text-tiny font-bold text-muted uppercase tracking-wider mb-2">
            {t("office_fees")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wide">
                {t("office_min_fee")}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft text-body-sm">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={minFee}
                  onChange={(e) =>
                    setMinFee(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                  }
                  placeholder="10"
                  className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card pl-7 pr-3 py-2.5 text-body tabular-nums outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wide">
                {t("office_fee_percent")}
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
                  className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card pl-3 pr-7 py-2.5 text-body tabular-nums outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-soft text-body-sm">%</span>
              </div>
            </div>
          </div>
          <p className="text-tiny text-muted mt-1.5">
            {t("office_fees_hint")}
          </p>
        </div>
        </div>

        {/* Правая колонка — привязка к офису сайта (coinpoint) + доступность */}
        <div className="space-y-4">
          <SiteOfficeControls
            open={open}
            code={coinpointCode}
            setCode={setCoinpointCode}
            timezone={timezone}
            scheduleSource={{
              workingDays,
              workingHours: { start: startTime, end: endTime },
              workingHoursByDay,
            }}
            onApplySite={(so) => {
              const s = siteWorkingHoursToOffice(so?.working_hours);
              if (!s) return;
              setWorkingDays(s.workingDays);
              setStartTime(s.startTime);
              setEndTime(s.endTime);
              setWorkingHoursByDay(s.workingHoursByDay);
            }}
          />
        </div>
      </div>
      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-card text-body-sm font-semibold transition-colors ${
            canSubmit
              ? "bg-ink text-white hover:bg-ink"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
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
    return <span className="text-tiny text-muted-soft">—</span>;
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
    return <span className="text-tiny text-danger font-mono">invalid tz</span>;
  }
  const state = getOfficeOpenState(office, now);
  return (
    <div className="inline-flex items-center gap-2 text-body-sm">
      <span
        className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full ${
          state.open ? "bg-success" : "bg-danger"
        } ${state.open ? "animate-pulse" : ""}`}
        title={state.open ? "Open now" : `Closed (${state.reason || "—"})`}
      />
      <span className="font-bold tabular-nums text-ink">{display}</span>
      {offset && <span className="text-tiny text-muted tabular-nums">{offset}</span>}
    </div>
  );
}

// --- Main ---
export default function OfficesTab() {
  const { t } = useTranslation();
  const { offices, closeOffice, reopenOffice, swapOfficesOrder } = useOffices();
  const { accounts } = useAccounts();
  const { addEntry: logAudit } = useAudit();
  const { isAdmin } = useAuth();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState(null);

  // Живой статус офисов сайта (coinpoint) для тумблера «На сайте» в таблице.
  const [siteByCode, setSiteByCode] = useState({}); // code → { today, ... }
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [siteLoaded, setSiteLoaded] = useState(false);
  const [siteHint, setSiteHint] = useState(""); // предпросмотр/ошибка внизу
  const [openByCode, setOpenByCode] = useState({}); // оптимистичное положение тумблеров
  const [busyCode, setBusyCode] = useState(null);

  const loadSite = React.useCallback(async () => {
    try {
      const { offices: so, syncEnabled: se } = await fetchSiteOffices();
      const map = {};
      const openMap = {};
      so.forEach((o) => {
        map[o.code] = o;
        openMap[o.code] = o?.today?.status ? o.today.status !== "closed" : true;
      });
      setSiteByCode(map);
      setOpenByCode(openMap);
      setSyncEnabled(se);
    } catch {
      /* мост недоступен — тумблеры покажем в дефолте, действие даст ошибку */
    } finally {
      setSiteLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadSite();
  }, [loadSite]);

  const toggleSite = async (office, next) => {
    const code = office.coinpointOfficeCode;
    if (!code) return;
    const date = officeLocalToday({ timezone: office.timezone });
    setOpenByCode((m) => ({ ...m, [code]: next }));
    setBusyCode(code);
    setSiteHint("");
    try {
      const res = await setSiteOfficeDay({ code, date, status: next ? "open" : "closed" });
      const label = `${office.name}: ${next ? "открыт" : "выходной"} (${date})`;
      setSiteHint(res?.dryRun ? `Предпросмотр — ${label}. Сайт не тронут (синхронизация выключена).` : `${label} — применено на сайте.`);
    } catch (e) {
      setOpenByCode((m) => ({ ...m, [code]: !next })); // откат
      setSiteHint(`Ошибка: ${e?.message || e}`);
    } finally {
      setBusyCode(null);
    }
  };

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
      <div className="px-5 py-4 border-b border-border-soft flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">{t("offices_title")}</h2>
          <p className="text-caption text-muted mt-0.5">{t("offices_subtitle")}</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-ink text-white text-body-sm font-semibold hover:bg-ink transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("office_add")}
          </button>
        )}
      </div>
      {siteHint && (
        <div className="px-5 py-2 border-b border-border-soft bg-surface-soft/40 text-tiny text-ink-soft">
          {siteHint}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-tiny font-bold text-muted tracking-[0.1em] uppercase border-b border-border-soft bg-surface-soft/40">
              {isAdmin && <th className="px-2 py-2.5 font-bold w-10"></th>}
              <th className="px-5 py-2.5 font-bold">{t("office_name")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_city")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_local_time") || "Local time"}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_schedule")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_fees")}</th>
              <th className="px-3 py-2.5 font-bold">{t("office_status")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("office_accounts")}</th>
              <th className="px-5 py-2.5 font-bold w-24"></th>
            </tr>
          </thead>
          <tbody>
            {offices.map((o, idx) => {
              const count = accountsPerOffice.get(o.id) || 0;
              const isClosed = o.status === "closed" || o.active === false;
              const isFirst = idx === 0;
              const isLast = idx === offices.length - 1;
              return (
                <tr
                  key={o.id}
                  className={`border-b border-border-soft hover:bg-surface-soft transition-colors ${
                    isClosed ? "opacity-60" : ""
                  }`}
                >
                  {isAdmin && (
                    <td className="px-2 py-3">
                      <div className="flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => {
                            const prev = offices[idx - 1];
                            if (prev) swapOfficesOrder(o.id, prev.id);
                          }}
                          disabled={isFirst}
                          className="p-0.5 rounded text-muted-soft hover:text-ink hover:bg-surface-sunk disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                          title="Переместить вверх"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            const next = offices[idx + 1];
                            if (next) swapOfficesOrder(o.id, next.id);
                          }}
                          disabled={isLast}
                          className="p-0.5 rounded text-muted-soft hover:text-ink hover:bg-surface-sunk disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                          title="Переместить вниз"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-muted-soft" />
                      <span className="font-semibold text-ink">{o.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-ink-soft">{o.city || "—"}</td>
                  <td className="px-3 py-3">
                    <LiveClock office={o} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="inline-flex items-start gap-1.5 text-tiny">
                      <Clock className="w-3 h-3 text-muted-soft mt-0.5" />
                      <div>
                        <div className="text-ink-soft font-semibold tabular-nums">
                          {o.workingHours?.start || "—"}–{o.workingHours?.end || "—"}
                        </div>
                        <div className="text-muted">
                          {formatWorkingDays(o.workingDays)} · {shortTz(o.timezone)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-tiny tabular-nums">
                      <span className="font-semibold text-ink-soft">
                        min ${Number(o.minFeeUsd ?? 10)}
                      </span>
                      {Number(o.feePercent ?? 0) > 0 && (
                        <span className="ml-1.5 text-muted">
                          · {Number(o.feePercent)}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-tiny font-semibold ${
                          isClosed
                            ? "bg-surface-sunk text-muted"
                            : "bg-success-soft text-success"
                        }`}
                      >
                        {isClosed ? t("office_status_closed") : t("office_status_active")}
                      </span>
                      {o.coinpointOfficeCode && (
                        <span className="inline-flex items-center gap-1.5" title="Открыт / выходной на сайте (coinpoint), сегодня">
                          <Globe className="w-3 h-3 text-muted-soft" />
                          <AppleToggle
                            size="sm"
                            checked={openByCode[o.coinpointOfficeCode] ?? true}
                            busy={busyCode === o.coinpointOfficeCode}
                            disabled={!isAdmin || busyCode === o.coinpointOfficeCode || !siteLoaded}
                            onChange={(next) => toggleSite(o, next)}
                          />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {count > 0 ? (
                      <span className="font-semibold text-ink-soft">{count}</span>
                    ) : (
                      <span className="text-muted-soft text-tiny">{t("office_no_accounts")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {isAdmin && (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openEdit(o)}
                          className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-sunk transition-colors"
                          title={t("edit")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {isClosed ? (
                          <button
                            onClick={() => handleReopen(o)}
                            className="p-1.5 rounded-md text-success hover:text-success hover:bg-success-soft transition-colors"
                            title={t("office_reopen")}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleClose(o)}
                            className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-danger-soft transition-colors"
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
                <td colSpan={isAdmin ? 9 : 8} className="px-5 py-12 text-center text-body-sm text-muted-soft">
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
