// src/pages/treasury_v2/parts/ClassSection.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";

// `displayMul` — display-sign multiplier (1 by default; −1 for liabilities, so the
// section total reads as a negative "we owe" figure). Affects presentation only.
export default function ClassSection({ labelKey, totalInBase, formatBase, baseCurrency, displayMul = 1, children }) {
  const { t } = useTranslation();
  return (
    <section className="bg-surface rounded-card overflow-hidden">
      <header className="px-card py-2.5 border-b border-border-soft flex items-center justify-between bg-surface-soft/40">
        <h3 className="text-h3 text-ink font-semibold">{t(labelKey)}</h3>
        <span className="text-body-sm font-mono tabular font-bold text-ink">{formatBase(totalInBase * displayMul, baseCurrency)}</span>
      </header>
      <div>{children}</div>
    </section>
  );
}
