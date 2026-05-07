// src/components/cashier/CounterpartyBar.jsx
// Один компактный input с placeholder «Клиент / партнёр… *».
// Required-state выражается через красный bottom-border при пустом submit.
// НЕ отдельный label-row, НЕ красная плашка «required».

import React from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import CounterpartySelect from "../CounterpartySelect.jsx";

export default function CounterpartyBar({
  value,                          // counterparty nickname (string)
  onChange,                        // (nickname) => void — string для CounterpartySelect API
  showRequiredError = false,       // true → красный bottom-border
}) {
  const { t } = useTranslation();
  // Префикс «Клиент» (text-label) + сам пикер. Required-state выражается
  // через rose bottom-border на контейнере при пустом submit.
  return (
    <div
      className={`px-4 flex items-center gap-3 border-b transition-colors ${
        showRequiredError ? "border-rose-500" : "border-slate-200/70"
      }`}
      style={{ paddingTop: "var(--space-2)", paddingBottom: "var(--space-2)" }}
    >
      <span className="text-label shrink-0" title={t("cashier_counterparty_placeholder")}>
        {t("counterparty") || "Counterparty"}
      </span>
      <div className="flex-1 min-w-0">
        <CounterpartySelect value={value} onChange={onChange} />
      </div>
    </div>
  );
}
