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
    <div className="text-caption">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-muted hover:text-ink-soft"
      >
        {open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>
          {address ? (
            <span className="text-ink-soft font-mono text-tiny">
              {address.slice(0, 8)}…{address.slice(-6)}{network ? ` · ${network}` : ""}
            </span>
          ) : (
            <span className="text-muted-soft">+ адрес кошелька</span>
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
            className="flex-1 bg-surface-soft border border-border-soft focus:border-accent rounded-[var(--radius-cell)] px-2 py-1 text-caption font-mono outline-none"
          />
          <select
            value={network || ""}
            onChange={(e) => onNetworkChange(e.target.value || null)}
            className="bg-surface-soft border border-border-soft focus:border-accent rounded-[var(--radius-cell)] px-2 py-1 text-caption outline-none"
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
