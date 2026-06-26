// src/components/Balances.jsx
// Dashboard balances — единый контейнер, grid Cash / Bank / Crypto.
// Three-metric model:
//   TOTAL     = balanceOf (фактические деньги — уже физически тут)
//   RESERVED  = reservedOf (pending OUT — "занято" под отложенные сделки)
//   AVAILABLE = balanceOf − reservedOf (что реально можно потратить)
//
// Data sources — только accounts store.
// Pending сделки пишут movements с reserved:true — это меняет reservedOf автоматически.

import React, { useMemo, useState, useCallback } from "react";
import { Banknote, Building2, Coins, Layers, CheckCircle2, Lock, Clock } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import OfficeSwitcher from "./OfficeSwitcher.jsx";
import DateSelector from "./ui/DateSelector.jsx";
import CurrencyIcon from "./ui/CurrencyIcon.jsx";
import BalanceSubLine from "./balances/BalanceSubLine.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useObligations } from "../store/obligations.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { convert } from "../utils/convert.js";
import ObligationsModal from "./ObligationsModal.jsx";

// Доступные валюты для display switch на дашборде. Локальный override
// settings.baseCurrency — без записи в БД, только display.
const DISPLAY_OPTIONS = ["USD", "EUR"];

const NETWORK_RX = /\b(TRC20|ERC20|BEP20)\b/i;
// Определение сети crypto-счёта:
//   1. account.network (из DB network_id) — истинный источник, у новых счетов
//      всегда есть
//   2. Fallback — парсим имя (legacy-аккаунты, у которых имя типа "TRC20 Main"
//      и возможно не было network_id)
//   3. Последний fallback "Network" — если ничего не нашли
const detectNetwork = (account) => {
  const nw = account?.network;
  if (nw) return String(nw).toUpperCase();
  const name = account?.name || "";
  const m = name.match(NETWORK_RX);
  return m ? m[1].toUpperCase() : "Network";
};

// ------- Pure group helper -------
// Office accounts → { cash, bank, crypto } с метриками + delta (сегодня)
// + deltaYesterday (вчера) на каждой позиции.
function groupOfficeAccounts(
  accounts,
  balanceOf,
  reservedOf,
  deltaOf,
  dayStartMs,
  yesterdayStartMs,
  currencyDict,
  toBase  // (amount, currency) => number — для inBase в каждой строке
) {
  const cashMap = new Map();
  const bankMap = new Map();
  const cryptoMap = new Map();

  accounts.forEach((a) => {
    if (!a.active) return;
    const total = balanceOf(a.id);
    const reserved = reservedOf(a.id);
    const delta = deltaOf ? deltaOf(a.id, dayStartMs) : 0;
    const deltaYest =
      deltaOf && yesterdayStartMs ? deltaOf(a.id, yesterdayStartMs, dayStartMs) : 0;

    const meta = currencyDict[a.currency];
    const isCrypto = meta?.type === "crypto";

    if (isCrypto) {
      if (!cryptoMap.has(a.currency)) cryptoMap.set(a.currency, new Map());
      const nw = detectNetwork(a);
      const inner = cryptoMap.get(a.currency);
      const prev = inner.get(nw) || { total: 0, reserved: 0, delta: 0, deltaYesterday: 0 };
      inner.set(nw, {
        total: prev.total + total,
        reserved: prev.reserved + reserved,
        delta: prev.delta + delta,
        deltaYesterday: prev.deltaYesterday + deltaYest,
      });
    } else {
      const bucket = a.type === "cash" ? cashMap : bankMap;
      const prev = bucket.get(a.currency) || { total: 0, reserved: 0, delta: 0, deltaYesterday: 0 };
      bucket.set(a.currency, {
        total: prev.total + total,
        reserved: prev.reserved + reserved,
        delta: prev.delta + delta,
        deltaYesterday: prev.deltaYesterday + deltaYest,
      });
    }
  });

  const toRows = (m) =>
    [...m.entries()]
      .map(([currency, v]) => ({
        currency,
        total: v.total,
        reserved: v.reserved,
        available: v.total - v.reserved,
        delta: v.delta,
        deltaYesterday: v.deltaYesterday,
        inBase: toBase ? toBase(v.total, currency) : null,
      }))
      .sort((a, b) => b.total - a.total);

  const crypto = [...cryptoMap.entries()].map(([currency, nwMap]) => ({
    currency,
    networks: [...nwMap.entries()]
      .map(([network, v]) => ({
        network,
        total: v.total,
        reserved: v.reserved,
        available: v.total - v.reserved,
        delta: v.delta,
        deltaYesterday: v.deltaYesterday,
        inBase: toBase ? toBase(v.total, currency) : null,
      }))
      .sort((a, b) => b.total - a.total),
  }));

  return { cash: toRows(cashMap), bank: toRows(bankMap), crypto };
}

