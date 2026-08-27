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
        // Пилюля вместо прямоугольника: единственный неокруглённый контрол на
        // экране Казначейства. Размеры и плотность те же — меняется радиус и
        // тон рамки.
        className="bg-surface-soft border border-line-2 focus:bg-white focus:border-ink focus:ring-2 focus:ring-ink/15 rounded-full px-3.5 py-1.5 text-body-sm outline-none"
      >
        <option value="all">{t("trv2_office_all")}</option>
        {(activeOffices || []).map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
