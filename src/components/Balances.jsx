// src/components/Balances.jsx
// Dashboard balances — единый контейнер, grid Cash / Bank / Crypto.
// Three-metric model:
//   TOTAL     = balanceOf (фактические деньги — уже физически тут)
//   RESERVED  = reservedOf (pending OUT — "занято" под отложенные сделки)
//   AVAILABLE = balanceOf − reservedOf (что реально можно потратить)
//
// Data sources — только accounts store.
// Pending сделки пишут movements с reserved:true — это меняет reservedOf автоматически.

import React, { useMemo } from "react";
import { Wallet, Banknote, Building2, Coins, Clock, Layers, CheckCircle2 } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";

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

function CurrencyRow({ row }) {
  const hasReserved = row.reserved > 0;
  return (
    <div className="bg-white border border-slate-200/80 rounded-[8px] px-2.5 py-2">
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <span className="text-[11px] font-bold text-slate-700 tracking-wider">
          {row.currency}
        </span>
        <span className="text-[13px] font-semibold tabular-nums tracking-tight text-slate-900">
          <span className="text-slate-400 text-[10px] font-medium mr-0.5">
            {curSymbol(row.currency)}
          </span>
          {fmt(row.total, row.currency)}
        </span>
      </div>
      {hasReserved ? (
        <div className="grid grid-cols-2 gap-1 text-[10px] tabular-nums">
          <div className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 rounded-md px-1.5 py-0.5">
            <Clock className="w-2.5 h-2.5 shrink-0" />
            <span className="font-semibold truncate">{fmt(row.reserved, row.currency)}</span>
          </div>
          <div className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 rounded-md px-1.5 py-0.5 justify-end">
            <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
            <span className="font-semibold truncate">{fmt(row.available, row.currency)}</span>
          </div>
        </div>
      ) : (
        <div className="text-[10px] tabular-nums text-emerald-700 inline-flex items-center gap-1 bg-emerald-50 rounded-md px-1.5 py-0.5">
          <CheckCircle2 className="w-2.5 h-2.5" />
          <span className="font-semibold">available {fmt(row.available, row.currency)}</span>
        </div>
      )}
    </div>
  );
}

// ------- Cash / Bank card -------

function GroupCard({ title, icon: Icon, iconClass, rows, emptyText }) {
  return (
    <div className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className={`w-3.5 h-3.5 ${iconClass || "text-slate-400"}`} />
        <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-slate-400 tabular-nums">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic py-2">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <CurrencyRow key={r.currency} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------- Crypto card (валюта → сети) -------

function CryptoCard({ rows, emptyText }) {
  return (
    <div className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-3">
        <Coins className="w-3.5 h-3.5 text-indigo-500" />
        <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
          Crypto
        </span>
        <span className="ml-auto text-[10px] text-slate-400 tabular-nums">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic py-2">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => {
            const total = c.networks.reduce((s, n) => s + n.total, 0);
            const reserved = c.networks.reduce((s, n) => s + n.reserved, 0);
            const available = total - reserved;
            const hasReserved = reserved > 0;
            return (
              <div key={c.currency} className="bg-white border border-slate-200/80 rounded-[8px] p-2.5">
                <div className="flex items-baseline justify-between mb-1 gap-2">
                  <span className="text-[11px] font-bold text-slate-700 tracking-wider">
                    {c.currency}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums tracking-tight text-slate-900">
                    <span className="text-slate-400 text-[10px] font-medium mr-0.5">
                      {curSymbol(c.currency)}
                    </span>
                    {fmt(total, c.currency)}
                  </span>
                </div>
                {hasReserved && (
                  <div className="grid grid-cols-2 gap-1 text-[10px] tabular-nums mb-1">
                    <div className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 rounded-md px-1.5 py-0.5">
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      <span className="font-semibold truncate">{fmt(reserved, c.currency)}</span>
                    </div>
                    <div className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 rounded-md px-1.5 py-0.5 justify-end">
                      <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                      <span className="font-semibold truncate">{fmt(available, c.currency)}</span>
                    </div>
                  </div>
                )}
                <div className="space-y-1 mt-1 pt-1 border-t border-slate-100">
                  {c.networks.map((n) => (
                    <div
                      key={n.network}
                      className="flex items-center justify-between text-[11px] px-1.5 py-0.5"
                    >
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-indigo-50 text-indigo-700">
                        {n.network}
                      </span>
                      <div className="flex items-center gap-1.5 tabular-nums">
                        {n.reserved > 0 && (
                          <span className="text-[9px] text-amber-700 font-semibold">
                            −{fmt(n.reserved, c.currency)}
                          </span>
                        )}
                        <span className="font-semibold text-slate-700">
                          {fmt(n.total, c.currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

      {/* 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GroupCard title="Cash" icon={Banknote} iconClass="text-emerald-500" rows={grouped.cash} emptyText="No cash accounts" />
        <GroupCard title="Bank" icon={Building2} iconClass="text-sky-500" rows={grouped.bank} emptyText="No bank accounts" />
        <CryptoCard rows={grouped.crypto} emptyText="No crypto accounts" />
      </div>
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

  const officesToRender = useMemo(() => {
    if (scope === "all") return activeOffices;
    const o = findOffice(currentOffice);
    return o ? [o] : [];
  }, [scope, activeOffices, currentOffice, findOffice]);

  // Grand totals
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
    return { total, reserved, available: total - reserved, hasReserved: reserved > 0 };
  }, [accounts, scope, currentOffice, balanceOf, reservedOf, toBase]);

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
