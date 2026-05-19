// src/pages/treasury_v2/OfficePicker.jsx
import React from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useOffices } from "../../store/offices.jsx";

export default function OfficePicker({ value, onChange }) {
  const { t } = useTranslation();
  const { activeOffices } = useOffices();
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-tiny font-bold text-muted uppercase tracking-wider">{t("trv2_office_label")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-button px-2.5 py-1.5 text-body-sm outline-none"
      >
        <option value="all">{t("trv2_office_all")}</option>
        {(activeOffices || []).map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
