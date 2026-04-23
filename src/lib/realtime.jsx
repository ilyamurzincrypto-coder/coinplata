// src/lib/realtime.jsx
// Минимальный Supabase Realtime: подписка на 3 таблицы (balances + deals).
// На любое изменение — debounced bumpDataVersion() → stores реhydrate.
//
// Почему debounce:
//   — create_transfer пишет 2 movements одновременно → 2 event'а
//   — create_deal пишет deal + N legs + N movements → ~(2+2N) event'ов
//   Без throttle каждый стор бы реhydrate'ил десятки раз подряд.
//   300ms окно — достаточно для батчинга, UI всё равно воспринимается живым.
//
// Отписка: RealtimeProvider сам cleanup'ит channel при unmount + при HMR.

import { useEffect } from "react";
import { supabase, isSupabaseConfigured } from "./supabase.js";
import { bumpDataVersion } from "./dataVersion.jsx";

const DEBOUNCE_MS = 300;

// Таблицы на realtime:
//   deals, deal_legs — состояние сделок, статусы per-leg
//   account_movements — источник balances (view v_account_balances на этой таблице)
const REALTIME_TABLES = ["deals", "deal_legs", "account_movements"];

export function RealtimeProvider({ children }) {
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    let bumpTimer = null;
    const scheduleBump = () => {
      if (bumpTimer) clearTimeout(bumpTimer);
      bumpTimer = setTimeout(() => {
        bumpTimer = null;
        bumpDataVersion();
      }, DEBOUNCE_MS);
    };

    // Один channel с тремя постграсовскими подписками. Фильтруем только по
    // schema/table — без row-level фильтров (RLS на backend ограничит видимость
    // сам; всё что пришло — пользователь и так имеет право видеть).
    let channel = supabase.channel("cp-realtime-main");
    REALTIME_TABLES.forEach((table) => {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleBump
      );
    });

    const sub = channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // eslint-disable-next-line no-console
        console.info("[realtime] subscribed to", REALTIME_TABLES.join(", "));
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // eslint-disable-next-line no-console
        console.warn("[realtime] channel status:", status);
      }
    });

    return () => {
      if (bumpTimer) clearTimeout(bumpTimer);
      try {
        supabase.removeChannel(sub);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[realtime] removeChannel failed", err);
      }
    };
  }, []);

  return children;
}
