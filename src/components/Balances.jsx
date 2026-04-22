// src/components/Balances.jsx
// Read-only отображение балансов по офису.
//
// Источник данных — ТОЛЬКО useAccounts().accounts + balanceOf().
// Reserved для pending берётся из transactions[] (computed useMemo).
// balanceOf() НЕ знает про pending — это чисто визуальный слой.
//
// Для каждой позиции показываем:
//   Actual = balanceOf(id)                     (реальный факт из movements)
//   Reserved = Σ outputs pending транзакций    (чисто отображение)
//   Available = Actual − Reserved              (derived)

import React, { useMemo } from "react";
import { Wallet, Layers, Banknote, Coins, Building2, Clock } from "lucide-react";
import SegmentedControl from "./ui/SegmentedControl.jsx";
import { officeName } from "../store/data.js";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";

const NETWORK_RX = /\b(TRC20|ERC20|BEP20)\b/i;

function detectNetwork(accountName) {
  if (!accountName) return "Network";
  const m = accountName.match(NETWORK_RX);
  return m ? m[1].toUpperCase() : "Network";
}

// --- Pure grouping helper ---
// Использует balanceOf (total) и reservedOf (reserved) прямо из accounts store.
function groupBalances(accounts, balanceFn, reservedFn, toBaseFn, currencyDict) {
  const fiat = {
    cash: new Map(),
    bank: new Map(),
  };
  const cryptoMap = new Map();
  let totalActualInBase = 0;
  let totalReservedInBase = 0;

  accounts.forEach((a) => {
    if (!a.active) return;
    const actual = balanceFn(a.id);
    const reserved = reservedFn(a.id);
    totalActualInBase += toBaseFn(actual, a.currency);
    totalReservedInBase += toBaseFn(reserved, a.currency);

    const meta = currencyDict[a.currency];
    const isCrypto = meta?.type === "crypto";

    if (isCrypto) {
      if (!cryptoMap.has(a.currency)) cryptoMap.set(a.currency, new Map());
      const nw = detectNetwork(a.name);
      const inner = cryptoMap.get(a.currency);
      const prev = inner.get(nw) || { actual: 0, reserved: 0 };
      inner.set(nw, { actual: prev.actual + actual, reserved: prev.reserved + reserved });
    } else {
      const bucket = a.type === "cash" ? fiat.cash : fiat.bank;
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
      .sort((a, b) => (b.actual || 0) - (a.actual || 0));

  const crypto = [...cryptoMap.entries()].map(([currency, networks]) => ({
    currency,
    networks: [...networks.entries()]
      .map(([network, v]) => ({
        network,
        actual: v.actual,
        reserved: v.reserved,
        available: v.actual - v.reserved,
      }))
      .sort((a, b) => (b.actual || 0) - (a.actual || 0)),
  }));

  return {
    fiat: {
      cash: toRows(fiat.cash),
      bank: toRows(fiat.bank),
    },
    crypto,
    totalActualInBase,
    totalReservedInBase,
    totalAvailableInBase: totalActualInBase - totalReservedInBase,
  };
}

// --- Sub-components ---

// Строка показывает actual + (если есть reserved) reserved/available
function MetricRow({ label, actual, reserved, available, currency, dim }) {
  const hasReserved = reserved > 0;
  return (
    <div className={dim ? "opacity-90" : ""}>
      <div className="flex items-baseline justify-between">
        {label && (
          <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
            {label}
          </span>
        )}
        <span className="text-[15px] font-semibold tabular-nums tracking-tight text-slate-900">
          <span className="text-slate-400 text-[12px] font-medium mr-0.5">
            {curSymbol(currency)}
          </span>
          {fmt(hasReserved ? available : actual, currency)}
        </span>
      </div>
      {hasReserved && (
        <div className="mt-0.5 flex items-baseline justify-between text-[10px] tabular-nums">
          <span className="text-slate-400">actual {fmt(actual, currency)}</span>
          <span className="inline-flex items-center gap-0.5 text-amber-700 font-semibold">
            <Clock className="w-2.5 h-2.5" />
            −{fmt(reserved, currency)}
          </span>
        </div>
      )}
    </div>
  );
}

function CurrencyCard({ row }) {
  return (
    <div className="h-full bg-white border border-slate-200/70 rounded-[10px] px-3 py-2.5 hover:border-slate-300 transition-colors min-w-0 flex flex-col justify-between gap-1">
      <div className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
        {row.currency}
      </div>
      <MetricRow
        actual={row.actual}
        reserved={row.reserved}
        available={row.available}
        currency={row.currency}
      />
    </div>
  );
}

function FiatSection({ title, rows, icon: Icon }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3 text-slate-400" />
        <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
          {title}
        </span>
      </div>
      <div
        className="grid gap-2 items-stretch"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        }}
      >
        {rows.map((r) => (
          <CurrencyCard key={`${title}-${r.currency}`} row={r} />
        ))}
      </div>
    </div>
  );
}

