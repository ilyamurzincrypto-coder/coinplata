// src/components/Balances.jsx
// Пересобран с нуля.
//
// Структура:
//   Section (header с total + segmented "selected / all")
//   ┌─ Container (один bg-white rounded border, занимает всю ширину)
//   │  ┌─ Office (если scope === "all" — несколько блоков, иначе один)
//   │  │  ├─ Header office: name + total
//   │  │  └─ 3 колонки grid-cols-3 (на mobile grid-cols-1):
//   │  │     ├─ CASH   — карточка со списком валют
//   │  │     ├─ BANK   — карточка со списком валют
//   │  │     └─ CRYPTO — карточка со списком currency → networks

import React, { useMemo } from "react";
import { Wallet, Banknote, Building2, Coins, Clock, Layers } from "lucide-react";
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
// office's accounts → { cash: [{currency, actual, reserved, available}], bank: [...], crypto: [{currency, networks: [...]}] }
function groupOfficeAccounts(accounts, balanceOf, reservedOf, currencyDict) {
  const cashMap = new Map();
  const bankMap = new Map();
  const cryptoMap = new Map(); // currency → Map<network, {actual, reserved}>

  accounts.forEach((a) => {
    if (!a.active) return;
    const actual = balanceOf(a.id);
    const reserved = reservedOf(a.id);

    const meta = currencyDict[a.currency];
    const isCrypto = meta?.type === "crypto";

    if (isCrypto) {
      if (!cryptoMap.has(a.currency)) cryptoMap.set(a.currency, new Map());
      const nw = detectNetwork(a.name);
      const inner = cryptoMap.get(a.currency);
      const prev = inner.get(nw) || { actual: 0, reserved: 0 };
      inner.set(nw, { actual: prev.actual + actual, reserved: prev.reserved + reserved });
    } else {
      const bucket = a.type === "cash" ? cashMap : bankMap;
      const prev = bucket.get(a.currency) || { actual: 0, reserved: 0 };
      bucket.set(a.currency, { actual: prev.actual + actual, reserved: prev.reserved + reserved });
    }
  });

  const toRows = (m) =>
    [...m.entries()]
      .map(([currency, v]) => ({
        currency,
        actual: v.actual,
        reserved: v.reserved,
        available: v.actual - v.reserved,
      }))
      .sort((a, b) => b.actual - a.actual);

  const crypto = [...cryptoMap.entries()].map(([currency, nwMap]) => ({
    currency,
    networks: [...nwMap.entries()]
      .map(([network, v]) => ({
        network,
        actual: v.actual,
        reserved: v.reserved,
        available: v.actual - v.reserved,
      }))
      .sort((a, b) => b.actual - a.actual),
  }));

  return {
    cash: toRows(cashMap),
    bank: toRows(bankMap),
    crypto,
  };
}

// ------- UI bits -------

