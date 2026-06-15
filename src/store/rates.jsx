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
import { pivotRate } from "../utils/morningRatesParser.js";
import { loadPairs, loadOfficeRateOverrides } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";
import { rpcCreatePair } from "../lib/supabaseWrite.js";
import { emitToast } from "../lib/toast.jsx";

export const rateKey = (from, to) => `${from}_${to}`;

// Seed pairs — иллюстративные курсы для демо/fallback-режима (когда Supabase
// не сконфигурирован или загрузка пар временно упала). В проде живые пары
// приходят из БД (`pairs`), эти не используются. Каждая пара — одно направление;
// каждая обратная пара = 1/прямой курс, чтобы round-trip конвертация была
// согласованной и ни одна валюта не «обнулялась» при пересчёте в базовую.
const SEED_PAIRS = [
  // ------- CRYPTO (через USDT TRC20) -------
  { id: "p_usd_usdt_default",  fromChannelId: "ch_usd_cash",   toChannelId: "ch_usdt_trc20", rate: 1.0,      isDefault: true, priority: 10 },
  { id: "p_usdt_usd_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_usd_cash",   rate: 1.0,      isDefault: true, priority: 10 },

  { id: "p_eur_usdt_default",  fromChannelId: "ch_eur_bank",   toChannelId: "ch_usdt_trc20", rate: 1.1532,    isDefault: true, priority: 10 },
  { id: "p_usdt_eur_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_eur_bank",   rate: 0.867152,  isDefault: true, priority: 10 },

  { id: "p_usdt_try_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_try_cash",   rate: 44.0015,   isDefault: true, priority: 10 },
  { id: "p_try_usdt_default",  fromChannelId: "ch_try_cash",   toChannelId: "ch_usdt_trc20", rate: 0.022726,  isDefault: true, priority: 10 },

  { id: "p_gbp_usdt_default",  fromChannelId: "ch_gbp_bank",   toChannelId: "ch_usdt_trc20", rate: 1.3315,    isDefault: true, priority: 10 },
  { id: "p_usdt_gbp_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_gbp_bank",   rate: 0.751033,  isDefault: true, priority: 10 },

  { id: "p_chf_usdt_default",  fromChannelId: "ch_chf_bank",   toChannelId: "ch_usdt_trc20", rate: 1.2635,    isDefault: true, priority: 10 },
  { id: "p_usdt_chf_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_chf_bank",   rate: 0.791452,  isDefault: true, priority: 10 },

  { id: "p_usdt_rub_default",  fromChannelId: "ch_usdt_trc20", toChannelId: "ch_rub_bank",   rate: 77.1752,   isDefault: true, priority: 10 },
  { id: "p_rub_usdt_default",  fromChannelId: "ch_rub_bank",   toChannelId: "ch_usdt_trc20", rate: 0.012958,  isDefault: true, priority: 10 },

  // ------- CASH (через TRY) -------
  { id: "p_usd_try_default",   fromChannelId: "ch_usd_cash",   toChannelId: "ch_try_cash",   rate: 44.9247,   isDefault: true, priority: 10 },
  { id: "p_try_usd_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_usd_cash",   rate: 0.022260,  isDefault: true, priority: 10 },

  { id: "p_usd_eur_default",   fromChannelId: "ch_usd_cash",   toChannelId: "ch_eur_bank",   rate: 0.867152,  isDefault: true, priority: 10 },
  { id: "p_eur_usd_default",   fromChannelId: "ch_eur_bank",   toChannelId: "ch_usd_cash",   rate: 1.1532,    isDefault: true, priority: 10 },

  { id: "p_eur_try_default",   fromChannelId: "ch_eur_bank",   toChannelId: "ch_try_cash",   rate: 52.6279,   isDefault: true, priority: 10 },
  { id: "p_try_eur_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_eur_bank",   rate: 0.019001,  isDefault: true, priority: 10 },

  { id: "p_gbp_try_default",   fromChannelId: "ch_gbp_bank",   toChannelId: "ch_try_cash",   rate: 60.3256,   isDefault: true, priority: 10 },
  { id: "p_try_gbp_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_gbp_bank",   rate: 0.016578,  isDefault: true, priority: 10 },

  { id: "p_chf_try_default",   fromChannelId: "ch_chf_bank",   toChannelId: "ch_try_cash",   rate: 56.5923,   isDefault: true, priority: 10 },
  { id: "p_try_chf_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_chf_bank",   rate: 0.017670,  isDefault: true, priority: 10 },

  { id: "p_rub_try_default",   fromChannelId: "ch_rub_bank",   toChannelId: "ch_try_cash",   rate: 0.495729,  isDefault: true, priority: 10 },
  { id: "p_try_rub_default",   fromChannelId: "ch_try_cash",   toChannelId: "ch_rub_bank",   rate: 2.017227,  isDefault: true, priority: 10 },
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

// Derived rates lookup {"FROM_TO": rate} из default pairs — для обратной совместимости.
//
// Master pair model (0046/0047): для каждой логической пары хранится master
// (priority direction). Reverse pair синхронизирована trigger'ом в БД, но
// для legacy данных может отсутствовать физически. Synthesize reverse =
// 1/master.rate если direct reverse row не найдена → форма сделки и sidebar
// видят оба направления даже когда БД содержит только master row.
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
  // Synthesize missing reverse: для каждого master pair проверяем что
  // обратное направление в lookup есть; если нет — кладём 1/rate.
  pairs.forEach((p) => {
    if (!p.isDefault) return;
    const fCur = resolveCurrencyOfChannel(channels, p.fromChannelId);
    const tCur = resolveCurrencyOfChannel(channels, p.toChannelId);
    if (!fCur || !tCur) return;
    const reverseKey = rateKey(tCur, fCur);
    if (out[reverseKey] === undefined && p.rate > 0) {
      out[reverseKey] = 1 / p.rate;
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
  // НЕРЕЗ/СБП-снимок последнего импорта (информационно, не в движке сделок).
  const [specialRates, setSpecialRates] = useState([]); // [{kind,...,importedAt}]

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
          if (!Array.isArray(dbPairs)) return;
          // Для каждой валюты из загруженных пар гарантируем наличие channel.
          // SEED_CHANNELS покрывает только «старые» 7 валют — для AED/BTC/USDC/…
          // channelForCurrency ниже отдаёт synthetic `ch_<code>_auto`, а
          // buildRatesLookup потом резолвит валюту по этому channelId; если id
          // нет в channels — пара выпадает из lookup и getRate возвращает
          // undefined (форма создания сделки не подставит курс). Регистрируем
          // здесь ровно тот synthetic id, чтобы lookup сошёлся.
          const referencedCurrencies = new Set();
          dbPairs.forEach((db) => {
            if (db.fromCurrency) referencedCurrencies.add(db.fromCurrency);
            if (db.toCurrency) referencedCurrencies.add(db.toCurrency);
          });
          setChannels((prevCh) => {
            const have = new Set(prevCh.map((c) => c.currencyCode));
            const extra = [...referencedCurrencies]
              .filter((code) => !have.has(code))
              .map((code) => ({
                id: `ch_${code.toLowerCase()}_auto`,
                currencyCode: code,
                kind: "cash",
                isDefaultForCurrency: true,
                synthetic: true,
              }));
            return extra.length ? [...prevCh, ...extra] : prevCh;
          });
          // ПОЛНАЯ замена state — раньше делали merge только по seed pairs,
          // новые пары (USD→CHF etc.) из БД игнорировались и тихо исчезали
          // после refresh. Теперь строим pairs state целиком из dbPairs.
          // Для каждой pair резолвим fromChannelId/toChannelId по валюте:
          // используем текущий channels list (стейт хранит default + user-added),
          // с fallback на SEED_CHANNELS и synthetic id если вообще ничего.
          setPairs((prev) => {
            const channelForCurrency = (code) => {
              // 1. Пытаемся сохранить channel из prev если пара уже была
              const prevMatch = prev.find(
                (p) =>
                  p.isDefault &&
                  (prev.find((pp) => pp.id === p.id)?.fromChannelId || "") &&
                  p.fromChannelId &&
                  SEED_CHANNELS.find((c) => c.id === p.fromChannelId)?.currencyCode === code
              );
              if (prevMatch?.fromChannelId) return prevMatch.fromChannelId;
              // 2. Ищем в current channels state (добавленные user'ом тоже здесь)
              const fromChannels = channels.filter((c) => c.currencyCode === code);
              const def = fromChannels.find((c) => c.isDefaultForCurrency) || fromChannels[0];
              if (def?.id) return def.id;
              // 3. Synthetic id для сохранения структуры (не ломает getRate)
              return `ch_${code.toLowerCase()}_auto`;
            };
            return dbPairs.map((db) => {
              const keyForwardId = `p_${db.fromCurrency}_${db.toCurrency}_db`;
              const existing = prev.find(
                (p) =>
                  p.dbId === db.id ||
                  (SEED_CHANNELS.find((c) => c.id === p.fromChannelId)?.currencyCode === db.fromCurrency &&
                    SEED_CHANNELS.find((c) => c.id === p.toChannelId)?.currencyCode === db.toCurrency &&
                    p.isDefault === db.isDefault)
              );
              return {
                id: existing?.id || keyForwardId,
                fromChannelId: existing?.fromChannelId || channelForCurrency(db.fromCurrency),
                toChannelId: existing?.toChannelId || channelForCurrency(db.toCurrency),
                rate: db.rate,
                baseRate: db.baseRate,
                spreadPercent: db.spreadPercent,
                isDefault: db.isDefault,
                isMaster: db.isMaster === true,
                priority: db.priority,
                dbId: db.id,
                updatedAt: db.updatedAt,
              };
            });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // getRate: office override → office USDT-пивот → global → global USDT-пивот.
  const getRate = useCallback(
    (from, to, officeId) => {
      if (from === to) return 1;
      const officeMap =
        officeId && officeOverrides instanceof Map ? officeOverrides.get(officeId) : null;

      // 1. Прямой office-override
      if (officeMap) {
        const ovr = officeMap.get(rateKey(from, to));
        if (ovr && Number.isFinite(ovr.rate)) return ovr.rate;
      }
      // 2. Office USDT-пивот (только офисные якоря-ноги)
      if (officeMap) {
        const officeLeg = (a, b) => {
          const o = officeMap.get(rateKey(a, b));
          return o && Number.isFinite(o.rate) ? o.rate : undefined;
        };
        const p = pivotRate(from, to, officeLeg);
        if (Number.isFinite(p)) return p;
      }
      // 3. Global default
      const direct = rates[rateKey(from, to)];
      if (Number.isFinite(direct)) return direct;
      // 4. Global USDT-пивот
      const globalLeg = (a, b) => rates[rateKey(a, b)];
      const gp = pivotRate(from, to, globalLeg);
      if (Number.isFinite(gp)) return gp;

      return undefined;
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

  // Локальная мутация Map — для немедленного отражения reset/upsert override
  // в UI без ожидания reload через bumpDataVersion (на flaky сети между RPC
  // и reload было видно stale значение, и юзер думал что reset не сработал).
  // value=null → удалить пару из Map; иначе записать.
  const applyOfficeOverrideLocal = useCallback((officeId, from, to, value) => {
    if (!officeId || !from || !to) return;
    const k = rateKey(from, to);
    setOfficeOverrides((prev) => {
      const next = new Map(prev);
      const officeMap = next.has(officeId) ? new Map(next.get(officeId)) : new Map();
      if (value == null) {
        officeMap.delete(k);
      } else {
        officeMap.set(k, value);
      }
      if (officeMap.size === 0) next.delete(officeId);
      else next.set(officeId, officeMap);
      return next;
    });
  }, []);

  const setSpecialRatesSnapshot = useCallback((entries) => {
    setSpecialRates(Array.isArray(entries) ? entries : []);
  }, []);

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
    // Приоритет валют для отображения и master direction. USDT первый —
    // он наш мост между фиатом и криптой (вся работа крутится через него).
    // Затем USD, TRY, EUR — основные рабочие фиаты. Дальше — резерв.
    // Этот же приоритет в SQL 0047_priority_usdt_first.sql backfill.
    const PRIO = { USDT: 0, USD: 1, TRY: 2, EUR: 3, GBP: 4, CHF: 5, RUB: 6 };
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
      applyOfficeOverrideLocal,
      specialRates,
      setSpecialRatesSnapshot,
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
      applyOfficeOverrideLocal,
      specialRates,
      setSpecialRatesSnapshot,
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
