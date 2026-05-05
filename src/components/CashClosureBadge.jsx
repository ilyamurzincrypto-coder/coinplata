// src/components/CashClosureBadge.jsx
//
// Header pill: статус закрытия кассы для текущего офиса.
//
// Состояния:
//   🟢 closed  — есть active closure с closure_date = сегодня
//   🟡 open    — кассу ещё не закрывали сегодня (но вчера или ранее закрывали)
//                ИЛИ ни одного закрытия не было
//   🔴 overdue — последнее закрытие было >1 рабочего дня назад
//                (упрощённо: >1 календарного дня)
//
// Click → открывает CashClosureModal.
// Subscribe на onDataBump — refresh после создания/отмены closure.

import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import CashClosureModal from "./CashClosureModal.jsx";
import { loadLatestCashClosure } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useOffices } from "../store/offices.jsx";
import { useToast } from "../lib/toast.jsx";

// Парсит "HH:MM" → Date на сегодня в локалтайме браузера. Если строка
// невалидна — возвращает null. Офисы хранят workingHours.{start,end}
// в локальном времени офиса; для предупреждения «осталось 10 мин»
// сейчас используем локалтайм браузера — этого достаточно когда
// браузер и офис в одной зоне (что верно для кассира на месте).
function parseHHMMtoToday(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [hh, mm] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
}

// Минут до момента target. Отрицательно если target уже прошёл.
function minutesUntil(target) {
  if (!target) return Infinity;
  return (target.getTime() - Date.now()) / 60000;
}

const WARN_THRESHOLD_MIN = 10;

function classifyStatus(latest) {
  if (!latest) return { state: "open", lastDate: null };
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (latest.closureDate === today) {
    return { state: "closed", lastDate: latest.createdAt };
  }
  if (latest.closureDate === yesterday) {
    return { state: "open", lastDate: latest.createdAt };
  }
  return { state: "overdue", lastDate: latest.createdAt };
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function relativeDay(iso) {
  if (!iso) return "—";
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const date = new Date(iso).toISOString().slice(0, 10);
  if (date === today) return "сегодня";
  if (date === yesterday) return "вчера";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function CashClosureBadge({ currentOffice }) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  const toast = useToast();
  const officeId = typeof currentOffice === "string" ? currentOffice : currentOffice?.id;
  const office = officeId ? findOffice(officeId) : null;
  const closeTimeStr = office?.workingHours?.end || null;
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Fetch + subscribe
  useEffect(() => {
    if (!officeId) {
      setLatest(null);
      return;
    }
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      try {
        const r = await loadLatestCashClosure(officeId);
        if (!cancelled) setLatest(r);
      } catch {
        if (!cancelled) setLatest(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    const unsub = onDataBump(() => { if (!cancelled) fetch(); });
    return () => { cancelled = true; unsub?.(); };
  }, [officeId]);

  // Уведомление «через 10 мин закрытие, посчитайте кассу» — раз в день
  // на офис, через useToast().info(). Тикер раз в минуту, гард в
  // localStorage чтобы тост не повторялся.
  useEffect(() => {
    if (!officeId || !closeTimeStr) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    const stamp = `cc_warn:${officeId}:${todayKey}`;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      try {
        if (localStorage.getItem(stamp)) return;
      } catch {}
      const close = parseHHMMtoToday(closeTimeStr);
      if (!close) return;
      const mins = minutesUntil(close);
      // Окно [0; WARN_THRESHOLD_MIN]. Если уже прошло (mins<0) — поздно,
      // не показываем.
      if (mins > 0 && mins <= WARN_THRESHOLD_MIN) {
        const officeName = office?.name || "";
        const msg = t("cc_warn_close_soon")
          ? t("cc_warn_close_soon")
              .replace("{office}", officeName)
              .replace("{min}", String(Math.max(1, Math.ceil(mins))))
              .replace("{time}", closeTimeStr)
          : `${officeName} закрывается через ${Math.max(1, Math.ceil(mins))} мин — посчитайте кассу`;
        toast.info(msg);
        try {
          localStorage.setItem(stamp, "1");
        } catch {}
      }
    };

    tick(); // immediate проверка при монтировании
    const id = setInterval(tick, 60000); // далее каждую минуту
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [officeId, closeTimeStr, office?.name, t, toast]);

  if (!officeId) return null;

  const { state, lastDate } = classifyStatus(latest);

  // Перед открытием модалки — если ещё рабочий день (>10 мин до
  // закрытия) и касса ещё открыта (state !== closed), спрашиваем
  // подтверждение через стандартный confirm().
  const handleOpen = () => {
    const close = parseHHMMtoToday(closeTimeStr);
    const mins = close ? minutesUntil(close) : null;
    if (state !== "closed" && mins != null && mins > WARN_THRESHOLD_MIN) {
      const ok = window.confirm(
        t("cc_confirm_during_workday") ||
          "Рабочий день ещё идёт. Точно закрыть кассу?"
      );
      if (!ok) return;
    }
    setModalOpen(true);
  };
  // Apple-style: тот же визуальный язык что OfficeSwitcher рядом —
  // bg-white, border-slate-200, rounded-[10px], px-3 py-1.5, text-[13px].
  // Состояние выражается ТОЛЬКО через цветную точку слева. Без цветных фонов.
  const config = {
    closed: {
      label: t("cc_badge_closed"),
      sub: lastDate ? `${relativeDay(lastDate)} ${formatTime(lastDate)}` : "",
      icon: CheckCircle2,
      iconCls: "text-emerald-500",
      dot: "bg-emerald-500",
    },
    open: {
      label: t("cc_badge_close"),
      sub: lastDate ? relativeDay(lastDate) : t("cc_never_closed"),
      icon: Lock,
      iconCls: "text-slate-400",
      dot: "bg-amber-500",
    },
    overdue: {
      label: t("cc_badge_overdue"),
      sub: lastDate ? `${t("cc_overdue_sub")} · ${relativeDay(lastDate)}` : t("cc_never_closed"),
      icon: AlertTriangle,
      iconCls: "text-rose-500",
      dot: "bg-rose-500 animate-pulse",
    },
  }[state];

  const Icon = config.icon;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        title={`${config.label} · ${config.sub}`}
        className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] border border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:shadow-sm transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <span className="relative flex items-center justify-center shrink-0">
          <span className={`w-2 h-2 rounded-full ${config.dot}`} />
        </span>
        <Icon className={`w-3.5 h-3.5 shrink-0 ${config.iconCls}`} />
        <span className="text-[13px] font-semibold truncate hidden md:inline">
          {config.label}
        </span>
        <span className="text-[13px] font-semibold md:hidden">
          {state === "closed" ? "✓" : t("cc_badge_close")}
        </span>
      </button>

      <CashClosureModal
        open={modalOpen}
        currentOffice={officeId}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
