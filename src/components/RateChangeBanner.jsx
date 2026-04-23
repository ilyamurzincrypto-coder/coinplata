// src/components/RateChangeBanner.jsx
// Провайдер + banner который уведомляет всех залогиненных пользователей
// когда кто-то обновил курсы. Подписка через supabase realtime на UPDATE
// событие pairs. Изменения свои игнорируются (by updated_by == current user).
//
// UI: fixed top banner с списком изменений — "USDT→TRY 38.90 → 39.00 by Ivan".
// Acknowledge-кнопка очищает очередь. До acknowledge копится список всех
// изменений пришедших за сессию.

import React, { useState, useEffect, useMemo } from "react";
import { TrendingUp, Check, ArrowRight, Bell } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";
import { useRates } from "../store/rates.jsx";
import { useAuth } from "../store/auth.jsx";

function formatRate(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (n >= 10) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function RateChangeBanner() {
  const { pairs } = useRates();
  const { currentUser, users } = useAuth();
  const [changes, setChanges] = useState([]);

  // Map pair.dbId → {baseRate, spreadPercent, rate} текущие значения.
  // Используется как snapshot для определения OLD значений при UPDATE.
  const pairSnapshot = useMemo(() => {
    const m = new Map();
    (pairs || []).forEach((p) => {
      if (p.dbId) {
        m.set(p.dbId, {
          fromCurrency: snapshotCurrency(p, "from"),
          toCurrency: snapshotCurrency(p, "to"),
          baseRate: p.baseRate,
          spreadPercent: p.spreadPercent,
          rate: p.rate,
        });
      }
    });
    return m;
  }, [pairs]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const channel = supabase
      .channel("cp-pairs-rate-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pairs" },
        (payload) => {
          const newRow = payload.new || {};
          // Не уведомляем инициатора — он сам только что поменял.
          if (newRow.updated_by && newRow.updated_by === currentUser?.id) return;

          const old = pairSnapshot.get(newRow.id);
          const newRate = Number(newRow.rate);
          const oldRate = old?.rate;

          // Ничего материально не изменилось?
          if (old && Math.abs((oldRate || 0) - newRate) < 1e-8) return;

          const fromCur = newRow.from_currency || old?.fromCurrency;
          const toCur = newRow.to_currency || old?.toCurrency;

          const byUser = users.find((u) => u.id === newRow.updated_by);
          const byName = byUser?.name || "Someone";

          setChanges((prev) => {
            // Удаляем предыдущее изменение для этой же пары — показываем только
            // последнее актуальное.
            const filtered = prev.filter(
              (c) => !(c.from === fromCur && c.to === toCur)
            );
            return [
              ...filtered,
              {
                id: `${newRow.id}:${Date.now()}`,
                from: fromCur,
                to: toCur,
                oldRate,
                newRate,
                byName,
                at: Date.now(),
              },
            ];
          });
        }
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [pairSnapshot, currentUser?.id, users]);

  if (changes.length === 0) return null;

  return (
    <div className="sticky top-0 z-30 bg-amber-50 border-b border-amber-200 shadow-[0_2px_8px_-4px_rgba(245,158,11,0.25)] animate-[slideDown_180ms_ease-out]">
      <div className="max-w-[1400px] mx-auto px-6 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-white shrink-0 relative">
          <TrendingUp className="w-3.5 h-3.5" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-amber-900 uppercase tracking-[0.1em]">
            Rates changed
            {changes.length > 1 && (
              <span className="ml-1.5 text-[10px] text-amber-700 normal-case tracking-normal">
                · {changes.length} updates
              </span>
            )}
          </div>
          <div className="flex items-center gap-x-4 gap-y-0.5 flex-wrap mt-0.5">
            {changes.slice(0, 6).map((c) => (
              <span key={c.id} className="text-[12px] text-slate-700 inline-flex items-center gap-1">
                <span className="font-semibold">{c.from}</span>
                <ArrowRight className="w-2.5 h-2.5 text-slate-400" />
                <span className="font-semibold">{c.to}</span>
                <span className="text-slate-400">:</span>
                {c.oldRate != null && (
                  <>
                    <span className="line-through text-slate-400 tabular-nums">
                      {formatRate(c.oldRate)}
                    </span>
                    <span className="text-slate-400">→</span>
                  </>
                )}
                <span className="font-bold text-slate-900 tabular-nums">
                  {formatRate(c.newRate)}
                </span>
                <span className="text-[10px] text-slate-500">by {c.byName}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {formatTime(c.at)}
                </span>
              </span>
            ))}
            {changes.length > 6 && (
              <span className="text-[11px] text-slate-500 italic">
                +{changes.length - 6} more
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setChanges([])}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-slate-900 text-white text-[12px] font-semibold hover:bg-slate-800 transition-colors shrink-0"
        >
          <Check className="w-3 h-3" />
          Acknowledge
        </button>
      </div>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// Резолв currencyCode из pair.fromChannelId/toChannelId через rates store.
// Аргумент side: "from" или "to". Возвращает 3-буквенный код валюты или null.
function snapshotCurrency(pair, side) {
  const chId = side === "from" ? pair.fromChannelId : pair.toChannelId;
  if (!chId) return null;
  // Ленивый lookup — без useRates внутри useMemo (он снаружи).
  // Поскольку pair не имеет прямой ссылки на currencyCode, возвращаем
  // что-то fallback. В реальности newRow уже содержит from_currency/to_currency.
  return null;
}
