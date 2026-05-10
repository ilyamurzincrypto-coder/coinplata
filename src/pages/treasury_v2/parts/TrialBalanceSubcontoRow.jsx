// src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.jsx
// One subconto sub-row under a dimensioned account in the ОСВ: resolved name + the
// account's 4 period metrics for this client/partner; expandable to its dim-filtered entries.
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";

const num = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function TrialBalanceSubcontoRow({ ctx, accountId, dim, window: win, onOpenTx }) {
  const [open, setOpen] = useState(false);
  const id = dim.clientId || dim.partnerId || null;
  const kind = dim.clientId ? "client" : dim.partnerId ? "partner" : "—";
  const name = ctx && ctx.counterpartyName ? ctx.counterpartyName(id) : (id ? String(id).slice(0, 8) : "—");
  const filter = dim.clientId ? { clientId: dim.clientId } : dim.partnerId ? { partnerId: dim.partnerId } : null;
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-100/60 cursor-pointer bg-slate-50/50" onClick={() => setOpen((v) => !v)}>
        <td className="px-2 py-1.5 w-6 text-slate-400 pl-6">{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</td>
        <td className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 w-14">{kind}</td>
        <td className="px-2 py-1.5 text-[12px] text-slate-700">{name}</td>
        <td className="px-2 py-1.5 text-slate-400 w-12" />
        <td className="px-2 py-1.5 text-right tabular-nums w-28">{num(dim.opening)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-emerald-700">{num(dim.debitTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-rose-700">{num(dim.creditTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 font-medium">{num(dim.closing)}</td>
      </tr>
      {open && (
        <tr><td colSpan={8} className="p-0"><AccountInlineEntries ctx={ctx} accountId={accountId} period={win} dim={filter} onOpenTx={onOpenTx} /></td></tr>
      )}
    </>
  );
}
