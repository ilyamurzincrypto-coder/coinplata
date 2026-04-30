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
  const officeId = typeof currentOffice === "string" ? currentOffice : currentOffice?.id;
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

  if (!officeId) return null;

  const { state, lastDate } = classifyStatus(latest);
  const config = {
    closed: {
      label: t("cc_badge_closed"),
      sub: lastDate ? `${relativeDay(lastDate)} ${formatTime(lastDate)}` : "",
      icon: CheckCircle2,
      cls: "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-slate-200",
      iconCls: "text-emerald-500",
      dot: "bg-emerald-500",
    },
    open: {
      label: t("cc_badge_close"),
      sub: lastDate ? relativeDay(lastDate) : t("cc_never_closed"),
      icon: Lock,
      cls: "bg-amber-50/80 text-amber-900 hover:bg-amber-100 ring-amber-200/70",
      iconCls: "text-amber-600",
      dot: "bg-amber-500",
    },
    overdue: {
      label: t("cc_badge_overdue"),
      sub: lastDate ? `${t("cc_overdue_sub")} · ${relativeDay(lastDate)}` : t("cc_never_closed"),
      icon: AlertTriangle,
      cls: "bg-rose-50/90 text-rose-900 hover:bg-rose-100 ring-rose-200",
      iconCls: "text-rose-600",
      dot: "bg-rose-500 animate-pulse",
    },
  }[state];

  const Icon = config.icon;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title={`${config.label} · ${config.sub}`}
        className={`group inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full ring-1 ${config.cls} transition-all duration-150 active:scale-[0.97]`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot} shrink-0`} />
        <Icon className={`w-3 h-3 shrink-0 ${config.iconCls}`} />
        <span className="text-[11.5px] font-semibold tracking-tight hidden md:inline">
          {config.label}
        </span>
        <span className="text-[10px] opacity-60 hidden lg:inline tabular-nums">
          {config.sub}
        </span>
        <span className="text-[11.5px] font-semibold tracking-tight md:hidden">
          {state === "closed" ? "✓" : "Закрыть"}
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
