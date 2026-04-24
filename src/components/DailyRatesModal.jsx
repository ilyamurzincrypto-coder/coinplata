// src/components/DailyRatesModal.jsx
// Компактная модалка быстрого ежедневного обновления курсов.
// Показывает все default pairs в две колонки (a→b и b→a на одной строке).
// Инпут пустой = не трогать; заполненный и отличающийся от текущего — в diff.
// На submit батчом через rpcImportRates (atomic + snapshot для истории).

import React, { useState, useEffect, useMemo } from "react";
import { Zap, ArrowRight } from "lucide-react";
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

export default function DailyRatesModal({ open, onClose }) {
  const { t } = useTranslation();
  const { allTradePairs, getRate, lastUpdated } = useRates();
  const { addEntry: logAudit } = useAudit();
  const [inputs, setInputs] = useState({}); // { "FROM_TO": "value" }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setInputs({});
  }, [open]);

  // Разворачиваем уникальные (a,b) в два направления для редактирования.
  const rows = useMemo(() => {
    const out = [];
    (allTradePairs || []).forEach(([a, b]) => {
      out.push({ from: a, to: b });
      out.push({ from: b, to: a });
    });
    return out;
  }, [allTradePairs]);

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
      subtitle={`${rows.length} направлений · обновлено ${timeAgo(lastUpdated)}`}
      width="2xl"
    >
      <div className="p-5">
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 mb-3 inline-flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-amber-500" />
          Пустой инпут — курс остаётся текущий. Изменения сохраняются
          атомарно + делается snapshot в историю.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {rows.map(({ from, to }) => {
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
            return (
              <div
                key={key}
                className={`flex items-center gap-2 px-3 py-2 rounded-[10px] border transition-colors ${
                  isChanged
                    ? "bg-emerald-50/60 border-emerald-300"
                    : "bg-slate-50/60 border-slate-200"
                }`}
              >
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
            );
          })}
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
