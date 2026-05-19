// src/hooks/useClientLedgerBalances.js
//
// Хуки для чтения балансов клиентов из ledger.v_client_balances.
// В отличие от store/clientBalances.js (там через obligations, что не
// агрегат всего ledger'а), эти хуки читают из view со SUM(balance)
// по всем customer_liab+unearned account'ам клиента.
//
// • useClientLedgerBalances(clientId) — single client (для chip-карточки
//   выбранного клиента в форме сделки)
// • useClientsBalancesBatch(clientIds) — batch для dropdown autocomplete
//   (один SELECT с IN, чтобы не делать N запросов)
//
// Хуки используют чистый useState + useEffect (react-query в проекте нет).
// Деленный refetch — при изменении dataVersion (onDataBump), чтобы после
// сделки балансы обновлялись.

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";
import { onDataBump } from "../lib/dataVersion.jsx";

/**
 * Балансы одного клиента по валютам.
 * @param {string|null} clientId
 * @returns { data: Array<{currency, balance, sourceCount, lastMovement}>, loading, error }
 */
export function useClientLedgerBalances(clientId) {
  const [state, setState] = useState({ data: [], loading: false, error: null });

  useEffect(() => {
    if (!clientId || !isSupabaseConfigured) {
      setState({ data: [], loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { data, error } = await supabase
          .schema("ledger")
          .from("v_client_balances")
          .select("currency_code, balance, source_accounts_count, last_movement")
          .eq("client_id", clientId);
        if (cancelled) return;
        if (error) throw error;
        const rows = (data || [])
          .filter((r) => Math.abs(Number(r.balance) || 0) > 1e-9)
          .map((r) => ({
            currency: r.currency_code,
            balance: Number(r.balance),
            sourceCount: r.source_accounts_count,
            lastMovement: r.last_movement,
          }));
        setState({ data: rows, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ data: [], loading: false, error: err });
      }
    };
    load();
    const unsub = onDataBump(load);
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [clientId]);

  return state;
}

/**
 * Batch-загрузка балансов для списка клиентов одним SELECT'ом.
 * @param {string[] | null} clientIds
 * @returns { data: Record<clientId, Array<{currency, balance}>>, loading, error }
 */
export function useClientsBalancesBatch(clientIds) {
  // Stable key для useEffect — sorted joined ids
  const idsKey = useMemo(
    () => (clientIds ? [...new Set(clientIds.filter(Boolean))].sort().join(",") : ""),
    [clientIds]
  );
  const [state, setState] = useState({ data: {}, loading: false, error: null });

  useEffect(() => {
    if (!idsKey || !isSupabaseConfigured) {
      setState({ data: {}, loading: false, error: null });
      return undefined;
    }
    const ids = idsKey.split(",");
    let cancelled = false;
    const load = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { data, error } = await supabase
          .schema("ledger")
          .from("v_client_balances")
          .select("client_id, currency_code, balance")
          .in("client_id", ids);
        if (cancelled) return;
        if (error) throw error;
        const map = {};
        for (const row of data || []) {
          const bal = Number(row.balance);
          if (!Number.isFinite(bal) || Math.abs(bal) < 1e-9) continue;
          if (!map[row.client_id]) map[row.client_id] = [];
          map[row.client_id].push({
            currency: row.currency_code,
            balance: bal,
          });
        }
        // Sort balances внутри каждого клиента по |amount| desc
        Object.values(map).forEach((arr) =>
          arr.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        );
        setState({ data: map, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ data: {}, loading: false, error: err });
      }
    };
    load();
    const unsub = onDataBump(load);
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [idsKey]);

  return state;
}
