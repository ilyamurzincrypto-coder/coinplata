// src/pages/treasury_v2/parts/CounterpartyGroup.jsx
//
// Group для одного контрагента в Treasury → Пассивы (counterparty-режим).
// Зеркало строки Office в AssetsTab — те же 3 уровня:
//   Контрагент → Валюта → Source ledger.account.
//
// Цветовая логика балансов идентична AssetsTab + LiabilitiesTab legacy:
//   balance > 0 → мы должны контрагенту → text-success «+» (он держит у нас)
//   balance < 0 → контрагент должен нам → text-danger «−» (overdraft)
// (то же что в LegRow.clientBalanceInCurrency в legacy v2 DealForm)

import React, { useState } from "react";
import { ChevronRight, ChevronDown, Star } from "lucide-react";
import { fmt, curSymbol } from "../../../utils/money.js";
import Avatar from "../../../components/ui/Avatar.jsx";

function fmtCompact(value) {
  const v = Math.abs(Number(value) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`.replace(/\.0M$/, "M");
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`.replace(/\.0k$/, "k");
  return `${Math.round(v)}`;
}

export default function CounterpartyGroup({ cp, formatBase, baseCurrency, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isCredit = cp.totalInBase > 0;     // мы должны контрагенту
  const isDebit  = cp.totalInBase < 0;     // контрагент должен нам
  const toneCls = isDebit ? "text-danger" : isCredit ? "text-success" : "text-ink";
  const signStr = isDebit ? "−" : isCredit ? "+" : "";

  return (
    <div className="border-t border-border-soft first:border-t-0">
      {/* Level 1 — counterparty header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-[16px_32px_1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-surface-soft transition-colors text-left bg-surface-soft/40"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
          : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
        <Avatar name={cp.name} size={28} />
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 truncate">
            <span className="text-body-sm font-semibold text-ink truncate">{cp.name}</span>
            {cp.isReferral && (
              <span className="inline-flex items-center gap-0.5 text-tiny text-warning font-semibold shrink-0">
                <Star className="w-2.5 h-2.5 fill-current" strokeWidth={0} />
                Реферал
              </span>
            )}
            {cp.kind === "partner" && (
              <span className="inline-flex items-center h-4 px-1.5 rounded font-mono text-[9px] font-bold bg-info-soft text-info uppercase tracking-wider shrink-0">
                OTC
              </span>
            )}
          </div>
          {cp.telegram && (
            <span className="text-tiny text-muted font-mono truncate">{cp.telegram}</span>
          )}
        </div>
        <div className="text-right shrink-0 flex flex-col items-end leading-tight">
          <span className={`text-body-sm font-mono tabular font-bold ${toneCls}`}>
            {signStr}{formatBase ? formatBase(Math.abs(cp.totalInBase), baseCurrency) : `$${fmtCompact(cp.totalInBase)}`}
          </span>
          <span className="text-tiny text-muted-soft">
            {cp.byCurrency.length} {cp.byCurrency.length === 1 ? "валюта" : "валют"}
          </span>
        </div>
      </button>

      {/* Level 2 — currencies */}
      {expanded && cp.byCurrency.map((cur) => (
        <CurrencyRow
          key={cur.currency}
          cur={cur}
          formatBase={formatBase}
          baseCurrency={baseCurrency}
        />
      ))}
    </div>
  );
}

function CurrencyRow({ cur, formatBase, baseCurrency }) {
  const [expanded, setExpanded] = useState(false);
  const isCredit = cur.balance > 0;
  const isDebit  = cur.balance < 0;
  const toneCls = isDebit ? "text-danger" : isCredit ? "text-success" : "text-ink";
  const signStr = isDebit ? "−" : isCredit ? "+" : "";
  const isBase = cur.currency === baseCurrency;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-[16px_1fr_auto] items-center gap-2 pl-12 pr-4 py-2 hover:bg-surface-soft transition-colors text-left border-t border-border-soft"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />}
        <span className="text-caption font-semibold text-ink-soft tracking-wider">
          {cur.currency}
        </span>
        <div className="text-right shrink-0 flex items-baseline gap-2">
          <span className={`text-body-sm font-mono tabular font-semibold ${toneCls}`}>
            {signStr}{curSymbol(cur.currency)}{fmt(Math.abs(cur.balance), cur.currency)}
          </span>
          {!isBase && formatBase && (
            <span className="text-tiny text-muted-soft font-mono tabular">
              (≈ {formatBase(Math.abs(cur.balanceInBase), baseCurrency)})
            </span>
          )}
        </div>
      </button>

      {/* Level 3 — source ledger accounts */}
      {expanded && cur.sourceAccounts.map((acc, i) => (
        <div
          key={`${acc.accountId}-${i}`}
          className="grid grid-cols-[1fr_auto] items-baseline gap-2 pl-20 pr-4 py-1.5 border-t border-border-soft bg-surface-soft/30"
        >
          <div className="text-tiny text-muted inline-flex items-baseline gap-1.5 truncate">
            <span className="font-mono text-muted-soft">{acc.code}</span>
            <span className="text-muted-soft">·</span>
            <span className="truncate">{acc.name}</span>
          </div>
          <span className={`text-tiny font-mono tabular ${acc.balance < 0 ? "text-danger" : "text-success"}`}>
            {acc.balance < 0 ? "−" : "+"}{curSymbol(cur.currency)}{fmt(Math.abs(acc.balance), cur.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
