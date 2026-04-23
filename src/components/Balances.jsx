// src/components/Balances.jsx
// Dashboard balances — единый контейнер, grid Cash / Bank / Crypto.
// Three-metric model:
//   TOTAL     = balanceOf (фактические деньги — уже физически тут)
//   RESERVED  = reservedOf (pending OUT — "занято" под отложенные сделки)
//   AVAILABLE = balanceOf − reservedOf (что реально можно потратить)
//
// Data sources — только accounts store.
// Pending сделки пишут movements с reserved:true — это меняет reservedOf автоматически.

import React, { useMemo, useState } from "react";
import { Wallet, Banknote, Building2, Coins, Clock, Layers, CheckCircle2, Lock } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useObligations } from "../store/obligations.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import ObligationsModal from "./ObligationsModal.jsx";

const NETWORK_RX = /\b(TRC20|ERC20|BEP20)\b/i;
const detectNetwork = (name) => {
  if (!name) return "Network";
  const m = name.match(NETWORK_RX);
  return m ? m[1].toUpperCase() : "Network";
};

// ------- Pure group helper -------
// Office accounts → { cash, bank, crypto } с тремя метриками на каждой позиции
function groupOfficeAccounts(accounts, balanceOf, reservedOf, currencyDict) {
  const cashMap = new Map();
  const bankMap = new Map();
  const cryptoMap = new Map(); // currency → Map<network, {total, reserved}>

  accounts.forEach((a) => {
    if (!a.active) return;
    const total = balanceOf(a.id);
    const reserved = reservedOf(a.id);

    const meta = currencyDict[a.currency];
    const isCrypto = meta?.type === "crypto";

    if (isCrypto) {
      if (!cryptoMap.has(a.currency)) cryptoMap.set(a.currency, new Map());
      const nw = detectNetwork(a.name);
      const inner = cryptoMap.get(a.currency);
      const prev = inner.get(nw) || { total: 0, reserved: 0 };
      inner.set(nw, { total: prev.total + total, reserved: prev.reserved + reserved });
    } else {
      const bucket = a.type === "cash" ? cashMap : bankMap;
      const prev = bucket.get(a.currency) || { total: 0, reserved: 0 };
      bucket.set(a.currency, { total: prev.total + total, reserved: prev.reserved + reserved });
    }
  });

  const toRows = (m) =>
    [...m.entries()]
      .map(([currency, v]) => ({
        currency,
        total: v.total,
        reserved: v.reserved,
        available: v.total - v.reserved,
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
      }))
      .sort((a, b) => b.total - a.total),
  }));

  return { cash: toRows(cashMap), bank: toRows(bankMap), crypto };
}

// ------- UI: one currency row (Total / Reserved / Available) -------

// Строго: name слева, сумма справа, available-зеленый только если > 0 и без reserved.
function AssetRow({ name, subtitle, amount, currency, reserved }) {
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
        <div className="text-[13px] font-semibold tabular-nums text-slate-900">
          {curSymbol(currency)}{fmt(amount, currency)}
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
function GroupCard({ title, icon: Icon, rows, total, emptyText, currency }) {
  return (
    <div className="bg-white border border-slate-200 rounded-[14px] p-4 flex flex-col h-full min-h-[220px]">
      {/* Header: title */}
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[11px] font-bold text-slate-600 tracking-[0.15em] uppercase">
          {title}
        </span>
        <span className="ml-auto text-[10px] font-semibold text-slate-400 tabular-nums">
          {rows.length}
        </span>
      </div>

      {/* Total amount — one line, right-aligned via block */}
      <div className="mt-2 text-[24px] font-bold tabular-nums tracking-tight text-slate-900 leading-none">
        {curSymbol(currency)}{fmt(total, currency)}
        <span className="text-[12px] text-slate-400 font-medium ml-1.5">{currency}</span>
      </div>

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
      });
    });
  });
  return out;
}

// ------- Office block -------

