// src/pages/treasury_v2/parts/AccountRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";

export default function AccountRow({ account, ctx, formatBase, baseCurrency, onOpenTx }) {
  const [expanded, setExpanded] = useState(false);
  const dimLabel = account.clientId ? ` · client ${account.clientId.slice(0, 8)}` : account.partnerId ? ` · partner ${account.partnerId.slice(0, 8)}` : "";
  return (
    <>
      <div
        className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50 border-t border-slate-100"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="font-mono text-[11px] text-slate-400 w-12">{account.code}</span>
        <span className="flex-1 text-[12.5px] font-medium text-slate-900 truncate">{account.name}{dimLabel}</span>
        <span className="text-[12px] text-slate-500 tabular-nums w-32 text-right">
          {Number(account.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {account.currency}
        </span>
        <span className="text-[12.5px] font-semibold tabular-nums w-28 text-right">{formatBase(account.balanceInBase, baseCurrency)}</span>
      </div>
      {expanded && <AccountInlineEntries ctx={ctx} accountId={account.accountId} onOpenTx={onOpenTx} />}
    </>
  );
}