// Форматирует delta для отображения: "+$1,200" / "−€300" / "+$0".
// Всегда возвращает строку — нули тоже показываем (нейтральный цвет
// через deltaClass), чтобы юзер видел что действительно нет изменений.
function fmtDelta(value, currency, opts = {}) {
  const v = Number.isFinite(value) ? value : 0;
  const sym = opts.symbol === false ? "" : curSymbol(currency);
  if (Math.abs(v) < 0.01) return `+${sym}0`;
  const sign = v > 0 ? "+" : "−";
  return `${sign}${sym}${fmt(Math.abs(v), currency)}`;
}

function deltaClass(value) {
  if (!Number.isFinite(value)) return "text-muted";
  if (value > 0.01) return "text-success";
  if (value < -0.01) return "text-danger";
  return "text-muted";
}

// Рендер пары «X сегодня · Y вчера» — всегда в одну строку через middot.
// Дельты — мелкими в caption-уровне, чтобы помещаться под суммой.
//   size: sm (caption 12px) | md (body-sm 13px). По умолчанию sm.
function DeltaPair({ today, yesterday, currency, size = "sm", title }) {
  const todayStr = fmtDelta(today, currency);
  const yStr = yesterday !== undefined ? fmtDelta(yesterday, currency) : null;
  const sizeCls = size === "md" ? "text-body-sm" : "text-caption";
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 ${sizeCls} font-mono font-semibold tabular`}
      title={title || (yStr ? "Дельта сегодня · вчера" : "Дельта с начала дня")}
    >
      <span className={`inline-flex items-baseline gap-1 ${deltaClass(today)}`}>
        {todayStr}
        <span className="opacity-70 font-normal">сегодня</span>
      </span>
      {yStr && (
        <>
          <span className="text-muted-soft font-normal">·</span>
          <span className={`inline-flex items-baseline gap-1 ${deltaClass(yesterday)}`}>
            {yStr}
            <span className="opacity-70 font-normal">вчера</span>
          </span>
        </>
      )}
    </span>
  );
}

// ------- UI: one currency row (Total / Reserved / Available) -------

// Строго: name слева, сумма справа, available-зеленый только если > 0 и без reserved.
// Compact пакет: иконка | название+сеть | сумма (h2) + toggle-sub-line.
// Высота строки ~44px. Zero-row (amount < 0.01) — иконка muted, сумма
// muted-soft, sub-line не рендерится.
//
// rowKeyPrefix — стабильный префикс (officeId:groupKey), на его базе
// формируется ID для BalanceSubLine localStorage. Без префикса USD в
// Cash и USD в Bank разных офисов переключались бы вместе.
function AssetRow({
  name,
  subtitle,         // optional network/sub-label, рендерится inline mono tag
  amount,
  currency,
  reserved,
  delta,
  deltaYesterday,
  inBase,           // USD/EUR эквивалент native amount (число) — опционально
  base,             // тикер базовой валюты для рендера USD-эквивалента
  rowKeyPrefix = "",
}) {
  const hasReserved = reserved > 0;
  const isZero = Math.abs(amount || 0) < 0.01;
  const rowId = `${rowKeyPrefix}:${currency}:${subtitle || ""}`;
  return (
    <div className="grid grid-cols-[32px_1fr_auto] items-center gap-3 px-1 py-2 border-b border-border-soft last:border-b-0">
      <div className={isZero ? "opacity-50" : ""}>
        <CurrencyIcon ccy={currency} size="sm" />
      </div>
      <div className="text-body-sm font-semibold text-ink flex items-center gap-2 min-w-0">
        <span className="truncate">{name}</span>
        {subtitle && (
          <span className="text-tiny font-bold font-mono text-muted tracking-wide uppercase shrink-0">
            {subtitle}
          </span>
        )}
      </div>
      <div className="text-right flex flex-col items-end leading-tight gap-0.5">
        <div className={`font-mono tabular text-h2 font-bold ${isZero ? "text-muted-soft" : "text-ink"}`}>
          {curSymbol(currency)}{fmt(amount, currency)}
        </div>
        {!isZero && (
          <BalanceSubLine
            rowId={rowId}
            usdEquivalent={inBase}
            baseCcy={base}
            nativeCcy={currency}
            deltaToday={delta}
            deltaYesterday={deltaYesterday}
          />
        )}
        {!isZero && hasReserved && (
          <div className="text-caption font-mono tabular text-warning">
            −{fmt(reserved, currency)} pending
          </div>
        )}
      </div>
    </div>
  );
}

// ------- Cash / Bank card -------

// Нейтральная карточка группы. Все группы идентичны визуально.
// — заголовок (CASH / BANK / CRYPTO)
// — total
// — divider
// — список активов (скролл при переполнении)
//
// split=true → визуально разделяет верхнюю часть (header+total+delta) и
// нижнюю (assets list) на два sub-контейнера. Используется для Crypto:
// верх = "общий остаток ПО ВСЕМ офисам" (через globalTotal/Delta props),
// низ = "стата по этому офису" (rows + локальные total). Внешний bordered
// card и общая высота сохраняются — layout не прыгает.
function GroupCard({
  title,
  icon: Icon,
  rows,
  total,
  totalDelta,
  totalDeltaYesterday,
  emptyText,
  currency,
  base,           // ← для USD-эквивалентов в строках
  rowKeyPrefix = "",   // ← стабильный префикс для localStorage в BalanceSubLine
  split = false,
  globalTotal,
  globalDelta,
  globalDeltaYesterday,
}) {
  // В split режиме верхний блок показывает GLOBAL значения (по всем офисам).
  // Если global props не переданы — fallback на локальные total/delta.
  const headerTotal = split && globalTotal != null ? globalTotal : total;
  const headerDelta = split && globalDelta != null ? globalDelta : totalDelta;
  const headerDeltaY =
    split && globalDeltaYesterday != null ? globalDeltaYesterday : totalDeltaYesterday;

  const headerBlock = (
    <>
      {/* Header: title + опциональный ALL OFFICES badge (для Crypto, где
          верхний total = глобальный по всем офисам в USDT). */}
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted" strokeWidth={1.75} />
        <span className="text-micro text-muted uppercase">{title}</span>
        {split && (
          <span
            className="inline-flex items-center h-4 px-1.5 rounded bg-accent-bg text-success text-micro font-bold tracking-wider uppercase"
            title="Общий остаток по всем офисам"
          >
            All offices
          </span>
        )}
        <span className="ml-auto text-tiny font-semibold text-muted-soft font-mono tabular">
          {rows.length}
        </span>
      </div>

      {/* Total amount — one line */}
      <div className="mt-2 text-display font-mono tabular text-ink leading-none">
        {curSymbol(currency)}{fmt(headerTotal, currency)}
        <span className="text-caption text-muted-soft font-semibold ml-1.5">{currency}</span>
      </div>
      {/* Дельта сегодня · вчера — одной строкой через middot. */}
      <div className="mt-1.5">
        <DeltaPair
          today={headerDelta}
          yesterday={headerDeltaY}
          currency={currency}
          size="sm"
          title={split ? "Общий по всем офисам · сегодня · вчера" : "Сегодня · вчера (до 00:00)"}
        />
      </div>
    </>
  );

  // Единый layout для всех трёх карточек (Crypto / Cash / Bank).
  // ALL OFFICES badge внутри headerBlock — единственное отличие Crypto.
  // splitLocalTotal/splitLocalCurrency больше не используются — Crypto
  // показывает globalTotal в верхнем числе, а assets list ниже остаётся
  // по текущему офису как у Cash/Bank.
  return (
    <div className="bg-surface rounded-card p-card flex flex-col h-full min-h-[220px]">
      {headerBlock}
      <div className="mt-3 border-t border-border-soft" />
      {/* Список активов — без max-height/скролла: показываем все строки
          сразу, юзер видит остатки без прокручивания. */}
      <div className="mt-2 flex-1">
        {rows.length === 0 ? (
          <div className="text-caption text-muted italic py-4 text-center">{emptyText}</div>
        ) : (
          rows.map((r, i) => (
            <AssetRow
              key={`${r.currency}_${r.subtitle || i}`}
              name={r.currency}
              subtitle={r.subtitle}
              amount={r.total}
              currency={r.currency}
              reserved={r.reserved}
              delta={r.delta}
              deltaYesterday={r.deltaYesterday}
              inBase={r.inBase}
              base={base}
              rowKeyPrefix={rowKeyPrefix}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ------- Crypto card (валюта → сети) -------

// Плоский список криптоактивов: USDT (TRC20), USDT (ERC20), BTC, ETH...
// Каждая пара (currency, network) — отдельная строка. Total = сумма в base.
function cryptoRowsFromGroups(cryptoGroups) {
  const out = [];
  cryptoGroups.forEach((c) => {
    c.networks.forEach((n) => {
      out.push({
        currency: c.currency,
        subtitle: n.network,
        total: n.total,
        reserved: n.reserved,
        delta: n.delta,
        deltaYesterday: n.deltaYesterday,
        inBase: n.inBase,
      });
    });
  });
  return out;
}

// ------- Office block -------

function OfficeBlock({
  office,
  accounts,
  balanceOf,
  reservedOf,
  deltaOf,
  dayStartMs,
  yesterdayStartMs,
  currencyDict,
  toBase,
  toUsdt,
  base,
  globalCryptoTotal,
  globalCryptoDelta,
  globalCryptoDeltaYesterday,
  hideTotals = false,
}) {
  const grouped = useMemo(
    () =>
      groupOfficeAccounts(
        accounts,
        balanceOf,
        reservedOf,
        deltaOf,
        dayStartMs,
        yesterdayStartMs,
        currencyDict,
        toBase
      ),
    [accounts, balanceOf, reservedOf, deltaOf, dayStartMs, yesterdayStartMs, currencyDict, toBase]
  );

  const allAccs = accounts.filter((a) => a.active);
  const totals = useMemo(() => {
    let total = 0;
    let reserved = 0;
    let delta = 0;
    let deltaYesterday = 0;
    allAccs.forEach((a) => {
      total += toBase(balanceOf(a.id), a.currency);
      reserved += toBase(reservedOf(a.id), a.currency);
      delta += toBase(deltaOf(a.id, dayStartMs), a.currency);
      deltaYesterday += toBase(
        deltaOf(a.id, yesterdayStartMs, dayStartMs),
        a.currency
      );
    });
    return {
      total,
      reserved,
      available: total - reserved,
      delta,
      deltaYesterday,
      hasReserved: reserved > 0,
    };
  }, [allAccs, balanceOf, reservedOf, deltaOf, dayStartMs, yesterdayStartMs, toBase]);

  return (
    <div className="space-y-3">
      {/* Office header — рендерится только в multi-office режиме.
          При scope=selected (один офис) header дублирует section-header
          выше («Балансы N · Mark Antalya»), скрываем его целиком. */}
      {!hideTotals && (
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border-soft">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted" strokeWidth={1.75} />
            <h3 className="text-h3 text-ink">{office.name}</h3>
            <span className="text-caption text-muted">· {allAccs.length} accounts</span>
          </div>
          <div className="flex items-center gap-2 text-caption tabular-nums">
            <MiniStat label="Total" value={totals.total} sym={curSymbol(base)} tone="slate" />
            {totals.hasReserved && (
              <MiniStat
                label="Pending"
                value={totals.reserved}
                sym={curSymbol(base)}
                tone="amber"
                icon={Clock}
              />
            )}
            <MiniStat
              label="Available"
              value={totals.available}
              sym={curSymbol(base)}
              tone="emerald"
              icon={CheckCircle2}
            />
          </div>
        </div>
      )}

      {/* 3 равные колонки — Cash / Bank / Crypto. Стабильный layout
          независимо от количества валют. */}
      {(() => {
        const cryptoRows = cryptoRowsFromGroups(grouped.crypto);
        const sumBase = (rows, key = "total") =>
          rows.reduce((s, r) => s + toBase(r[key] || 0, r.currency), 0);
        // Crypto totals — В USDT (нативная валюта крипто-блока), не в USD/EUR.
        const sumUsdt = (rows, key = "total") =>
          rows.reduce((s, r) => s + (toUsdt ? toUsdt(r[key] || 0, r.currency) : 0), 0);
        const cashTotalBase = sumBase(grouped.cash, "total");
        const bankTotalBase = sumBase(grouped.bank, "total");
        const cryptoTotalUsdt = sumUsdt(cryptoRows, "total");
        const cashDeltaBase = sumBase(grouped.cash, "delta");
        const bankDeltaBase = sumBase(grouped.bank, "delta");
        const cryptoDeltaUsdt = sumUsdt(cryptoRows, "delta");
        const cashDeltaYBase = sumBase(grouped.cash, "deltaYesterday");
        const bankDeltaYBase = sumBase(grouped.bank, "deltaYesterday");
        const cryptoDeltaYUsdt = sumUsdt(cryptoRows, "deltaYesterday");
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <GroupCard
              title="Crypto"
              icon={Coins}
              rows={cryptoRows}
              total={cryptoTotalUsdt}
              totalDelta={cryptoDeltaUsdt}
              totalDeltaYesterday={cryptoDeltaYUsdt}
              currency="USDT"
              base={base}
              rowKeyPrefix={`${office.id}:crypto`}
              emptyText="No crypto accounts"
              split
              globalTotal={globalCryptoTotal}
              globalDelta={globalCryptoDelta}
              globalDeltaYesterday={globalCryptoDeltaYesterday}
            />
            <GroupCard
              title="Cash"
              icon={Banknote}
              rows={grouped.cash}
              total={cashTotalBase}
              totalDelta={cashDeltaBase}
              totalDeltaYesterday={cashDeltaYBase}
              currency={base}
              base={base}
              rowKeyPrefix={`${office.id}:cash`}
              emptyText="No cash accounts"
            />
            <GroupCard
              title="Bank"
              icon={Building2}
              rows={grouped.bank}
              total={bankTotalBase}
              totalDelta={bankDeltaBase}
              totalDeltaYesterday={bankDeltaYBase}
              currency={base}
              base={base}
              rowKeyPrefix={`${office.id}:bank`}
              emptyText="No bank accounts"
            />
          </div>
        );
      })()}
    </div>
  );
}

// ------- Mini stat badge (inline, compact) -------

function MiniStat({ label, value, sym, tone, icon: Icon }) {
  const tones = {
    slate: "bg-surface-sunk text-ink-soft",
    amber: "bg-warning-soft text-warning",
    emerald: "bg-success-soft text-success",
  };
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-badge px-2 py-1 ${tones[tone] || tones.slate}`}>
      {Icon && <Icon className="w-3 h-3" strokeWidth={2} />}
      <span className="text-micro font-bold uppercase tracking-wider opacity-75">{label}</span>
      <span className="font-mono font-semibold tabular">
        {sym}
        {fmt(value)}
      </span>
    </div>
  );
}