function AmountLine({ row }) {
  const hasReserved = row.reserved > 0;
  const primary = hasReserved ? row.available : row.actual;
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-[11px] font-bold text-slate-500 tracking-wider uppercase shrink-0">
        {row.currency}
      </span>
      <div className="text-right min-w-0">
        <div className="text-[13px] font-semibold tabular-nums tracking-tight text-slate-900 truncate">
          <span className="text-slate-400 text-[10px] font-medium mr-0.5">
            {curSymbol(row.currency)}
          </span>
          {fmt(primary, row.currency)}
        </div>
        {hasReserved && (
          <div className="text-[10px] tabular-nums text-amber-700 font-semibold inline-flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />−{fmt(row.reserved, row.currency)}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupCard({ title, icon: Icon, iconClass, rows, emptyText }) {
  return (
    <div className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className={`w-3.5 h-3.5 ${iconClass || "text-slate-400"}`} />
        <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic py-2">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.currency}
              className="bg-white border border-slate-200/80 rounded-[8px] px-2.5 py-2"
            >
              <AmountLine row={r} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CryptoCard({ rows, emptyText }) {
  return (
    <div className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-3">
        <Coins className="w-3.5 h-3.5 text-indigo-500" />
        <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
          Crypto
        </span>
        <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic py-2">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => {
            const totalActual = c.networks.reduce((s, n) => s + n.actual, 0);
            const totalReserved = c.networks.reduce((s, n) => s + n.reserved, 0);
            const totalAvailable = totalActual - totalReserved;
            const hasReserved = totalReserved > 0;
            return (
              <div
                key={c.currency}
                className="bg-white border border-slate-200/80 rounded-[8px] p-2.5"
              >
                <div className="flex items-baseline justify-between mb-1.5 gap-2">
                  <span className="text-[11px] font-bold text-slate-700 tracking-wider">
                    {c.currency}
                  </span>
                  <div className="text-right">
                    <div className="text-[13px] font-bold tabular-nums tracking-tight text-slate-900">
                      <span className="text-slate-400 text-[10px] font-medium mr-0.5">
                        {curSymbol(c.currency)}
                      </span>
                      {fmt(hasReserved ? totalAvailable : totalActual, c.currency)}
                    </div>
                    {hasReserved && (
                      <div className="text-[10px] text-amber-700 font-semibold tabular-nums inline-flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />−{fmt(totalReserved, c.currency)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  {c.networks.map((n) => (
                    <div
                      key={n.network}
                      className="flex items-center justify-between text-[11px] px-1.5 py-0.5 bg-slate-50 rounded-[6px]"
                    >
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-indigo-50 text-indigo-700">
                        {n.network}
                      </span>
                      <span className="tabular-nums font-semibold text-slate-700">
                        {fmt(n.reserved > 0 ? n.available : n.actual, c.currency)}
                      </span>
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

function OfficeBlock({ office, accounts, balanceOf, reservedOf, currencyDict, toBase, base }) {
  const grouped = useMemo(
    () => groupOfficeAccounts(accounts, balanceOf, reservedOf, currencyDict),
    [accounts, balanceOf, reservedOf, currencyDict]
  );

  // Totals в base
  const allAccs = accounts.filter((a) => a.active);
  const totalActual = allAccs.reduce((s, a) => s + toBase(balanceOf(a.id), a.currency), 0);
  const totalReserved = allAccs.reduce((s, a) => s + toBase(reservedOf(a.id), a.currency), 0);
  const totalAvailable = totalActual - totalReserved;
  const hasReserved = totalReserved > 0;

  return (
    <div className="space-y-3">
      {/* Office header */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-500" />
          <h3 className="text-[14px] font-semibold text-slate-900">{office.name}</h3>
          <span className="text-[11px] text-slate-400">· {allAccs.length} accounts</span>
        </div>
        <div className="text-right tabular-nums">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {hasReserved ? `Available (${base})` : `Total (${base})`}
          </div>
          <div className="text-[14px] font-bold text-slate-900">
            {curSymbol(base)}
            {fmt(hasReserved ? totalAvailable : totalActual, base)}
          </div>
          {hasReserved && (
            <div className="text-[10px] text-amber-700 font-semibold inline-flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />−{curSymbol(base)}
              {fmt(totalReserved, base)}
            </div>
          )}
        </div>
      </div>

      {/* 3 groups grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GroupCard
          title="Cash"
          icon={Banknote}
          iconClass="text-emerald-500"
          rows={grouped.cash}
          emptyText="No cash accounts"
        />
        <GroupCard
          title="Bank"
          icon={Building2}
          iconClass="text-sky-500"
          rows={grouped.bank}
          emptyText="No bank accounts"
        />
        <CryptoCard rows={grouped.crypto} emptyText="No crypto accounts" />
      </div>
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

  // Grand total for section header
  const grand = useMemo(() => {
    const relevantAccs =
      scope === "all"
        ? accounts.filter((a) => a.active)
        : accounts.filter((a) => a.active && a.officeId === currentOffice);
    let totalActual = 0;
    let totalReserved = 0;
    relevantAccs.forEach((a) => {
      totalActual += toBase(balanceOf(a.id), a.currency);
      totalReserved += toBase(reservedOf(a.id), a.currency);
    });
    return {
      totalActual,
      totalReserved,
      totalAvailable: totalActual - totalReserved,
      hasReserved: totalReserved > 0,
    };
  }, [accounts, scope, currentOffice, balanceOf, reservedOf, toBase]);

  return (
    <section className="w-full">
      {/* Header */}
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
        <div className="flex items-center gap-3">
          <div className="bg-white border border-slate-200 rounded-[10px] px-3 py-1.5">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
              {grand.hasReserved ? `Available (${base})` : `Total (${base})`}
            </div>
            <div className="text-[15px] font-bold tabular-nums tracking-tight text-slate-900">
              {curSymbol(base)}
              {fmt(grand.hasReserved ? grand.totalAvailable : grand.totalActual, base)}
            </div>
            {grand.hasReserved && (
              <div className="text-[10px] tabular-nums text-amber-700 font-semibold mt-0.5">
                <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                −{curSymbol(base)}
                {fmt(grand.totalReserved, base)}
              </div>
            )}
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
          <div className="py-10 text-center text-[13px] text-slate-400">
            No active offices
          </div>
        ) : (
          <div className="space-y-6">
            {officesToRender.map((office) => {
              const officeAccs = accounts.filter(
                (a) => a.officeId === office.id && a.active
              );
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
