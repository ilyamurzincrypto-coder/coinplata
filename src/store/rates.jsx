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
import { loadPairs } from "../lib/supabaseReaders.js";

export const rateKey = (from, to) => `${from}_${to}`;

// Seed pairs — каждая пара ссылается на два channelId.
// На каждую (from→to) currency-пару отмечена одна isDefault=true.
const SEED_PAIRS = [
  // USDT → ... (default channel: TRC20)
  { id: "p_usdt_try_default", fromChannelId: "ch_usdt_trc20", toChannelId: "ch_try_cash", rate: 38.9, isDefault: true, priority: 10 },
  { id: "p_usdt_usd_default", fromChannelId: "ch_usdt_trc20", toChannelId: "ch_usd_cash", rate: 0.9985, isDefault: true, priority: 10 },
  { id: "p_usdt_eur_default", fromChannelId: "ch_usdt_trc20", toChannelId: "ch_eur_bank", rate: 0.918, isDefault: true, priority: 10 },
  { id: "p_usdt_gbp_default", fromChannelId: "ch_usdt_trc20", toChannelId: "ch_gbp_bank", rate: 0.787, isDefault: true, priority: 10 },

  // USD → ...
  { id: "p_usd_try_default", fromChannelId: "ch_usd_cash", toChannelId: "ch_try_cash", rate: 38.95, isDefault: true, priority: 10 },
  { id: "p_usd_eur_default", fromChannelId: "ch_usd_bank", toChannelId: "ch_eur_bank", rate: 0.9195, isDefault: true, priority: 10 },
  { id: "p_usd_gbp_default", fromChannelId: "ch_usd_bank", toChannelId: "ch_gbp_bank", rate: 0.788, isDefault: true, priority: 10 },

  // EUR → ...
  { id: "p_eur_try_default", fromChannelId: "ch_eur_bank", toChannelId: "ch_try_cash", rate: 42.35, isDefault: true, priority: 10 },
  { id: "p_eur_usd_default", fromChannelId: "ch_eur_bank", toChannelId: "ch_usd_cash", rate: 1.0875, isDefault: true, priority: 10 },
  { id: "p_eur_usdt_default", fromChannelId: "ch_eur_bank", toChannelId: "ch_usdt_trc20", rate: 1.088, isDefault: true, priority: 10 },

  // TRY → ...
  { id: "p_try_usd_default", fromChannelId: "ch_try_cash", toChannelId: "ch_usd_cash", rate: 0.02567, isDefault: true, priority: 10 },
  { id: "p_try_usdt_default", fromChannelId: "ch_try_cash", toChannelId: "ch_usdt_trc20", rate: 0.0257, isDefault: true, priority: 10 },
  { id: "p_try_eur_default", fromChannelId: "ch_try_cash", toChannelId: "ch_eur_bank", rate: 0.02362, isDefault: true, priority: 10 },

  // GBP → ...
  { id: "p_gbp_usd_default", fromChannelId: "ch_gbp_bank", toChannelId: "ch_usd_cash", rate: 1.269, isDefault: true, priority: 10 },
  { id: "p_gbp_try_default", fromChannelId: "ch_gbp_bank", toChannelId: "ch_try_cash", rate: 49.45, isDefault: true, priority: 10 },
  { id: "p_gbp_usdt_default", fromChannelId: "ch_gbp_bank", toChannelId: "ch_usdt_trc20", rate: 1.271, isDefault: true, priority: 10 },

  // Пример non-default pair: USDT→TRY через ERC20 (дороже из-за gas)
  { id: "p_usdt_try_erc20", fromChannelId: "ch_usdt_erc20", toChannelId: "ch_try_cash", rate: 38.85, isDefault: false, priority: 20 },
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

  // DB overlay: для каждой DB-пары (from_currency → to_currency, rate) находим
  // default frontend-пару по валютам (через channels) и обновляем её rate.
  // Frontend channel-based модель не меняется — Stage 4 либо переделает БД,
  // либо фронт; сейчас задача read-only → синхронизация курсов достаточна.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
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
    return () => {
      cancelled = true;
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

  const getRate = useCallback(
    (from, to) => {
      if (from === to) return 1;
      return rates[rateKey(from, to)];
    },
    [rates]
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

  // Список {to, rate} всех default-пар от base currency
  const ratesFromBase = useCallback(
    (base) => {
      const out = [];
      pairs.forEach((p) => {
        if (!p.isDefault) return;
        const fCur = resolveCurrencyOfChannel(channels, p.fromChannelId);
        if (fCur !== base) return;
        const tCur = resolveCurrencyOfChannel(channels, p.toChannelId);
        if (tCur) out.push({ to: tCur, rate: p.rate });
      });
      return out;
    },
    [pairs, channels]
  );

  // ---------- Pair API (новый) ----------

  // Добавить пару. Если default для этой пары валют уже есть — новая создаётся как non-default.
  const addPair = useCallback(
    ({ fromChannelId, toChannelId, rate, priority = 50 }) => {
      const fromCh = channels.find((c) => c.id === fromChannelId);
      const toCh = channels.find((c) => c.id === toChannelId);
      if (!fromCh || !toCh) {
        return { ok: false, warning: "Invalid channel id" };
      }
      if (fromCh.currencyCode === toCh.currencyCode) {
        return { ok: false, warning: "From and To currencies must differ" };
      }
      const id = `p_${fromChannelId}_${toChannelId}_${Date.now()}`;
      const existingDefault = findDefaultPair(
        pairs,
        channels,
        fromCh.currencyCode,
        toCh.currencyCode
      );
      setPairs((prev) => [
        ...prev,
        {
          id,
          fromChannelId,
          toChannelId,
          rate: parseFloat(rate) || 0,
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
      lastUpdated,
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
      lastUpdated,
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
