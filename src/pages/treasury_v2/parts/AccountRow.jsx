// src/pages/treasury_v2/parts/AccountRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";
import AccountSubcontoRow from "./AccountSubcontoRow.jsx";

export default function AccountRow({ account, ctx, formatBase, baseCurrency, onOpenTx }) {
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
          {Number(account.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {account.currency}
        </span>
        <span className="text-[12.5px] font-semibold tabular-nums w-28 text-right">{formatBase(account.balanceInBase, baseCurrency)}</span>
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
                />
              )))
        : <AccountInlineEntries ctx={ctx} accountId={account.accountId} onOpenTx={onOpenTx} />)}
    </>
  );
}
