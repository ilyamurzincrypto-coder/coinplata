// src/pages/treasury_v2/parts/AccountSubcontoRow.jsx
// One subconto (client/partner) row under a dimensioned account in the balance tabs:
// resolved name + native balance + base balance, expandable to the dim-filtered journal entries.
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";

export default function AccountSubcontoRow({ ctx, accountId, dim, formatBase, baseCurrency, onOpenTx }) {
  const [expanded, setExpanded] = useState(false);
  const id = dim.clientId || dim.partnerId || null;
  const kind = dim.clientId ? "client" : dim.partnerId ? "partner" : "—";
  const name = ctx && ctx.counterpartyName ? ctx.counterpartyName(id) : (id ? String(id).slice(0, 8) : "—");
  const filter = dim.clientId ? { clientId: dim.clientId } : dim.partnerId ? { partnerId: dim.partnerId } : null;
  return (
    <>
      <div className="pl-9 pr-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-slate-100 border-t border-slate-100 bg-slate-50/50" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
        <span className="text-[10px] uppercase tracking-wider text-slate-400 w-12">{kind}</span>
        <span className="flex-1 text-[12px] text-slate-700 truncate">{name}</span>
        <span className="text-[11.5px] text-slate-500 tabular-nums w-32 text-right">{Number(dim.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <span className="text-[12px] font-medium tabular-nums w-28 text-right">{formatBase(dim.balanceInBase, baseCurrency)}</span>
      </div>
      {expanded && <AccountInlineEntries ctx={ctx} accountId={accountId} dim={filter} onOpenTx={onOpenTx} />}
    </>
  );
}
