// src/pages/treasury_v2/tabs/ExchangeIncomeTab.jsx
//
// «Доход обмена» — спред и переоценка за период.
//
// Раздел появился раньше своих данных: счета (revenue/spread, revenue/fx_gain,
// expense/fx_loss) в плане есть, а проводок по ним ещё нет. Поэтому пустое
// состояние здесь — норма, а не ошибка, и говорит оно именно это: считать
// нечего, потому что движений не было.

import React, { useMemo, useState } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { exchangeIncome } from "../../../lib/treasury/v2selectors.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

export default function ExchangeIncomeTab({ ctx, officeFilter, formatBase }) {
  const { t } = useTranslation();
  // PeriodPicker работает пресет-строкой («month»), окно из неё считает
  // presetWindow — селектору нужно уже окно.
  const [preset, setPreset] = useState("month");
  const period = useMemo(() => presetWindow(preset), [preset]);
  const income = useMemo(
    () => exchangeIncome(ctx, period, officeFilter),
    [ctx, period, officeFilter]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <PeriodPicker value={preset} onChange={setPreset} />
      </div>

      {!income.hasData ? (
        <div className="bg-surface border border-line rounded-[22px] px-6 py-14 text-center">
          <p className="text-[15px] font-medium">{t("trv2_xi_empty_title") || "Пока нечего показывать"}</p>
          <p className="text-[13px] text-muted-soft mt-1.5 max-w-[460px] mx-auto">
            {t("trv2_xi_empty_hint") ||
              "За выбранный период не было проводок по спреду и переоценке. Счета для них заведены — цифры появятся, как только пойдут сделки."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Cell label={t("trv2_xi_spread") || "Спред"} value={formatBase(income.spread)} />
          <Cell label={t("trv2_xi_fx") || "Переоценка"} value={formatBase(income.fx)} />
          <Cell
            label={t("trv2_xi_total") || "Итого доход обмена"}
            value={formatBase(income.total)}
            hint={`${income.entryCount} ${t("trv2_xi_entries") || "проводок"}`}
            strong
          />
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, hint, strong = false }) {
  return (
    <div className={`rounded-[22px] px-5 py-4 border ${strong ? "bg-dark border-dark text-cream" : "bg-surface border-line"}`}>
      <div className={`text-[12.5px] ${strong ? "text-cream/60" : "text-muted"}`}>{label}</div>
      <div className={`text-[24px] font-semibold tracking-[-0.02em] tabular-nums mt-1.5 ${strong ? "text-lime" : ""}`}>
        {value}
      </div>
      {hint && <div className={`text-[12px] mt-1.5 ${strong ? "text-cream/50" : "text-muted-soft"}`}>{hint}</div>}
    </div>
  );
}
