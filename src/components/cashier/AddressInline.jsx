// src/components/cashier/AddressInline.jsx
// Expandable wallet address row (только для crypto OUT legs).
// Chevron toggle expands inline editor под основной строкой.

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const NETWORKS = ["TRC20", "ERC20", "BEP20", "Polygon", "Solana"];

export default function AddressInline({
  address,
  network,
  onAddressChange,
  onNetworkChange,
  defaultExpanded = false,
}) {
  const [open, setOpen] = useState(defaultExpanded);

  return (
    <div className="text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700"
      >
        {open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>
          {address ? (
            <span className="text-slate-700 font-mono text-[11px]">
              {address.slice(0, 8)}…{address.slice(-6)}{network ? ` · ${network}` : ""}
            </span>
          ) : (
            <span className="text-slate-400">+ адрес кошелька</span>
          )}
        </span>
      </button>

      {open && (
        <div className="mt-1.5 ml-4 flex items-center gap-2">
          <input
            type="text"
            value={address || ""}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Адрес кошелька"
            className="flex-1 bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-[var(--radius-cell)] px-2 py-1 text-[12px] font-mono outline-none"
          />
          <select
            value={network || ""}
            onChange={(e) => onNetworkChange(e.target.value || null)}
            className="bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-[var(--radius-cell)] px-2 py-1 text-[12px] outline-none"
          >
            <option value="">— сеть —</option>
            {NETWORKS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
