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
import { Wallet, Banknote, Building2, Coins, Clock, Layers, CheckCircle2, Lock } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
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
  currencyDict
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
  if (!Number.isFinite(value)) return "text-slate-400";
  if (value > 0.01) return "text-emerald-600";
  if (value < -0.01) return "text-rose-600";
  return "text-slate-400";
}

// Рендер пары "сегодня / вчера" через слэш с явными подписями
// и individual цветами. Если yesterday не задан — рендерится только сегодня.
function DeltaPair({ today, yesterday, currency, size = "xs", title }) {
  const todayStr = fmtDelta(today, currency);
  const yStr = yesterday !== undefined ? fmtDelta(yesterday, currency) : null;
  const sizeCls = size === "sm" ? "text-[11px]" : "text-[10px]";
  const labelCls = size === "sm" ? "text-[9px]" : "text-[8px]";
  return (
    <span
      className={`inline-flex items-baseline gap-1 ${sizeCls} font-bold tabular-nums`}
      title={title || (yStr ? "сегодня / вчера" : "Изменение с начала дня")}
    >
      <span className={`inline-flex items-baseline gap-0.5 ${deltaClass(today)}`}>
        {todayStr}
        <span className={`${labelCls} font-semibold opacity-70`}>сегодня</span>
      </span>
      {yStr && (
        <>
          <span className="text-slate-300 font-normal">/</span>
          <span className={`inline-flex items-baseline gap-0.5 ${deltaClass(yesterday)}`}>
            {yStr}
            <span className={`${labelCls} font-semibold opacity-70`}>вчера</span>
          </span>
        </>
      )}
    </span>
  );
}

// ------- UI: one currency row (Total / Reserved / Available) -------

