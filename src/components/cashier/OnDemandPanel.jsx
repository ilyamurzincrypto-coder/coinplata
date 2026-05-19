// src/components/cashier/OnDemandPanel.jsx
// On-demand chips через "+ Add". При клике chip → expand inline editor.
// Auto-expand TX hash если есть IN-leg с currency=USDT/USDC и source=fresh.

import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Clock, MessageSquare, Hash, X } from "lucide-react";
import ChipPill from "./ChipPill.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

const FIELDS = [
  { key: "backdate", icon: Calendar, type: "datetime-local", label: "ondemand_backdate" },
  { key: "scheduled_at", icon: Clock, type: "datetime-local", label: "ondemand_scheduled" },
  { key: "comment", icon: MessageSquare, type: "textarea", label: "ondemand_comment" },
  { key: "tx_hash", icon: Hash, type: "text", label: "ondemand_tx_hash" },
];

const CRYPTO_CURS = new Set(["USDT", "USDC", "BTC", "ETH"]);

export default function OnDemandPanel({ onDemand, setOnDemand, legs = [] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState({});

  // Auto-expand TX hash для crypto IN.fresh
  const cryptoFresh = useMemo(
    () => legs.some(
      (l) =>
        l.side === "in" &&
        l.source === "fresh" &&
        CRYPTO_CURS.has((l.currency || "").toUpperCase())
    ),
    [legs]
  );

  useEffect(() => {
    if (cryptoFresh) {
      setExpanded((prev) => (prev.tx_hash ? prev : { ...prev, tx_hash: true }));
    }
  }, [cryptoFresh]);

  const toggle = (key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleClear = (key) => {
    setOnDemand(key, null);
    setExpanded((prev) => ({ ...prev, [key]: false }));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-soft uppercase tracking-wider mr-1">
          {t("conditions_ondemand_add")}
        </span>
        {FIELDS.map((f) => {
          const Icon = f.icon;
          const filled = onDemand[f.key] != null && onDemand[f.key] !== "";
          const isExpanded = expanded[f.key];
          return (
            <ChipPill
              key={f.key}
              active={filled || isExpanded}
              onClick={() => toggle(f.key)}
              showCheck={false}
              title={t(`conditions_${f.label}`)}
            >
              <span className="inline-flex items-center gap-1">
                <Icon className="w-3 h-3" />
                {t(`conditions_${f.label}`)}
                {filled && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-accent" />}
              </span>
            </ChipPill>
          );
        })}
      </div>

      {/* Inline editors */}
      {FIELDS.map((f) => {
        if (!expanded[f.key]) return null;
        const value = onDemand[f.key] || "";
        return (
          <div key={f.key} className="flex items-start gap-2 ml-1">
            <span className="text-[11px] text-muted uppercase tracking-wider mt-2 w-24 shrink-0">
              {t(`conditions_${f.label}`)}:
            </span>
            {f.type === "textarea" ? (
              <textarea
                value={value}
                onChange={(e) => setOnDemand(f.key, e.target.value || null)}
                rows={2}
                className="flex-1 bg-white border border-border-soft focus:border-accent rounded-[var(--radius-cell)] px-2 py-1 text-[12px] outline-none resize-none"
              />
            ) : (
              <input
                type={f.type}
                value={value}
                onChange={(e) => setOnDemand(f.key, e.target.value || null)}
                className="flex-1 bg-white border border-border-soft focus:border-accent rounded-[var(--radius-cell)] px-2 py-1.5 text-[12px] font-mono outline-none"
                placeholder={f.key === "tx_hash" ? "0x..." : ""}
              />
            )}
            <button
              type="button"
              onClick={() => handleClear(f.key)}
              title="Clear"
              className="p-1 mt-0.5 text-muted-soft hover:text-ink-soft"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
