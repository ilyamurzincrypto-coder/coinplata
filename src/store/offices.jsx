// src/store/offices.jsx
// Провайдер офисов. Seed — из data.js OFFICES, далее state с CRUD операциями.
//
// BACKWARD COMPAT: существующий export const OFFICES в data.js не изменён,
// компоненты которые импортируют OFFICES напрямую продолжают видеть seed-snapshot.
// Постепенная миграция на useOffices() делается только там где нужен динамический список.

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { OFFICES as SEED_OFFICES, DEFAULT_OFFICE_OPS } from "./data.js";

const OfficesContext = createContext(null);

export function OfficesProvider({ children }) {
  const [offices, setOffices] = useState(SEED_OFFICES);

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

  const value = useMemo(
    () => ({
      offices,
      activeOffices,
      addOffice,
      updateOffice,
      closeOffice,
      reopenOffice,
      findOffice,
    }),
    [offices, activeOffices, addOffice, updateOffice, closeOffice, reopenOffice, findOffice]
  );

  return <OfficesContext.Provider value={value}>{children}</OfficesContext.Provider>;
}

export function useOffices() {
  const ctx = useContext(OfficesContext);
  if (!ctx) throw new Error("useOffices must be inside OfficesProvider");
  return ctx;
}