// Строго: name слева, сумма справа, available-зеленый только если > 0 и без reserved.
function AssetRow({ name, subtitle, amount, currency, reserved, delta, deltaYesterday }) {
  const hasReserved = reserved > 0;
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-slate-800 truncate">{name}</div>
        {subtitle && (
          <div className="text-[10px] text-slate-400 truncate">{subtitle}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-[13px] font-semibold tabular-nums text-slate-900 inline-flex items-baseline gap-1.5">
          <span>{curSymbol(currency)}{fmt(amount, currency)}</span>
          <DeltaPair today={delta} yesterday={deltaYesterday} currency={currency} />
        </div>
        {hasReserved && (
          <div className="text-[10px] text-amber-700 tabular-nums">
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
      {/* Header: title */}
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[11px] font-bold text-slate-600 tracking-[0.15em] uppercase">
          {title}
        </span>
        {split && (
          <span
            className="text-[8px] font-bold text-slate-400 uppercase tracking-wider px-1 py-px rounded bg-slate-200/60"
            title="Общий остаток по всем офисам"
          >
            All offices
          </span>
        )}
        <span className="ml-auto text-[10px] font-semibold text-slate-400 tabular-nums">
          {rows.length}
        </span>
      </div>

      {/* Total amount — one line, right-aligned via block */}
      <div className="mt-2 text-[24px] font-bold tabular-nums tracking-tight text-slate-900 leading-none">
        {curSymbol(currency)}{fmt(headerTotal, currency)}
        <span className="text-[12px] text-slate-400 font-medium ml-1.5">{currency}</span>
      </div>
      <div className="mt-1">
        <DeltaPair
          today={headerDelta}
          yesterday={headerDeltaY}
          currency={currency}
          size="sm"
          title={split ? "Общий по всем офисам · сегодня / вчера" : "Сегодня / вчера (до 00:00)"}
        />
      </div>
    </>
  );

  const assetsBlock = (
    <div className="overflow-y-auto flex-1" style={{ maxHeight: 220 }}>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic py-4 text-center">{emptyText}</div>
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
          />
        ))
      )}
    </div>
  );

  if (split) {
    // Двух-контейнерный layout:
    //   верх (slate) = общий остаток по всем офисам (globalTotal)
    //   низ (white)  = вклад этого офиса (total + assets list)
    // Тот же внешний bordered card → тот же визуальный footprint и высота.
    return (
      <div className="bg-white border border-slate-200 rounded-[14px] p-2 flex flex-col h-full min-h-[220px] gap-2">
        <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2.5">
          {headerBlock}
        </div>
        <div className="bg-white border border-slate-200 rounded-[10px] px-3 py-2 flex flex-col flex-1 min-h-0">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[9px] font-bold text-slate-400 tracking-[0.15em] uppercase">
              По офису
            </span>
            <span className="text-[11px] font-bold tabular-nums text-slate-700">
              {curSymbol(currency)}{fmt(total, currency)}
            </span>
          </div>
          {assetsBlock}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-[14px] p-4 flex flex-col h-full min-h-[220px]">
      {headerBlock}
      {/* Divider */}
      <div className="mt-3 border-t border-slate-200" />
      {/* Assets list with scroll */}
      <div className="mt-2 overflow-y-auto flex-1" style={{ maxHeight: 220 }}>
        {rows.length === 0 ? (
          <div className="text-[11px] text-slate-400 italic py-4 text-center">{emptyText}</div>
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
  base,
  globalCryptoTotal,
  globalCryptoDelta,
  globalCryptoDeltaYesterday,
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
        currencyDict
      ),
    [accounts, balanceOf, reservedOf, deltaOf, dayStartMs, yesterdayStartMs, currencyDict]
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
      {/* Office header */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-500" />
          <h3 className="text-[14px] font-semibold text-slate-900">{office.name}</h3>
          <span className="text-[11px] text-slate-400">· {allAccs.length} accounts</span>
          <DeltaPair
            today={totals.delta}
            yesterday={totals.deltaYesterday}
            currency={base}
            size="sm"
            title="Сегодня / вчера по этому офису"
          />
        </div>
        <div className="flex items-center gap-2 text-[12px] tabular-nums">
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

      {/* 3 равные колонки — Cash / Bank / Crypto. Стабильный layout
          независимо от количества валют. */}
      {(() => {
        const cryptoRows = cryptoRowsFromGroups(grouped.crypto);
        const sumBase = (rows, key = "total") =>
          rows.reduce((s, r) => s + toBase(r[key] || 0, r.currency), 0);
        const cashTotalBase = sumBase(grouped.cash, "total");
        const bankTotalBase = sumBase(grouped.bank, "total");
        const cryptoTotalBase = sumBase(cryptoRows, "total");
        const cashDeltaBase = sumBase(grouped.cash, "delta");
        const bankDeltaBase = sumBase(grouped.bank, "delta");
        const cryptoDeltaBase = sumBase(cryptoRows, "delta");
        const cashDeltaYBase = sumBase(grouped.cash, "deltaYesterday");
        const bankDeltaYBase = sumBase(grouped.bank, "deltaYesterday");
        const cryptoDeltaYBase = sumBase(cryptoRows, "deltaYesterday");
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <GroupCard
              title="Cash"
              icon={Banknote}
              rows={grouped.cash}
              total={cashTotalBase}
              totalDelta={cashDeltaBase}
              totalDeltaYesterday={cashDeltaYBase}
              currency={base}
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
              emptyText="No bank accounts"
            />
            <GroupCard
              title="Crypto"
              icon={Coins}
              rows={cryptoRows}
              total={cryptoTotalBase}
              totalDelta={cryptoDeltaBase}
              totalDeltaYesterday={cryptoDeltaYBase}
              currency={base}
              emptyText="No crypto accounts"
              split
              globalTotal={globalCryptoTotal}
              globalDelta={globalCryptoDelta}
              globalDeltaYesterday={globalCryptoDeltaYesterday}
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
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${tones[tone] || tones.slate}`}>
      {Icon && <Icon className="w-3 h-3" />}
      <span className="text-[9px] font-bold uppercase tracking-wider opacity-75">{label}</span>
      <span className="font-bold">
        {sym}
        {fmt(value)}
      </span>
    </div>
  );
}

// ------- Main -------

export default function Balances({ currentOffice, scope, onScopeChange }) {
  const { t } = useTranslation();
  const { accounts, balanceOf, reservedOf, deltaOf } = useAccounts();
  const { activeOffices, findOffice } = useOffices();
  const { dict: currencyDict } = useCurrencies();
  const { base: settingsBase, getRateFx } = useBaseCurrency();
  const { obligations, openCount: openObligationsCount } = useObligations();
  const [obligationsOpen, setObligationsOpen] = useState(false);

  // Локальный display override — переключатель USD/EUR в шапке. По
  // умолчанию = settings.baseCurrency. Не пишет в БД, чисто visual.
  const [displayBase, setDisplayBase] = useState(() =>
    DISPLAY_OPTIONS.includes(settingsBase) ? settingsBase : "USD"
  );
  const base = displayBase;
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

  // GLOBAL crypto totals — суммируются по ВСЕМ офисам (independent от scope).
  // Используется в верхнем sub-контейнере GroupCard "Crypto" (split=true) —
  // юзер видит общий баланс крипты компании, переключение офиса не меняет.
  const globalCrypto = useMemo(() => {
    let total = 0;
    let delta = 0;
    let deltaYesterday = 0;
    accounts.forEach((a) => {
      if (!a.active) return;
      if (currencyDict[a.currency]?.type !== "crypto") return;
      total += toBase(balanceOf(a.id), a.currency);
      delta += toBase(deltaOf(a.id, dayStartMs), a.currency);
      deltaYesterday += toBase(
        deltaOf(a.id, yesterdayStartMs, dayStartMs),
        a.currency
      );
    });
    return { total, delta, deltaYesterday };
  }, [accounts, currencyDict, balanceOf, deltaOf, dayStartMs, yesterdayStartMs, toBase]);

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
      {/* Header with 3-metric summary */}
      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-3.5 h-3.5 text-slate-400" />
            <h2 className="text-[11px] font-semibold text-slate-500 tracking-widest uppercase">
              {t("balances")}
            </h2>
          </div>
          <div className="text-[13px] text-slate-600 font-medium flex items-center gap-2 flex-wrap">
            {scope === "selected" ? (
              <>
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                {findOffice(currentOffice)?.name || "—"}
              </>
            ) : (
              <>
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                {t("all_offices")} · {activeOffices.length}
              </>
            )}
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 ring-1 ring-slate-200"
              title="Сегодня / вчера"
            >
              <DeltaPair
                today={grand.delta}
                yesterday={grand.deltaYesterday}
                currency={base}
                size="sm"
              />
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tri-metric summary */}
          <div className="inline-flex gap-1 bg-white border border-slate-200 rounded-[10px] p-1">
            <SummaryBadge
              label="Total"
              value={grand.total}
              sym={sym}
              tone="slate"
              delta={grand.delta}
              deltaYesterday={grand.deltaYesterday}
              deltaCurrency={base}
            />
            {grand.hasReserved && (
              <SummaryBadge label="Pending" value={grand.reserved} sym={sym} tone="amber" icon={Clock} />
            )}
            {grand.hasObligations && (
              <button
                type="button"
                onClick={() => setObligationsOpen(true)}
                className="flex flex-col items-start rounded-md px-2.5 py-1 text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors"
                title="Open obligations — click to settle"
              >
                <div className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider opacity-75">
                  <Lock className="w-2.5 h-2.5" />
                  Obligations · {openObligationsCount}
                </div>
                <div className="text-[13px] font-semibold tabular-nums">
                  {sym}{fmt(grand.obligations)}
                </div>
              </button>
            )}
            <SummaryBadge
              label="Available"
              value={grand.available}
              sym={sym}
              tone="emerald"
              icon={CheckCircle2}
              emphasize
            />
          </div>
          <SegmentedControl
            options={[
              { id: "selected", name: t("selected_office") },
              { id: "all", name: t("all_offices") },
            ]}
            value={scope}
            onChange={onScopeChange}
            size="sm"
          />
          {/* Display currency override — локальный переключатель USD/EUR.
              Не меняет settings.baseCurrency; только пересчитывает
              эквиваленты в шапке/блоках балансов. */}
          <SegmentedControl
            options={DISPLAY_OPTIONS.map((c) => ({ id: c, name: c }))}
            value={displayBase}
            onChange={setDisplayBase}
            size="sm"
          />
        </div>
      </div>

      <ObligationsModal open={obligationsOpen} onClose={() => setObligationsOpen(false)} />

      {/* Unified container */}
      <div className="w-full bg-white rounded-[14px] border border-slate-200/70 p-4 md:p-5">
        {officesToRender.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-slate-400">No active offices</div>
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
                  base={base}
                  globalCryptoTotal={globalCrypto.total}
                  globalCryptoDelta={globalCrypto.delta}
                  globalCryptoDeltaYesterday={globalCrypto.deltaYesterday}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ------- Header summary badge -------

function SummaryBadge({
  label,
  value,
  sym,
  tone,
  icon: Icon,
  emphasize,
  delta,
  deltaYesterday,
  deltaCurrency,
}) {
  const tones = {
    slate: "text-slate-700",
    amber: "text-amber-700 bg-amber-50",
    emerald: emphasize ? "text-emerald-700 bg-emerald-50" : "text-emerald-700",
  };
  const showDelta = delta != null && deltaCurrency;
  return (
    <div className={`flex flex-col items-start rounded-md px-2.5 py-1 ${tones[tone]}`}>
      <div className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider opacity-75">
        {Icon && <Icon className="w-2.5 h-2.5" />}
        {label}
      </div>
      <div className="inline-flex items-baseline gap-2">
        <div className={`tabular-nums ${emphasize ? "text-[15px] font-bold" : "text-[13px] font-semibold"}`}>
          {sym}
          {fmt(value)}
        </div>
        {showDelta && (
          <DeltaPair
            today={delta}
            yesterday={deltaYesterday}
            currency={deltaCurrency}
            size="xs"
          />
        )}
      </div>
    </div>
  );
}
