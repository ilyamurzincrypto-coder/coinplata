// src/store/offices.jsx
// Провайдер офисов. Seed — из data.js OFFICES, далее state с CRUD операциями.
//
// BACKWARD COMPAT: существующий export const OFFICES в data.js не изменён,
// компоненты которые импортируют OFFICES напрямую продолжают видеть seed-snapshot.
// Постепенная миграция на useOffices() делается только там где нужен динамический список.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { OFFICES as SEED_OFFICES, DEFAULT_OFFICE_OPS } from "./data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadOffices } from "../lib/supabaseReaders.js";
import { swapOfficesSortOrder, withToast } from "../lib/supabaseWrite.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const OfficesContext = createContext(null);

export function OfficesProvider({ children }) {
  const [offices, setOffices] = useState(() =>
    isSupabaseConfigured ? [] : SEED_OFFICES
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadOffices()
        .then((rows) => {
          if (cancelled) return;
          if (rows && rows.length > 0) setOffices(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[offices] load failed — keeping seed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Список активных офисов — для UI фильтров
  const activeOffices = useMemo(
    () => offices.filter((o) => o.active !== false && o.status !== "closed"),
    [offices]
  );

  const addOffice = useCallback(
    ({ name, city, timezone, workingDays, workingHours, minFeeUsd, feePercent }) => {
      const id = `office_${Date.now()}`;
      const full = {
        id,
        name: String(name || "").trim(),
        city: String(city || "").trim(),
        status: "active",
        active: true,
        timezone: timezone || DEFAULT_OFFICE_OPS.timezone,
        workingDays: Array.isArray(workingDays) ? workingDays : DEFAULT_OFFICE_OPS.workingDays,
        workingHours: workingHours || DEFAULT_OFFICE_OPS.workingHours,
        minFeeUsd: Number.isFinite(Number(minFeeUsd))
          ? Number(minFeeUsd)
          : DEFAULT_OFFICE_OPS.minFeeUsd,
        feePercent: Number.isFinite(Number(feePercent))
          ? Number(feePercent)
          : DEFAULT_OFFICE_OPS.feePercent,
      };
      if (!full.name) return null;
      setOffices((prev) => [...prev, full]);
      return full;
    },
    []
  );

  const updateOffice = useCallback((id, patch) => {
    setOffices((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  // Soft delete — переводим в closed + active:false, данные сохраняются
  const closeOffice = useCallback((id) => {
    setOffices((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: "closed", active: false } : o))
    );
  }, []);

  const reopenOffice = useCallback((id) => {
    setOffices((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: "active", active: true } : o))
    );
  }, []);

  const findOffice = useCallback(
    (id) => offices.find((o) => o.id === id),
    [offices]
  );

  // Перемещение в списке: меняем местами sort_order с соседом.
  // dir: -1 = вверх, +1 = вниз. Соседа ищем по уже отсортированному массиву offices.
  const moveOffice = useCallback(
    async (id, dir) => {
      const idx = offices.findIndex((o) => o.id === id);
      if (idx === -1) return;
      const neighborIdx = idx + (dir < 0 ? -1 : 1);
      if (neighborIdx < 0 || neighborIdx >= offices.length) return;
      const cur = offices[idx];
      const neighbor = offices[neighborIdx];
      const curOrder = Number.isFinite(cur.sortOrder) ? cur.sortOrder : idx * 10;
      const neighborOrder = Number.isFinite(neighbor.sortOrder)
        ? neighbor.sortOrder
        : neighborIdx * 10;
      if (isSupabaseConfigured) {
        // Оптимистичный swap — поправит reload через bumpDataVersion.
        setOffices((prev) => {
          const arr = prev.slice();
          arr[idx] = { ...cur, sortOrder: neighborOrder };
          arr[neighborIdx] = { ...neighbor, sortOrder: curOrder };
          arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          return arr;
        });
        await withToast(
          () => swapOfficesSortOrder(cur.id, curOrder, neighbor.id, neighborOrder),
          { errorPrefix: "Reorder failed" }
        );
      } else {
        setOffices((prev) => {
          const arr = prev.slice();
          arr[idx] = { ...cur, sortOrder: neighborOrder };
          arr[neighborIdx] = { ...neighbor, sortOrder: curOrder };
          arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          return arr;
        });
      }
    },
    [offices]
  );

  const value = useMemo(
    () => ({
      offices,
      activeOffices,
      addOffice,
      updateOffice,
      closeOffice,
      reopenOffice,
      findOffice,
      moveOffice,
    }),
    [offices, activeOffices, addOffice, updateOffice, closeOffice, reopenOffice, findOffice, moveOffice]
  );

  return <OfficesContext.Provider value={value}>{children}</OfficesContext.Provider>;
}

export function useOffices() {
  const ctx = useContext(OfficesContext);
  if (!ctx) throw new Error("useOffices must be inside OfficesProvider");
  return ctx;
}