function CryptoCurrencyBlock({ currency, networks }) {
  const totalActual = networks.reduce((s, n) => s + n.actual, 0);
  const totalReserved = networks.reduce((s, n) => s + n.reserved, 0);
  const totalAvailable = totalActual - totalReserved;
  return (
    <div className="h-full bg-white border border-slate-200/70 rounded-[10px] p-3 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-slate-500 tracking-[0.15em] uppercase">
          {currency}
        </span>
        <span className="text-[13px] font-bold tabular-nums tracking-tight text-slate-900">
          <span className="text-slate-400 text-[11px] font-medium mr-0.5">
            {curSymbol(currency)}
          </span>
          {fmt(totalReserved > 0 ? totalAvailable : totalActual, currency)}
        </span>
      </div>
      {totalReserved > 0 && (
        <div className="mb-2 flex items-center justify-between text-[10px] tabular-nums">
          <span className="text-slate-400">actual {fmt(totalActual, currency)}</span>
          <span className="inline-flex items-center gap-0.5 text-amber-700 font-semibold">
            <Clock className="w-2.5 h-2.5" />
            −{fmt(totalReserved, currency)}
          </span>
        </div>
      )}
      <div className="space-y-1">
        {networks.map((n) => (
          <div
            key={n.network}
            className="flex items-center justify-between text-[12px] px-2 py-1 bg-slate-50/60 rounded-[6px] border border-slate-100"
          >
            <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-indigo-50 text-indigo-700 tracking-wide">
                {n.network}
              </span>
              {n.reserved > 0 && (
                <span className="text-[9px] font-semibold text-amber-700">
                  ({fmt(n.reserved, currency)} pending)
                </span>
              )}
            </span>
            <span className="tabular-nums font-semibold text-slate-800">
              {fmt(n.reserved > 0 ? n.available : n.actual, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main component ---

export default function Balances({ currentOffice, scope, onScopeChange }) {
  const { t } = useTranslation();
  const { accounts, balanceOf, reservedOf } = useAccounts();
  const { activeOffices, findOffice } = useOffices();
  const { dict: currencyDict } = useCurrencies();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const scopedAccounts = useMemo(() => {
    if (scope === "all") return accounts;
    return accounts.filter((a) => a.officeId === currentOffice);
  }, [accounts, scope, currentOffice]);

  const grouped = useMemo(
    () => groupBalances(scopedAccounts, balanceOf, reservedOf, toBase, currencyDict),
    [scopedAccounts, balanceOf, reservedOf, toBase, currencyDict]
  );

  const { fiat, crypto, totalActualInBase, totalReservedInBase, totalAvailableInBase } = grouped;
  const hasFiat = fiat.cash.length > 0 || fiat.bank.length > 0;
  const hasCrypto = crypto.length > 0;
  const hasReserved = totalReservedInBase > 0;
  const isEmpty = !hasFiat && !hasCrypto;

  return (
    <section>
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
                {findOffice(currentOffice)?.name || officeName(currentOffice)}
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
              {hasReserved ? `Available (${base})` : `Total (${base})`}
            </div>
            <div className="text-[15px] font-bold tabular-nums tracking-tight text-slate-900">
              {sym}
              {fmt(hasReserved ? totalAvailableInBase : totalActualInBase, base)}
            </div>
            {hasReserved && (
              <div className="text-[10px] tabular-nums text-slate-500 mt-0.5">
                actual {sym}
                {fmt(totalActualInBase, base)}{" "}
                <span className="text-amber-700 font-semibold">
                  · −{sym}
                  {fmt(totalReservedInBase, base)} pending
                </span>
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

      {isEmpty ? (
        <div className="bg-white rounded-[12px] border border-slate-200/70 py-10 text-center text-[13px] text-slate-400">
          No active accounts
        </div>
      ) : (
        <div className="bg-white rounded-[12px] border border-slate-200/70 p-4 space-y-4">
          {hasFiat && (
            <div className="space-y-3">
              <FiatSection title="Cash" rows={fiat.cash} icon={Banknote} />
              <FiatSection title="Bank" rows={fiat.bank} icon={Building2} />
            </div>
          )}

          {hasFiat && hasCrypto && <div className="border-t border-dashed border-slate-200" />}

          {hasCrypto && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Coins className="w-3 h-3 text-slate-400" />
                <span className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase">
                  Crypto
                </span>
              </div>
              <div
                className="grid gap-2 items-stretch"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                }}
              >
                {crypto.map((c) => (
                  <CryptoCurrencyBlock
                    key={c.currency}
                    currency={c.currency}
                    networks={c.networks}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
