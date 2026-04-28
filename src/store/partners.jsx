// src/store/partners.jsx
// Контрагенты (партнёры) для OTC сделок. CRUD через Supabase + локальный
// state. Аналог counterparties из transactions, но отдельная сущность —
// клиенты vs партнёры.

import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadPartners } from "../lib/supabaseReaders.js";
import {
  rpcInsertPartner,
  rpcUpdatePartner,
  rpcDeletePartner,
} from "../lib/supabaseWrite.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const PartnersContext = createContext(null);

export function PartnersProvider({ children }) {
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadPartners()
        .then((rows) => {
          if (cancelled) return;
          if (Array.isArray(rows)) setPartners(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[partners] load failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const addPartner = useCallback(async (data) => {
    const rec = await rpcInsertPartner(data);
    const normalized = {
      id: rec.id,
      name: rec.name,
      telegram: rec.telegram || "",
      phone: rec.phone || "",
      note: rec.note || "",
      active: rec.active !== false,
      createdAt: rec.created_at,
      updatedAt: rec.updated_at,
    };
    setPartners((prev) => [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name)));
    return normalized;
  }, []);

  const updatePartner = useCallback(async (id, patch) => {
    await rpcUpdatePartner(id, patch);
    setPartners((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p))
    );
  }, []);

  const removePartner = useCallback(async (id) => {
    await rpcDeletePartner(id);
    setPartners((prev) => prev.map((p) => (p.id === id ? { ...p, active: false } : p)));
  }, []);

  const activePartners = useMemo(() => partners.filter((p) => p.active), [partners]);

  const value = useMemo(
    () => ({ partners, activePartners, addPartner, updatePartner, removePartner }),
    [partners, activePartners, addPartner, updatePartner, removePartner]
  );

  return <PartnersContext.Provider value={value}>{children}</PartnersContext.Provider>;
}

export function usePartners() {
  const ctx = useContext(PartnersContext);
  if (!ctx) throw new Error("usePartners must be inside PartnersProvider");
  return ctx;
}
