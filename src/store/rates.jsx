// src/store/rates.jsx
// Модель: Currency → Channel → Pair.
//
//   Channel: { id, currencyCode, kind, network?, gasFee?, isDefaultForCurrency? }
//     kind: "cash" | "bank" | "sepa" | "swift" | "network"
//     crypto ⇒ kind="network", fiat ⇒ cash/bank/sepa/swift
//
//   Pair: { id, fromChannelId, toChannelId, rate, isDefault, priority, ... }
//     fromChannelId / toChannelId ссылаются на Channel.
//     isDefault на уровне пары (from currency → to currency):
//       только одна пара помечена isDefault=true для данной пары валют.
//
// Совместимость:
//   — getRate(from, to) → находит default pair для (from → to) по валютам channels,
//     возвращает её rate. Поведение идентично старому.
//   — setRate(from, to, value) → меняет rate у default pair если он существует.
//     Если default pair нет — логирует warning и ничего не делает.
//     Создание пар — только через addPair() с явным выбором channels.
//   — deleteRate(from, to) → удаляет default pair.
//   — ratesFromBase(base) → все direction'ы от base через default pairs.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { SEED_CHANNELS, currencyByCode } from "./data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadPairs, loadOfficeRateOverrides } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";
import { rpcCreatePair } from "../lib/supabaseWrite.js";
import { emitToast } from "../lib/toast.jsx";

export const rateKey = (from, to) => `${from}_${to}`;

// Seed pairs — курсы из Excel (реальные). Значения подставлены как есть,
// без 1/x и auto-conversion. Каждая пара — одно направление.
const SEED_PAIRS = [
  // ------- CRYPTO (через USDT TRC20) -------
  { id: "p_eur_usdt_default",  fromChannelId: "ch_eur_bank",   toChannelId: "ch_usdt_trc20", rate: 1.1532,   isDefault: true, priority: 10 },
  { id: "p_usdt_eur_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_eur_bank",   rate: 1.1827,   isDefault: true, priority: 10 },

  { id: "p_usdt_try_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_try_cash",   rate: 44.0015,  isDefault: true, priority: 10 },
  { id: "p_try_usdt_default",  fromChannelId: "ch_try_cash",   toChannelId: "ch_usdt_trc20", rate: 45.1025,  isDefault: true, priority: 10 },

  { id: "p_gbp_usdt_default",  fromChannelId: "ch_gbp_bank",   toChannelId: "ch_usdt_trc20", rate: 1.3315,   isDefault: true, priority: 10 },
  { id: "p_usdt_gbp_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_gbp_bank",   rate: 1.3154,   isDefault: true, priority: 10 },

  { id: "p_chf_usdt_default",  fromChannelId: "ch_chf_bank",   toChannelId: "ch_usdt_trc20", rate: 1.2635,   isDefault: true, priority: 10 },
  { id: "p_usdt_chf_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_chf_bank",   rate: 1.2832,   isDefault: true, priority: 10 },

  { id: "p_rub_usdt_default",  fromChannelId: "ch_rub_bank",   toChannelId: "ch_usdt_trc20", rate: 78.6725,  isDefault: true, priority: 10 },
  { id: "p_usdt_rub_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_rub_bank",   rate: 77.1752,  isDefault: true, priority: 10 },

  // ------- CASH (через TRY) -------
  { id: "p_usd_try_default",   fromChannelId: "ch_usd_cash",   toChannelId: "ch_try_cash",   rate: 44.9247,  isDefault: true, priority: 10 },
  { id: "p_try_usd_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_usd_cash",   rate: 44.9254,  isDefault: true, priority: 10 },

  { id: "p_eur_try_default",   fromChannelId: "ch_eur_bank",   toChannelId: "ch_try_cash",   rate: 52.6279,  isDefault: true, priority: 10 },
  { id: "p_try_eur_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_eur_bank",   rate: 52.6345,  isDefault: true, priority: 10 },

  { id: "p_gbp_try_default",   fromChannelId: "ch_gbp_bank",   toChannelId: "ch_try_cash",   rate: 60.3256,  isDefault: true, priority: 10 },
  { id: "p_try_gbp_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_gbp_bank",   rate: 60.6339,  isDefault: true, priority: 10 },

  { id: "p_chf_try_default",   fromChannelId: "ch_chf_bank",   toChannelId: "ch_try_cash",   rate: 56.5923,  isDefault: true, priority: 10 },
  { id: "p_try_chf_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_chf_bank",   rate: 57.0786,  isDefault: true, priority: 10 },

  { id: "p_rub_try_default",   fromChannelId: "ch_rub_bank",   toChannelId: "ch_try_cash",   rate: 1.717852, isDefault: true, priority: 10 },
  { id: "p_try_rub_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_rub_bank",   rate: 1.751181, isDefault: true, priority: 10 },
];

