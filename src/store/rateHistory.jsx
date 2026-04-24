// src/store/rateHistory.jsx
// Хранилище snapshot'ов rates. При каждом "Confirm rates" или явном запросе
// снимаем снимок активных default-пар (flat map "FROM_TO" → rate).
//
// Модель snapshot:
//   { id, timestamp, officeId, createdBy, rates: {FROM_TO: number}, pairsCount }
//
// Текущая rates-система не ломается: store остаётся источником правды для
// актуальных курсов, а история — append-only лог для аудита и привязки к tx.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";
import { loadRateSnapshots } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const RateHistoryContext = createContext(null);

export function RateHistoryProvider({ children }) {
  const [snapshots, setSnapshots] = useState([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadRateSnapshots()
        .then((rows) => {
          if (cancelled) return;
          if (Array.isArray(rows)) setSnapshots(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[rateHistory] load failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    // Direct realtime subscribe: любой INSERT в rate_snapshots (включая от
    // auto-snapshot trigger'а из 0017, который не вызывает bumpDataVersion) —
    // сразу reload. Требует rate_snapshots в publication (0020).
    const channel = supabase
      .channel("cp-rate-snapshots")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rate_snapshots" },
        () => reload()
      )
      .subscribe();
    return () => {
      cancelled = true;
      unsub();
      try { supabase.removeChannel(channel); } catch {}
    };
  }, []);

  // Добавляет snapshot. rates — объект FROM_TO → number (обычно derived из
  // useRates().rates). officeId опционально (если конкретный офис).
  const addSnapshot = useCallback(({ rates, officeId, createdBy, reason }) => {
    if (!rates || typeof rates !== "object") {
      return { ok: false, warning: "rates object required" };
    }
    const pairsCount = Object.keys(rates).length;
    const snap = {
      id: `rs_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      timestamp: new Date().toISOString(),
      officeId: officeId || null,
      createdBy: createdBy || null,
      reason: reason || "",
      rates: { ...rates },
      pairsCount,
    };
    setSnapshots((prev) => [snap, ...prev]);
    return { ok: true, snapshot: snap };
  }, []);

  const findById = useCallback(
    (id) => snapshots.find((s) => s.id === id) || null,
    [snapshots]
  );

  // Подобрать snapshot для timestamp'а tx (для PnL по историческим курсам).
  // Берём самый свежий snapshot с timestamp <= target. Если не найден — null.
  const findLatestBefore = useCallback(
    (targetIso) => {
      if (!targetIso) return null;
      // snapshots отсортированы newest first.
      for (const s of snapshots) {
        if (s.timestamp <= targetIso) return s;
      }
      return null;
    },
    [snapshots]
  );

  const value = useMemo(
    () => ({ snapshots, addSnapshot, findById, findLatestBefore }),
    [snapshots, addSnapshot, findById, findLatestBefore]
  );

  return (
    <RateHistoryContext.Provider value={value}>{children}</RateHistoryContext.Provider>
  );
}

export function useRateHistory() {
  const ctx = useContext(RateHistoryContext);
  if (!ctx) throw new Error("useRateHistory must be inside RateHistoryProvider");
  return ctx;
}