// ------- Main -------

const ALL_OFFICES_ID = "__all__";

export default function Balances({ currentOffice, onOfficeChange, scope, onScopeChange }) {
  const { t } = useTranslation();
  const { accounts, balanceOf, reservedOf, deltaOf } = useAccounts();
  const { activeOffices, findOffice } = useOffices();
  const { dict: currencyDict } = useCurrencies();
  const { base: settingsBase, getRateFx } = useBaseCurrency();
  const { obligations, openCount: openObligationsCount } = useObligations();
  const [obligationsOpen, setObligationsOpen] = useState(false);

  // Локальный display override — переключатель USD/EUR в шапке. По
  // умолчанию = settings.baseCurrency. Не пишет в БД, чисто visual.
  const [displayBase] = useState(() =>
    DISPLAY_OPTIONS.includes(settingsBase) ? settingsBase : "USD"
  );
  const base = displayBase;
  // Селектор даты (заменил тогл USD/EUR) — пока только UI, на данные не влияет.
  const [asOfDate, setAsOfDate] = useState(() => new Date());
  // toBase использует БИРЖЕВОЙ курс из settings.fxRates (приоритетно)
  // через getRateFx. Если для пары нет fx-курса — fallback на офисный
  // getRate. Это даёт чистую агрегированную метрику без офисной маржи.
  const toBase = useCallback(
    (amount, from) => {
      if (!from) return amount || 0;
      return convert(amount, from, base, getRateFx);
    },
    [base, getRateFx]
  );

  // Период для delta — сегодня (с 00:00 local) + вчера (для сравнения).
  // dayStartMs / yesterdayStartMs computed once via useMemo.
  const { dayStartMs, yesterdayStartMs } = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const today = d.getTime();
    return { dayStartMs: today, yesterdayStartMs: today - 24 * 60 * 60 * 1000 };
  }, []);

  const officesToRender = useMemo(() => {
    if (scope === "all") return activeOffices;
    const o = findOffice(currentOffice);
    return o ? [o] : [];
  }, [scope, activeOffices, currentOffice, findOffice]);

  // Кол-во активных счетов в текущем scope — для counter-pill в section header.
  const accountsInScope = useMemo(() => {
    if (scope === "all") return accounts.filter((a) => a.active).length;
    return accounts.filter((a) => a.active && a.officeId === currentOffice).length;
  }, [accounts, scope, currentOffice]);

  // Конверсия крипты в USDT (нативную валюту крипто-блока) — НЕ в USD/EUR.
  // Для USDT → USDT = 1.0 (тривиально), для BTC/ETH → через convert().
  // Юзер хочет видеть общий крипто-баланс в USDT, а не в долларах.
  const toUsdt = useCallback(
    (amount, from) => {
      if (!from) return amount || 0;
      if (from === "USDT") return amount || 0;
      // Stablecoin → USDT 1:1 — display assumption когда нет явного fx-курса.
      // USDC, DAI, BUSD котируются ≈ 1:1 к USDT/USD на cash markets.
      const STABLES = new Set(["USDC", "DAI", "BUSD"]);
      if (STABLES.has(from)) return amount || 0;
      const v = convert(amount, from, "USDT", getRateFx);
      return Number.isFinite(v) ? v : 0;
    },
    [getRateFx]
  );

  // GLOBAL crypto totals — суммируются по ВСЕМ офисам (independent от scope).
  // В USDT (не в base currency). Юзер: "общий баланс ин крипто должен
  // быть не в долларах".
  const globalCrypto = useMemo(() => {
    let total = 0;
    let delta = 0;
    let deltaYesterday = 0;
    accounts.forEach((a) => {
      if (!a.active) return;
      if (currencyDict[a.currency]?.type !== "crypto") return;
      total += toUsdt(balanceOf(a.id), a.currency);
      delta += toUsdt(deltaOf(a.id, dayStartMs), a.currency);
      deltaYesterday += toUsdt(
        deltaOf(a.id, yesterdayStartMs, dayStartMs),
        a.currency
      );
    });
    return { total, delta, deltaYesterday };
  }, [accounts, currencyDict, balanceOf, deltaOf, dayStartMs, yesterdayStartMs, toUsdt]);

  // Grand totals + obligations + delta (сегодня и вчера).
  const grand = useMemo(() => {
    const relevant =
      scope === "all"
        ? accounts.filter((a) => a.active)
        : accounts.filter((a) => a.active && a.officeId === currentOffice);
    let total = 0;
    let reserved = 0;
    let delta = 0;
    let deltaYesterday = 0;
    relevant.forEach((a) => {
      total += toBase(balanceOf(a.id), a.currency);
      reserved += toBase(reservedOf(a.id), a.currency);
      delta += toBase(deltaOf(a.id, dayStartMs), a.currency);
      deltaYesterday += toBase(
        deltaOf(a.id, yesterdayStartMs, dayStartMs),
        a.currency
      );
    });
    const officeIds = new Set(relevant.map((a) => a.officeId));
    const obligationsBase = obligations
      .filter((o) => o.status === "open" && o.direction === "we_owe" && officeIds.has(o.officeId))
      .reduce((s, o) => s + toBase(o.amount, o.currency), 0);
    return {
      total,
      reserved,
      delta,
      deltaYesterday,
      obligations: obligationsBase,
      available: total - reserved - obligationsBase,
      hasReserved: reserved > 0,
      hasObligations: obligationsBase > 0,
    };
  }, [accounts, scope, currentOffice, balanceOf, reservedOf, deltaOf, dayStartMs, yesterdayStartMs, toBase, obligations]);

  const sym = curSymbol(base);

  return (
    <section className="w-full">
      {/* Всё внутри ОДНОЙ карточки — header (Балансы + офис + controls)
          → stat-strip (Total + Available + border-b) → office blocks.
          pt-3.5 (14px) от top-edge до заголовка — синхронизировано с
          RatesSidebar. БЕЗ h-full — Balances делит cell с Obligations
          через space-y-4; растягивать его на всю высоту cell сломает
          stack под ним. */}
      <div className="w-full bg-surface rounded-card flex flex-col">
        {/* Header */}
        <div className="px-card pt-3.5 pb-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-h2 text-ink flex items-center gap-2 min-w-0">
            {t("balances")}
            <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular">
              {accountsInScope}
            </span>
            <span className="text-body-sm text-muted font-normal ml-2 inline-flex items-center gap-1.5 truncate">
              {scope === "selected" ? (
                <>
                  <Building2 className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{findOffice(currentOffice)?.name || "—"}</span>
                </>
              ) : (
                <>
                  <Layers className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{t("all_offices")} · {activeOffices.length}</span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {grand.hasObligations && (
              <button
                type="button"
                onClick={() => setObligationsOpen(true)}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-badge bg-danger-soft text-danger text-caption font-semibold hover:bg-danger-soft/70 transition-colors"
                title="Open obligations — click to settle"
              >
                <Lock className="w-3 h-3" strokeWidth={2} />
                <span>Obligations · {openObligationsCount}</span>
                <span className="font-mono tabular font-bold">{sym}{fmt(grand.obligations)}</span>
              </button>
            )}
            {/* Селектор офиса (перенесён из шапки кассы) — заменяет тогл
                «Выбранный/Все офисы»: выбор офиса ставит scope=selected +
                currentOffice, пункт «Все офисы» → scope=all. */}
            <div className="w-[190px]">
              <OfficeSwitcher
                value={scope === "all" ? ALL_OFFICES_ID : currentOffice}
                onChange={(id) => {
                  if (id === ALL_OFFICES_ID) {
                    onScopeChange?.("all");
                  } else {
                    onOfficeChange?.(id);
                    onScopeChange?.("selected");
                  }
                }}
                offices={[
                  { id: ALL_OFFICES_ID, name: t("all_offices") },
                  ...activeOffices.map((o) => ({ id: o.id, name: o.name })),
                ]}
              />
            </div>
            <DateSelector value={asOfDate} onChange={setAsOfDate} />
          </div>
        </div>

        {/* Stat-strip: Total + Available + delta. Border-b на всю ширину
            карточки, контент ограничен max-w-2xl. */}
        <div className="px-card pb-5 border-b border-border">
          <div className="grid grid-cols-2 gap-10 max-w-2xl">
            <div className="flex flex-col gap-1">
              <div className="text-micro text-muted uppercase">Total balance</div>
              <div className="font-mono tabular text-display-lg text-ink leading-none">
                {sym}{fmt(grand.total)}
                <span className="text-muted-soft text-h2 ml-1.5 font-semibold">{base}</span>
              </div>
              <div className="text-caption">
                <DeltaPair
                  today={grand.delta}
                  yesterday={grand.deltaYesterday}
                  currency={base}
                  size="sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-micro text-muted uppercase inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-success" strokeWidth={2.2} />
                Available
              </div>
              <div className="font-mono tabular text-display-lg text-ink leading-none">
                {sym}{fmt(grand.available)}
                <span className="text-muted-soft text-h2 ml-1.5 font-semibold">{base}</span>
              </div>
              <div className="text-caption text-muted">
                {accountsInScope} счетов{grand.hasReserved ? ` · ${sym}${fmt(grand.reserved)} pending` : ""}
              </div>
            </div>
          </div>
        </div>

        {/* Office blocks */}
        <div className="px-card py-5">
          {officesToRender.length === 0 ? (
            <div className="py-6 text-center text-body-sm text-muted">No active offices</div>
          ) : (
            <div className="space-y-6">
              {officesToRender.map((office) => {
                const officeAccs = accounts.filter((a) => a.officeId === office.id && a.active);
                return (
                  <OfficeBlock
                    key={office.id}
                    office={office}
                    accounts={officeAccs}
                    balanceOf={balanceOf}
                    reservedOf={reservedOf}
                    deltaOf={deltaOf}
                    dayStartMs={dayStartMs}
                    yesterdayStartMs={yesterdayStartMs}
                    currencyDict={currencyDict}
                    toBase={toBase}
                    toUsdt={toUsdt}
                    base={base}
                    globalCryptoTotal={globalCrypto.total}
                    globalCryptoDelta={globalCrypto.delta}
                    globalCryptoDeltaYesterday={globalCrypto.deltaYesterday}
                    hideTotals={officesToRender.length === 1}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ObligationsModal open={obligationsOpen} onClose={() => setObligationsOpen(false)} />
    </section>
  );
}