function OfficeBlock({ office, accounts, balanceOf, reservedOf, currencyDict, toBase, base }) {
  const grouped = useMemo(
    () => groupOfficeAccounts(accounts, balanceOf, reservedOf, currencyDict),
    [accounts, balanceOf, reservedOf, currencyDict]
  );

  // Office totals в base currency
  const allAccs = accounts.filter((a) => a.active);
  const totals = useMemo(() => {
    let total = 0;
    let reserved = 0;
    allAccs.forEach((a) => {
      total += toBase(balanceOf(a.id), a.currency);
      reserved += toBase(reservedOf(a.id), a.currency);
    });
    return { total, reserved, available: total - reserved, hasReserved: reserved > 0 };
  }, [allAccs, balanceOf, reservedOf, toBase]);

  return (
    <div className="space-y-3">
      {/* Office header */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-500" />
          <h3 className="text-[14px] font-semibold text-slate-900">{office.name}</h3>
          <span className="text-[11px] text-slate-400">· {allAccs.length} accounts</span>
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

      {/* 3 равные колонки — стабильный layout независимо от количества валют.
          Каждая карточка скроллится внутри если активов много. */}
      {(() => {
        const cryptoRows = cryptoRowsFromGroups(grouped.crypto);
        // Totals per card в base (для заголовочной суммы).
        const cashTotalBase = grouped.cash.reduce((s, r) => s + toBase(r.total, r.currency), 0);
        const bankTotalBase = grouped.bank.reduce((s, r) => s + toBase(r.total, r.currency), 0);
        const cryptoTotalBase = cryptoRows.reduce((s, r) => s + toBase(r.total, r.currency), 0);
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <GroupCard
              title="Cash"
              icon={Banknote}
              rows={grouped.cash}
              total={cashTotalBase}
              currency={base}
              emptyText="No cash accounts"
            />
            <GroupCard
              title="Bank"
              icon={Building2}
              rows={grouped.bank}
              total={bankTotalBase}
              currency={base}
              emptyText="No bank accounts"
            />
            <GroupCard
              title="Crypto"
              icon={Coins}
              rows={cryptoRows}
              total={cryptoTotalBase}
              currency={base}
              emptyText="No crypto accounts"
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
  const { accounts, balanceOf, reservedOf } = useAccounts();
  const { activeOffices, findOffice } = useOffices();
  const { dict: currencyDict } = useCurrencies();
  const { base, toBase } = useBaseCurrency();
  const { obligations, openCount: openObligationsCount } = useObligations();
  const [obligationsOpen, setObligationsOpen] = useState(false);

  const officesToRender = useMemo(() => {
    if (scope === "all") return activeOffices;
    const o = findOffice(currentOffice);
    return o ? [o] : [];
  }, [scope, activeOffices, currentOffice, findOffice]);

  // Grand totals + obligations
  const grand = useMemo(() => {
    const relevant =
      scope === "all"
        ? accounts.filter((a) => a.active)
        : accounts.filter((a) => a.active && a.officeId === currentOffice);
    let total = 0;
    let reserved = 0;
    relevant.forEach((a) => {
      total += toBase(balanceOf(a.id), a.currency);
      reserved += toBase(reservedOf(a.id), a.currency);
    });
    // Obligations в scope — все open we_owe по relevant офисам в base.
    const officeIds = new Set(relevant.map((a) => a.officeId));
    const obligationsBase = obligations
      .filter((o) => o.status === "open" && o.direction === "we_owe" && officeIds.has(o.officeId))
      .reduce((s, o) => s + toBase(o.amount, o.currency), 0);
    return {
      total,
      reserved,
      obligations: obligationsBase,
      available: total - reserved - obligationsBase,
      hasReserved: reserved > 0,
      hasObligations: obligationsBase > 0,
    };
  }, [accounts, scope, currentOffice, balanceOf, reservedOf, toBase, obligations]);

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
          <div className="text-[13px] text-slate-600 font-medium flex items-center gap-2">
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
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tri-metric summary */}
          <div className="inline-flex gap-1 bg-white border border-slate-200 rounded-[10px] p-1">
            <SummaryBadge label="Total" value={grand.total} sym={sym} tone="slate" />
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
                  currencyDict={currencyDict}
                  toBase={toBase}
                  base={base}
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

function SummaryBadge({ label, value, sym, tone, icon: Icon, emphasize }) {
  const tones = {
    slate: "text-slate-700",
    amber: "text-amber-700 bg-amber-50",
    emerald: emphasize ? "text-emerald-700 bg-emerald-50" : "text-emerald-700",
  };
  return (
    <div className={`flex flex-col items-start rounded-md px-2.5 py-1 ${tones[tone]}`}>
      <div className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider opacity-75">
        {Icon && <Icon className="w-2.5 h-2.5" />}
        {label}
      </div>
      <div className={`tabular-nums ${emphasize ? "text-[15px] font-bold" : "text-[13px] font-semibold"}`}>
        {sym}
        {fmt(value)}
      </div>
    </div>
  );
}
