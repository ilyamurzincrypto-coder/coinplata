// src/pages/treasury_v2/parts/AccountRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";
import AccountSubcontoRow from "./AccountSubcontoRow.jsx";
import InlineBalanceEditor from "./InlineBalanceEditor.jsx";

// `displayMul` — display-sign multiplier for the shown balances (1 by default; −1 for
// liability accounts so an obligation reads as a negative number). Presentation only —
// the underlying ledger figures (`account.balance` / `account.balanceInBase` / `dims`) are
// untouched; the multiplier is applied at render and passed down to subconto rows.
export default function AccountRow({ account, ctx, formatBase, baseCurrency, onOpenTx, displayMul = 1 }) {
  const [expanded, setExpanded] = useState(false);
  const dims = account.dims; // null for a plain account; array for a dimensioned one
  return (
    <>
      <div
        className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50 border-t border-slate-100"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="font-mono text-[11px] text-slate-400 w-12">{account.code}</span>
        <span className="flex-1 text-[12.5px] font-medium text-slate-900 truncate">{account.name}</span>
        <span className="text-[12px] text-slate-500 tabular-nums w-32 text-right">
          {/* Если у юзера нет accounting:edit и счёт — субконто-агрегат
              (dims != null), редактор всё равно деградирует в read-only;
              для dimensioned счетов inline-edit на родителе блокируем
              (там надо выбирать клиента/партнёра — отдельная итерация). */}
          {dims ? (
            <>
              {(Number(account.balance) * displayMul).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              {account.currency}
            </>
          ) : (
            <InlineBalanceEditor
              account={account}
              displayMul={displayMul}
              accounts={ctx?.accounts || []}
              suffix={account.currency}
            />
          )}
        </span>
        <span className="text-[12.5px] font-semibold tabular-nums w-28 text-right">{formatBase(account.balanceInBase * displayMul, baseCurrency)}</span>
      </div>
      {expanded && (dims
        ? (dims.length === 0
            ? <div className="pl-9 pr-4 py-2 text-[11px] text-slate-400">—</div>
            : dims.map((d, i) => (
                <AccountSubcontoRow
                  key={`${d.clientId || ""}-${d.partnerId || ""}-${i}`}
                  ctx={ctx}
                  accountId={account.accountId}
                  dim={d}
                  formatBase={formatBase}
                  baseCurrency={baseCurrency}
                  onOpenTx={onOpenTx}
                  displayMul={displayMul}
                />
              )))
        : <AccountInlineEntries ctx={ctx} accountId={account.accountId} onOpenTx={onOpenTx} />)}
    </>
  );
}
