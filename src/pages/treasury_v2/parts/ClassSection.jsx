// src/pages/treasury_v2/parts/ClassSection.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";

// `displayMul` — display-sign multiplier (1 by default; −1 for liabilities, so the
// section total reads as a negative "we owe" figure). Affects presentation only.
export default function ClassSection({ labelKey, totalInBase, formatBase, baseCurrency, displayMul = 1, children }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <h3 className="text-[13px] font-bold text-slate-900">{t(labelKey)}</h3>
        <span className="text-[13px] font-semibold tabular-nums">{formatBase(totalInBase * displayMul, baseCurrency)}</span>
      </header>
      <div>{children}</div>
    </section>
  );
}
