// src/store/openObligations.js
// Hook для подписки на operations.v_open_deals + Realtime updates.
//
// View shape (см. supabase/migrations/operations_6_view_open_deals_and_cron.sql):
//   id, status, assigned_to, notes, due_date, open_legs jsonb,
//   created_at, updated_at, ledger_tx_id, deal_at, office_id,
//   counterparty_name, counterparty_id, open_count, pending_out_total

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";

export function useOpenObligations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);

  const fetchAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: e } = await supabase
        .from("v_open_deals")
        .select("*");
      if (e) throw e;
      setItems(data || []);
      setError(null);
    } catch (err) {
      setError(err);
      // eslint-disable-next-line no-console
      console.warn("[openObligations] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + Realtime subscription
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    fetchAll();

    const channel = supabase
      .channel("open-obligations")
      .on(
        "postgres_changes",
        { event: "*", schema: "operations", table: "deal_workflow" },
        () => fetchAll()
      )
      .subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [fetchAll]);

  return { items, loading, error, refetch: fetchAll };
}

// Pure helper: format time-ago label
export function formatAge(createdAt, t) {
  if (!createdAt) return "";
  const now = Date.now();
  const then = new Date(createdAt).getTime();
  const diffMs = now - then;
  if (diffMs < 60_000) return t("open_obligations_age_just_now");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t("open_obligations_age_minutes").replace("{{n}}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("open_obligations_age_hours").replace("{{n}}", String(hours));
  const days = Math.floor(hours / 24);
  return t("open_obligations_age_days").replace("{{n}}", String(days));
}