const RatesContext = createContext(null);

// Резолв channelId → currencyCode через внешний канал-массив
function resolveCurrencyOfChannel(channels, channelId) {
  return channels.find((c) => c.id === channelId)?.currencyCode;
}

// Найти default pair для (fromCur → toCur)
function findDefaultPair(pairs, channels, fromCur, toCur) {
  return pairs.find((p) => {
    if (!p.isDefault) return false;
    const fCur = resolveCurrencyOfChannel(channels, p.fromChannelId);
    const tCur = resolveCurrencyOfChannel(channels, p.toChannelId);
    return fCur === fromCur && tCur === toCur;
  });
}

// Derived rates lookup {"FROM_TO": rate} из default pairs — для обратной совместимости
function buildRatesLookup(pairs, channels) {
  const out = {};
  pairs.forEach((p) => {
    if (!p.isDefault) return;
    const fCur = resolveCurrencyOfChannel(channels, p.fromChannelId);
    const tCur = resolveCurrencyOfChannel(channels, p.toChannelId);
    if (fCur && tCur) {
      out[rateKey(fCur, tCur)] = p.rate;
    }
  });
  return out;
}

export function RatesProvider({ children }) {
  const [channels, setChannels] = useState(SEED_CHANNELS);
  const [pairs, setPairs] = useState(SEED_PAIRS);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  // Per-office overrides (0021). Map<officeId, Map<"FROM_TO", {rate, baseRate, spreadPercent}>>
  const [officeOverrides, setOfficeOverrides] = useState(new Map());

  // DB overlay: для каждой DB-пары (from_currency → to_currency, rate) находим
  // default frontend-пару по валютам (через channels) и обновляем её rate.
  // Frontend channel-based модель не меняется — Stage 4 либо переделает БД,
  // либо фронт; сейчас задача read-only → синхронизация курсов достаточна.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadPairs()
        .then((dbPairs) => {
          if (cancelled) return;
          if (!Array.isArray(dbPairs) || dbPairs.length === 0) return;
          setPairs((prev) => {
            const next = prev.map((p) => ({ ...p }));
            const channelCurrency = (chId) =>
              SEED_CHANNELS.find((c) => c.id === chId)?.currencyCode;
            dbPairs.forEach((db) => {
              const match = next.find(
                (p) =>
                  p.isDefault &&
                  channelCurrency(p.fromChannelId) === db.fromCurrency &&
                  channelCurrency(p.toChannelId) === db.toCurrency
              );
              if (match) {
                match.rate = db.rate;
                match.baseRate = db.baseRate;
                match.spreadPercent = db.spreadPercent;
                match.dbId = db.id;
                match.updatedAt = db.updatedAt;
              }
            });
            return next;
          });
          setLastUpdated(new Date());
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[rates] load failed — keeping seed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Per-office overrides loader (0021)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadOfficeRateOverrides()
        .then((m) => {
          if (!cancelled && m instanceof Map) setOfficeOverrides(m);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[office rate overrides] load failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Confirmation state
  const [confirmationStatus, setConfirmationStatus] = useState("draft");
  const [confirmedAt, setConfirmedAt] = useState(null);
  const [confirmedBy, setConfirmedBy] = useState(null);
  const [modifiedAfterConfirmation, setModifiedAfterConfirmation] = useState(false);

  // Derived rates lookup {"FROM_TO": rate}
  const rates = useMemo(() => buildRatesLookup(pairs, channels), [pairs, channels]);

  // ---------- Channel helpers ----------
  const getChannel = useCallback(
    (id) => channels.find((c) => c.id === id),
    [channels]
  );

  const channelsForCurrency = useCallback(
    (currencyCode) => channels.filter((c) => c.currencyCode === currencyCode),
    [channels]
  );

  const defaultChannelOf = useCallback(
    (currencyCode) => {
      const forCur = channels.filter((c) => c.currencyCode === currencyCode);
      return forCur.find((c) => c.isDefaultForCurrency) || forCur[0];
    },
    [channels]
  );

  // ---------- getRate / setRate / deleteRate (обратная совместимость) ----------

  // getRate: если officeId указан и есть office override для этой пары — use it.
  // Иначе fallback на global default rate.
  const getRate = useCallback(
    (from, to, officeId) => {
      if (from === to) return 1;
      if (officeId && officeOverrides instanceof Map) {
        const officeMap = officeOverrides.get(officeId);
        if (officeMap) {
          const ovr = officeMap.get(rateKey(from, to));
          if (ovr && Number.isFinite(ovr.rate)) return ovr.rate;
        }
      }
      return rates[rateKey(from, to)];
    },
    [rates, officeOverrides]
  );

  // Получить override (или null если нет) — для UI индикации
  const getOfficeOverride = useCallback(
    (officeId, from, to) => {
      if (!officeId || !(officeOverrides instanceof Map)) return null;
      const officeMap = officeOverrides.get(officeId);
      if (!officeMap) return null;
      return officeMap.get(rateKey(from, to)) || null;
    },
    [officeOverrides]
  );

  // setRate — меняет rate у default pair (from → to).
  // Если default pair нет — возвращает {ok: false, warning}.
  // Пары автоматически НЕ создаём.
  const markModifiedIfConfirmed = useCallback(() => {
    if (confirmationStatus === "confirmed") {
      setModifiedAfterConfirmation(true);
    }
  }, [confirmationStatus]);

  const setRate = useCallback(
    (from, to, value) => {
      const numValue = parseFloat(value) || 0;
      const existing = findDefaultPair(pairs, channels, from, to);
      if (!existing) {
        // eslint-disable-next-line no-console
        console.warn(
          `[rates] setRate(${from}, ${to}): default pair not found. Use addPair() to create.`
        );
        return { ok: false, warning: `No default pair for ${from} → ${to}` };
      }
      setPairs((prev) =>
        prev.map((p) => (p.id === existing.id ? { ...p, rate: numValue } : p))
      );
      setLastUpdated(new Date());
      markModifiedIfConfirmed();
      return { ok: true };
    },
    [pairs, channels, markModifiedIfConfirmed]
  );

  // deleteRate — удаляет default pair для (from, to).
  // Если была default — попытаемся назначить новую default из non-default pair'ов
  // той же пары валют (по priority).
  const deleteRate = useCallback(
    (from, to) => {
      const existing = findDefaultPair(pairs, channels, from, to);
      if (!existing) {
        return { ok: false, warning: `No default pair for ${from} → ${to}` };
      }
      setPairs((prev) => {
        let next = prev.filter((p) => p.id !== existing.id);
        // Переназначаем default если остались non-default пары с теми же валютами
        const sameCurrencyPairs = next.filter((p) => {
          const fCur = resolveCurrencyOfChannel(channels, p.fromChannelId);
          const tCur = resolveCurrencyOfChannel(channels, p.toChannelId);
          return fCur === from && tCur === to;
        });
        if (sameCurrencyPairs.length > 0) {
          // Выбираем по наивысшему priority (меньшее число = выше приоритет), иначе первую
          const newDefault = [...sameCurrencyPairs].sort(
            (a, b) => (a.priority || 999) - (b.priority || 999)
          )[0];
          next = next.map((p) =>
            p.id === newDefault.id ? { ...p, isDefault: true } : p
          );
        }
        return next;
      });
      setLastUpdated(new Date());
      markModifiedIfConfirmed();
      return { ok: true };
    },
    [pairs, channels, markModifiedIfConfirmed]
  );

  // Все уникальные валютные пары из default pairs — для динамического
  // отображения в RatesBar / RatesSidebar. Дедуп: (A,B) и (B,A) считаем
  // одной парой (показываем одной карточкой с двумя направлениями).
  // Ordering: сначала USDT-пары, потом USD/EUR/GBP/CHF/RUB (по приоритету),
  // TRY всегда quote. Остальные коды — по алфавиту.
  const allTradePairs = useMemo(() => {
    const PRIO = { USDT: 0, USD: 1, EUR: 2, GBP: 3, CHF: 4, RUB: 5, TRY: 999 };
    const getPrio = (c) => (PRIO[c] !== undefined ? PRIO[c] : 500);
    const seen = new Set();
    const out = [];
    pairs.forEach((p) => {
      if (!p.isDefault) return;
      const fCur = resolveCurrencyOfChannel(channels, p.fromChannelId);
      const tCur = resolveCurrencyOfChannel(channels, p.toChannelId);
      if (!fCur || !tCur || fCur === tCur) return;
      const [a, b] =
        getPrio(fCur) <= getPrio(tCur) ? [fCur, tCur] : [tCur, fCur];
      const key = `${a}_${b}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push([a, b]);
    });
    return out.sort(([a1, b1], [a2, b2]) => {
      const d = getPrio(a1) - getPrio(a2);
      if (d !== 0) return d;
      const d2 = getPrio(b1) - getPrio(b2);
      if (d2 !== 0) return d2;
      return a1.localeCompare(a2) || b1.localeCompare(b2);
    });
  }, [pairs, channels]);

  // Список {to, rate} всех default-пар от base currency.
  // Если передан officeId — применяем per-office override для каждой пары.
  // Без officeId — возвращает GLOBAL rates (back-compat).
  const ratesFromBase = useCallback(
    (base, officeId) => {
      const officeMap =
        officeId && officeOverrides instanceof Map
          ? officeOverrides.get(officeId) || null
          : null;
      const out = [];
      pairs.forEach((p) => {
        if (!p.isDefault) return;
        const fCur = resolveCurrencyOfChannel(channels, p.fromChannelId);
        if (fCur !== base) return;
        const tCur = resolveCurrencyOfChannel(channels, p.toChannelId);
        if (!tCur) return;
        let rate = p.rate;
        if (officeMap) {
          const ovr = officeMap.get(rateKey(base, tCur));
          if (ovr && Number.isFinite(ovr.rate)) rate = ovr.rate;
        }
        out.push({ to: tCur, rate });
      });
      return out;
    },
    [pairs, channels, officeOverrides]
  );

  // ---------- Pair API (новый) ----------

  // Добавить пару. Async в DB-режиме: awaits rpcCreatePair и возвращает
  // { ok, warning? } только после успешного persist. Callers (AddPairPanel)
  // обязаны await. Раньше был fire-and-forget — пары тихо пропадали если
  // RPC падала (0031 не применён / RLS / invalid currency / etc.).
  const addPair = useCallback(
    async ({ fromChannelId, toChannelId, rate, priority = 50 }) => {
      const fromCh = channels.find((c) => c.id === fromChannelId);
      const toCh = channels.find((c) => c.id === toChannelId);
      if (!fromCh || !toCh) {
        return { ok: false, warning: "Invalid channel id" };
      }
      if (fromCh.currencyCode === toCh.currencyCode) {
        return { ok: false, warning: "From and To currencies must differ" };
      }
      const id = `p_${fromChannelId}_${toChannelId}_${Date.now()}`;
      const baseRate = parseFloat(rate) || 0;
      const existingDefault = findDefaultPair(
        pairs,
        channels,
        fromCh.currencyCode,
        toCh.currencyCode
      );

      // DB mode: await RPC create_pair, только на успех пишем в local state.
      if (isSupabaseConfigured) {
        try {
          await rpcCreatePair({
            fromCurrency: fromCh.currencyCode,
            toCurrency: toCh.currencyCode,
            baseRate,
            spreadPercent: 0,
            priority,
          });
          // bump внутри rpcCreatePair — loadPairs перезагрузит DB rows,
          // наша пара появится с реальным uuid. Local setPairs не нужен —
          // dup был бы удалён bump'ом всё равно.
          setLastUpdated(new Date());
          markModifiedIfConfirmed();
          emitToast("success", `Pair ${fromCh.currencyCode}→${toCh.currencyCode} saved`);
          return { ok: true };
        } catch (err) {
          const msg = err?.message || String(err);
          // eslint-disable-next-line no-console
          console.error("[addPair] DB persist failed", msg);
          emitToast("error", `Pair save failed: ${msg}`);
          return { ok: false, warning: msg };
        }
      }

      // Demo mode — только local state, без DB.
      setPairs((prev) => [
        ...prev,
        {
          id,
          fromChannelId,
          toChannelId,
          rate: baseRate,
          isDefault: !existingDefault,
          priority,
        },
      ]);
      setLastUpdated(new Date());
      markModifiedIfConfirmed();
      return { ok: true, id };
    },
    [channels, pairs, markModifiedIfConfirmed]
  );

  // Обновить произвольные поля пары по id
  const updatePair = useCallback(
    (id, patch) => {
      setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      setLastUpdated(new Date());
      markModifiedIfConfirmed();
    },
    [markModifiedIfConfirmed]
  );

  const removePair = useCallback(
    (id) => {
      setPairs((prev) => {
        const target = prev.find((p) => p.id === id);
        if (!target) return prev;
        let next = prev.filter((p) => p.id !== id);
        // Если удалили default, попытаемся назначить новую default
        if (target.isDefault) {
          const fCur = resolveCurrencyOfChannel(channels, target.fromChannelId);
          const tCur = resolveCurrencyOfChannel(channels, target.toChannelId);
          const same = next.filter((p) => {
            const f = resolveCurrencyOfChannel(channels, p.fromChannelId);
            const t = resolveCurrencyOfChannel(channels, p.toChannelId);
            return f === fCur && t === tCur;
          });
          if (same.length > 0) {
            const newDefault = [...same].sort(
              (a, b) => (a.priority || 999) - (b.priority || 999)
            )[0];
            next = next.map((p) =>
              p.id === newDefault.id ? { ...p, isDefault: true } : p
            );
          }
        }
        return next;
      });
      setLastUpdated(new Date());
      markModifiedIfConfirmed();
    },
    [channels, markModifiedIfConfirmed]
  );

  // Сделать pair default для его пары валют (снимает isDefault с других для тех же валют)
  const setDefaultPair = useCallback(
    (id) => {
      const target = pairs.find((p) => p.id === id);
      if (!target) return;
      const fCur = resolveCurrencyOfChannel(channels, target.fromChannelId);
      const tCur = resolveCurrencyOfChannel(channels, target.toChannelId);
      setPairs((prev) =>
        prev.map((p) => {
          const f = resolveCurrencyOfChannel(channels, p.fromChannelId);
          const t = resolveCurrencyOfChannel(channels, p.toChannelId);
          if (f === fCur && t === tCur) {
            return { ...p, isDefault: p.id === id };
          }
          return p;
        })
      );
      setLastUpdated(new Date());
      markModifiedIfConfirmed();
    },
    [pairs, channels, markModifiedIfConfirmed]
  );

  // ---------- Channel API (новый, для pair creation UI) ----------

  const addChannel = useCallback((channel) => {
    const id = channel.id || `ch_${channel.currencyCode.toLowerCase()}_${channel.kind}_${Date.now()}`;
    setChannels((prev) => [...prev, { ...channel, id }]);
    return id;
  }, []);

  const updateChannel = useCallback((id, patch) => {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  // ---------- Confirmation ----------
  const confirmRates = useCallback((userId) => {
    setConfirmationStatus("confirmed");
    setConfirmedAt(new Date().toISOString());
    setConfirmedBy(userId || null);
    setModifiedAfterConfirmation(false);
  }, []);

  const unconfirmRates = useCallback(() => {
    setConfirmationStatus("draft");
    setModifiedAfterConfirmation(false);
  }, []);

  const isConfirmedToday = useMemo(() => {
    if (confirmationStatus !== "confirmed" || !confirmedAt) return false;
    const confirmedDate = new Date(confirmedAt).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    return confirmedDate === today;
  }, [confirmationStatus, confirmedAt]);

  const value = useMemo(
    () => ({
      // legacy API
      rates,
      getRate,
      setRate,
      deleteRate,
      ratesFromBase,
      allTradePairs,
      lastUpdated,
      // per-office overrides
      officeOverrides,
      getOfficeOverride,
      // pair/channel API
      pairs,
      channels,
      getChannel,
      channelsForCurrency,
      defaultChannelOf,
      addPair,
      updatePair,
      removePair,
      setDefaultPair,
      addChannel,
      updateChannel,
      // confirmation
      confirmationStatus,
      confirmedAt,
      confirmedBy,
      modifiedAfterConfirmation,
      isConfirmedToday,
      confirmRates,
      unconfirmRates,
    }),
    [
      rates,
      getRate,
      setRate,
      deleteRate,
      ratesFromBase,
      allTradePairs,
      lastUpdated,
      officeOverrides,
      getOfficeOverride,
      pairs,
      channels,
      getChannel,
      channelsForCurrency,
      defaultChannelOf,
      addPair,
      updatePair,
      removePair,
      setDefaultPair,
      addChannel,
      updateChannel,
      confirmationStatus,
      confirmedAt,
      confirmedBy,
      modifiedAfterConfirmation,
      isConfirmedToday,
      confirmRates,
      unconfirmRates,
    ]
  );

  return <RatesContext.Provider value={value}>{children}</RatesContext.Provider>;
}

export function useRates() {
  const ctx = useContext(RatesContext);
  if (!ctx) throw new Error("useRates must be inside RatesProvider");
  return ctx;
}

// Экспорт хелпера — полезно для любого UI который хочет получить type/kind/network пары
export function describePair(pair, channels) {
  const from = channels.find((c) => c.id === pair.fromChannelId);
  const to = channels.find((c) => c.id === pair.toChannelId);
  if (!from || !to) return null;
  const fromCurrency = currencyByCode(from.currencyCode);
  const toCurrency = currencyByCode(to.currencyCode);
  return {
    fromCurrency,
    toCurrency,
    from,
    to,
    // "crypto" если хоть одна сторона crypto
    type:
      fromCurrency?.type === "crypto" || toCurrency?.type === "crypto"
        ? "crypto"
        : "fiat",
  };
}

// Самые «интересные» пары для отображения в RatesBar — по валютам
export const FEATURED_PAIRS = [
  ["USDT", "TRY"],
  ["USD", "TRY"],
  ["EUR", "TRY"],
  ["GBP", "TRY"],
  ["USDT", "USD"],
];
