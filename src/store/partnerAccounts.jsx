// src/store/partnerAccounts.jsx
// Виртуальные счета партнёров (контрагентов) для OTC сделок.
// Аналог accounts но в отдельной таблице partner_accounts (миграция 0077).
//
// Никогда не учитываются в нашем balance — это отдельная сущность.
// Используется в:
//   - OTC форма: выбор партнёрского счёта для IN/OUT.
//   - Settings → Партнёры → таб «Счета»: CRUD.
//   - Obligations: связь долга с конкретным счётом партнёра.

import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  loadPartnerAccounts,
  loadPartnerAccountBalances,
} from "../lib/supabaseReaders.js";
import {
  rpcInsertPartnerAccount,
  rpcUpdatePartnerAccount,
  rpcDeletePartnerAccount,
} from "../lib/supabaseWrite.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const PartnerAccountsContext = createContext(null);

export function PartnerAccountsProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  // Map<partner_account_id, { total }>
  const [balances, setBalances] = useState(new Map());

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      Promise.all([
        loadPartnerAccounts().catch(() => null),
        loadPartnerAccountBalances().catch(() => null),
      ])
        .then(([accs, bals]) => {
          if (cancelled) return;
          if (Array.isArray(accs)) setAccounts(accs);
          if (bals instanceof Map) setBalances(bals);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[partnerAccounts] load failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Balance конкретного счёта (computed из view).
  const balanceOf = useCallback(
    (accountId) => {
      if (!accountId) return 0;
      return balances.get(accountId)?.total || 0;
    },
    [balances]
  );

  const addPartnerAccount = useCallback(async (data) => {
    const rec = await rpcInsertPartnerAccount(data);
    const normalized = {
      id: rec.id,
      partnerId: rec.partner_id,
      name: rec.name,
      currency: rec.currency_code,
      type: rec.type,
      networkId: rec.network_id || null,
      address: rec.address || "",
      note: rec.note || "",
      active: rec.active !== false,
      openingBalance: Number(rec.opening_balance) || 0,
      createdAt: rec.created_at,
      updatedAt: rec.updated_at,
    };
    setAccounts((prev) =>
      [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name))
    );
    return normalized;
  }, []);

  const updatePartnerAccount = useCallback(async (id, patch) => {
    await rpcUpdatePartnerAccount(id, patch);
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, ...patch, updatedAt: new Date().toISOString() }
          : a
      )
    );
  }, []);

  const removePartnerAccount = useCallback(async (id) => {
    await rpcDeletePartnerAccount(id);
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: false } : a))
    );
  }, []);

  // Полезные derived: счета конкретного партнёра.
  const accountsByPartner = useCallback(
    (partnerId) => accounts.filter((a) => a.partnerId === partnerId),
    [accounts]
  );

  // Активные счета по валюте — для селектора в OTC форме.
  const activeByCurrency = useCallback(
    (currency) =>
      accounts.filter((a) => a.active && a.currency === currency),
    [accounts]
  );

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.active),
    [accounts]
  );

  const value = useMemo(
    () => ({
      accounts,
      activeAccounts,
      balances,
      balanceOf,
      accountsByPartner,
      activeByCurrency,
      addPartnerAccount,
      updatePartnerAccount,
      removePartnerAccount,
    }),
    [
      accounts,
      activeAccounts,
      balances,
      balanceOf,
      accountsByPartner,
      activeByCurrency,
      addPartnerAccount,
      updatePartnerAccount,
      removePartnerAccount,
    ]
  );

  return (
    <PartnerAccountsContext.Provider value={value}>
      {children}
    </PartnerAccountsContext.Provider>
  );
}

export function usePartnerAccounts() {
  const ctx = useContext(PartnerAccountsContext);
  if (!ctx) throw new Error("usePartnerAccounts must be inside PartnerAccountsProvider");
  return ctx;
}
