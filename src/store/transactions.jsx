// src/store/transactions.js
// Общий store транзакций, чтобы Cashier / Capital / Referrals видели одни и те же данные.

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { SEED_TX, SEED_COUNTERPARTIES } from "./data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  loadDealsWithLegs,
  loadClients,
  loadUsers,
} from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const TxContext = createContext(null);

export function TransactionsProvider({ children }) {
  const [transactions, setTransactions] = useState(SEED_TX);
  const [counterparties, setCounterparties] = useState(SEED_COUNTERPARTIES);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = async () => {
      try {
        const users = await loadUsers().catch(() => []);
        const usersById = {};
        (users || []).forEach((u) => {
          usersById[u.id] = { id: u.id, full_name: u.name };
        });
        const [deals, clients] = await Promise.all([
          loadDealsWithLegs(usersById).catch(() => null),
          loadClients().catch(() => null),
        ]);
        if (cancelled) return;
        if (Array.isArray(deals)) setTransactions(deals);
        if (Array.isArray(clients) && clients.length > 0) setCounterparties(clients);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[transactions] load failed — keeping seed", err);
      }
    };
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const addTransaction = useCallback((tx) => {
    // status defaults to "completed" для полной обратной совместимости
    const full = { status: "completed", ...tx };
    setTransactions((prev) => [full, ...prev]);
  }, []);

  const updateTransaction = useCallback((id, patch) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  // Перевод pending → completed (только меняет статус в store;
  // запись movements остаётся задачей вызывающего кода, т.к. мы не должны
  // знать про accounts store из transactions).
  const completeTransaction = useCallback((id) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "completed" } : t))
    );
  }, []);

  // Обновить отдельный output внутри tx.outputs[]. Используется для crypto OUT
  // lifecycle: sendStatus pending_send → sent → checking → confirmed + sendTxHash.
  const updateOutput = useCallback((txId, outputIndex, patch) => {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== txId) return t;
        const outs = Array.isArray(t.outputs) ? [...t.outputs] : [];
        if (outputIndex < 0 || outputIndex >= outs.length) return t;
        outs[outputIndex] = { ...outs[outputIndex], ...patch };
        return { ...t, outputs: outs };
      })
    );
  }, []);

  // Soft delete. Физически запись не удаляем — только меняем status.
  // Вызывающий код должен отдельно откатить движения через
  // removeMovementsByRefId(id), чтобы балансы пересчитались.
  const deleteTransaction = useCallback((id, reason = "") => {
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status: "deleted", deletedAt: new Date().toISOString(), deletedReason: reason }
          : t
      )
    );
  }, []);

  // Принимает либо строку nickname (обратная совместимость),
  // либо объект { nickname, name, telegram, tag?, note? }.
  // Возвращает созданного/существующего контрагента.
  const addCounterparty = useCallback((input) => {
    if (!input) return null;
    const data = typeof input === "string"
      ? { nickname: input, name: "", telegram: "", tag: "", note: "" }
      : {
          nickname: input.nickname || input.name || "",
          name: input.name || "",
          telegram: input.telegram || "",
          tag: input.tag || "",
          note: input.note || "",
        };
    if (!data.nickname) return null;

    let result = null;
    setCounterparties((prev) => {
      const existing = prev.find(
        (c) => c.nickname.toLowerCase() === data.nickname.toLowerCase()
      );
      if (existing) {
        result = existing;
        return prev;
      }
      const created = { id: `cp_${Date.now()}`, ...data };
      result = created;
      return [...prev, created];
    });
    return result;
  }, []);

  // Обновление существующего counterparty (tag, note, telegram, name).
  const updateCounterparty = useCallback((id, patch) => {
    setCounterparties((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }, []);

  return (
    <TxContext.Provider
      value={{
        transactions,
        counterparties,
        addTransaction,
        updateTransaction,
        completeTransaction,
        deleteTransaction,
        updateOutput,
        addCounterparty,
        updateCounterparty,
      }}
    >
      {children}
    </TxContext.Provider>
  );
}

export function useTransactions() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTransactions must be inside TransactionsProvider");
  return ctx;
}
