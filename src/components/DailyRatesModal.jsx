// src/components/DailyRatesModal.jsx
// Компактная модалка быстрого ежедневного обновления курсов.
// Показывает все default pairs в две колонки (a→b и b→a на одной строке).
// Инпут пустой = не трогать; заполненный и отличающийся от текущего — в diff.
// На submit батчом через rpcImportRates (atomic + snapshot для истории).

import React, { useState, useEffect, useMemo } from "react";
import { Zap, ArrowRight, Search, X } from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useRates } from "../store/rates.jsx";
import { useAudit } from "../store/audit.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcImportRates, withToast } from "../lib/supabaseWrite.js";

function formatRate(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 10) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function timeAgo(date) {
  if (!date) return "—";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// Короткая подпись "изм. DD.MM HH:MM" для метки под курсом.
function formatUpdatedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DailyRatesModal({ open, onClose }) {
  const { t } = useTranslation();
  const { allTradePairs, getRate, lastUpdated, pairs, channels } = useRates();
  const { addEntry: logAudit } = useAudit();
  const [inputs, setInputs] = useState({}); // { "FROM_TO": "value" }
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setInputs({});
      setQuery("");
    }
  }, [open]);

  // Helper: найти pair по валютам и вернуть {updatedAt, rate, baseRate, spreadPercent, isMaster}
  const pairInfo = useMemo(() => {
    const m = new Map();
    const channelCur = (chId) => channels.find((c) => c.id === chId)?.currencyCode;
    pairs.forEach((p) => {
      if (!p.isDefault) return;
      const f = channelCur(p.fromChannelId);
      const t = channelCur(p.toChannelId);
      if (f && t) {
        m.set(`${f}_${t}`, {
          updatedAt: p.updatedAt,
          rate: p.rate,
          baseRate: p.baseRate,
          spreadPercent: p.spreadPercent,
          isMaster: p.isMaster === true,
        });
      }
    });
    return m;
  }, [pairs, channels]);

  // НОВАЯ модель: одна строка на логическую пару = master direction.
  // Reverse считается автоматически по 1/master через trigger в БД (0046).
  // Если master pair найдена — используем её; если нет (legacy data до
  // миграции) — fallback на первую существующую sторону.
  const rows = useMemo(() => {
    const out = [];
    (allTradePairs || []).forEach(([a, b]) => {
      const ab = pairInfo.get(`${a}_${b}`);
      const ba = pairInfo.get(`${b}_${a}`);
      // Master direction: где is_master=true. Если ни одна не master,
      // берём ту что соответствует приоритету (a первый в allTradePairs
      // уже отсортирован priority-aware).
      let from, to;
      if (ab?.isMaster) {
        from = a; to = b;
      } else if (ba?.isMaster) {
        from = b; to = a;
      } else {
        from = a; to = b;
      }
      out.push({ from, to });
    });
    return out;
  }, [allTradePairs, pairInfo]);

  // Фильтр по поиску — match по FROM или TO (case-insensitive)
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.from.toLowerCase().includes(q) ||
        r.to.toLowerCase().includes(q) ||
        `${r.from}${r.to}`.toLowerCase().includes(q) ||
        `${r.from} ${r.to}`.toLowerCase().includes(q) ||
        `${r.from}→${r.to}`.toLowerCase().includes(q)
    );
  }, [rows, query]);

  // Собираем "изменения" — только заполненные и != текущему.
  const changes = useMemo(() => {
    const list = [];
    Object.entries(inputs).forEach(([key, val]) => {
      const s = String(val || "").trim().replace(",", ".");
      if (!s) return;
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return;
      const [from, to] = key.split("_");
      const current = getRate(from, to);
      if (!Number.isFinite(current) || Math.abs(n - current) > 1e-9) {
        list.push({ from, to, rate: n });
      }
    });
    return list;
  }, [inputs, getRate]);

  const handleChange = (from, to, val) => {
    setInputs((prev) => ({ ...prev, [`${from}_${to}`]: val }));
  };

  const handleSubmit = async () => {
    if (changes.length === 0 || busy) return;
    if (!isSupabaseConfigured) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await withToast(
        () => rpcImportRates(changes, `Daily update ${today}`),
        { success: `Updated ${changes.length} rate(s)`, errorPrefix: "Update failed" }
      );
      if (res.ok) {
        logAudit({
          action: "update",
          entity: "rate",
          entityId: `daily_${today}`,
          summary: `Daily update: ${changes
            .map((c) => `${c.from}→${c.to}=${c.rate}`)
            .join(", ")}`,
        });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("quick_rates_title") || "Быстрое обновление курсов"}
      subtitle={`${rows.length} пар · обратные курсы синхронизируются автоматически · обновлено ${timeAgo(lastUpdated)}`}
      width="2xl"
    >
      <div className="p-5">
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 mb-3 inline-flex items-start gap-1.5">
          <Zap className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
          <span>
            Редактируете <strong>один курс</strong> на пару (master direction).
            Обратное направление автоматически = 1 / новый курс. Пустой
            инпут — курс остаётся прежним. Изменения атомарны + snapshot
            в историю.
          </span>
        </div>

        {/* Поиск — более тёмный контейнер slate-200, визуально отделён
            от обычных row-контейнеров (slate-50/60). */}
        <div className="mb-3 flex items-center gap-2 bg-slate-200/70 border border-slate-300 rounded-[10px] px-3 py-2">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по валюте (USD, TRY, USDT → TRY…)"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-slate-900 placeholder:text-slate-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="p-0.5 rounded hover:bg-slate-300 text-slate-600 hover:text-slate-900 transition-colors shrink-0"
              title="Очистить поиск"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-[10px] text-slate-500 tabular-nums shrink-0 pl-1 border-l border-slate-300">
            {visibleRows.length} / {rows.length}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {visibleRows.map(({ from, to }) => {
            const current = getRate(from, to);
            const key = `${from}_${to}`;
            const typed = inputs[key] || "";
            const typedNum = Number(String(typed).trim().replace(",", "."));
            const isChanged =
              typed !== "" &&
              Number.isFinite(typedNum) &&
              typedNum > 0 &&
              Number.isFinite(current) &&
              Math.abs(typedNum - current) > 1e-9;
            const info = pairInfo.get(key);
            const updatedLabel = formatUpdatedAt(info?.updatedAt);
            // Computed reverse — показываем что станет в обратной паре
            // после применения. Если юзер ничего не ввёл — показываем
            // текущий обратный rate из системы.
            const effectiveForward = isChanged ? typedNum : current;
            const reversePreview =
              Number.isFinite(effectiveForward) && effectiveForward > 0
                ? 1 / effectiveForward
                : null;
            return (
              <div
                key={key}
                className={`flex flex-col gap-0.5 px-3 py-2 rounded-[10px] border transition-colors ${
                  isChanged
                    ? "bg-emerald-50/60 border-emerald-300"
                    : "bg-slate-50/60 border-slate-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-[12px] font-bold text-slate-700 min-w-[100px] tracking-wide">
                    <span>{from}</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                    <span>{to}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 tabular-nums min-w-[70px]">
                    {formatRate(current)}
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={typed}
                    onChange={(e) => handleChange(from, to, e.target.value)}
                    placeholder={formatRate(current)}
                    className={`flex-1 min-w-0 bg-white border rounded-[8px] px-2.5 py-1.5 text-[13px] font-semibold tabular-nums outline-none transition-colors ${
                      isChanged
                        ? "border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                        : "border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                    }`}
                  />
                </div>
                {/* Reverse preview: {to} → {from} = 1 / forward.
                    Показываем всегда — менеджер видит обе стороны
                    одновременно, понимает что reverse computed. */}
                {reversePreview != null && (
                  <div className="text-[10px] tabular-nums pl-[100px] flex items-center gap-1.5">
                    <span className="text-slate-400">↩</span>
                    <span className="text-slate-500 font-medium">
                      {to}→{from}
                    </span>
                    <span
                      className={`font-bold ${
                        isChanged ? "text-emerald-700" : "text-slate-500"
                      }`}
                    >
                      {formatRate(reversePreview)}
                    </span>
                    <span className="text-[9px] text-slate-400 italic">auto</span>
                  </div>
                )}
                {/* Подпись "изм. DD.MM HH:MM" — когда курс был последний раз обновлён */}
                {updatedLabel && (
                  <div className="text-[9.5px] text-slate-400 tabular-nums pl-[100px]">
                    изм. {updatedLabel}
                  </div>
                )}
              </div>
            );
          })}
          {visibleRows.length === 0 && (
            <div className="col-span-full py-6 text-center text-[12px] text-slate-400 italic">
              Ничего не найдено по «{query}»
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
        <div className="text-[12px] text-slate-600">
          {changes.length > 0 ? (
            <span>
              <span className="font-bold text-emerald-700 tabular-nums">{changes.length}</span> изменений к сохранению
            </span>
          ) : (
            <span className="text-slate-400">Нет изменений</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60"
          >
            {t("cancel") || "Отмена"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={changes.length === 0 || busy}
            className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              changes.length > 0 && !busy
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {busy ? "Сохранение…" : `Сохранить ${changes.length || ""}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
