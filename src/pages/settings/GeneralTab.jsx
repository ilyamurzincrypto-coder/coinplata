// src/pages/settings/GeneralTab.jsx
// Глобальные системные настройки: base currency + referral %.
// Min fee и другие fee-параметры вынесены на уровень офиса (Settings → Offices).
// Rates — в Dashboard → Edit rates.

import React, { useState } from "react";
import { Settings as SettingsIcon, Coins, Info } from "lucide-react";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

function SectionHeader({ icon, title, right }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      </div>
      {right}
    </div>
  );
}

export default function GeneralTab() {
  const { t } = useTranslation();
  const { settings, updateSettings, isAdmin } = useAuth();
  const { codes: CURRENCIES } = useCurrencies();
  const { addEntry: logAudit } = useAudit();

  const [refPct, setRefPct] = useState(settings.referralPct);

  const handleBaseCurrencyChange = (newBase) => {
    const oldBase = settings.baseCurrency || "USD";
    if (newBase === oldBase) return;
    updateSettings({ baseCurrency: newBase });
    logAudit({
      action: "update",
      entity: "settings",
      entityId: "base_currency",
      summary: `Base currency ${oldBase} → ${newBase}`,
    });
  };

  const save = () => {
    const newPct = parseFloat(refPct) || 0.1;
    if (newPct === settings.referralPct) return;
    updateSettings({ referralPct: newPct });
    logAudit({
      action: "update",
      entity: "settings",
      entityId: "general",
      summary: `Referral ${settings.referralPct}% → ${newPct}%`,
    });
  };

  return (
    <div className="divide-y divide-slate-100">
      <section>
        <SectionHeader
          icon={<SettingsIcon className="w-4 h-4 text-slate-500" />}
          title={t("system_settings")}
        />
        <div className="p-5 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <label className="flex items-center gap-1.5 text-[13px] text-slate-700 font-medium">
                <Coins className="w-3.5 h-3.5 text-slate-500" />
                {t("base_currency_label")}
              </label>
              <SegmentedControl
                options={CURRENCIES.map((c) => ({ id: c, name: c }))}
                value={settings.baseCurrency || "USD"}
                onChange={isAdmin ? handleBaseCurrencyChange : () => {}}
                size="sm"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              {t("base_currency_hint")}
            </p>
          </div>

          <div className="h-px bg-slate-100" />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-[13px] text-slate-700 font-medium">
              {t("referral_pct_label")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              disabled={!isAdmin}
              value={refPct}
              onChange={(e) =>
                setRefPct(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
              }
              className="w-40 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500"
            />
          </div>

          {isAdmin && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={save}
                className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
              >
                {t("save")}
              </button>
            </div>
          )}

          <div className="mt-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 flex items-start gap-2">
            <Info className="w-3 h-3 mt-0.5 text-slate-400 shrink-0" />
            <span>
              Minimum fee and fee % are now configured{" "}
              <span className="font-semibold text-slate-700">per office</span> — see
              Settings → Offices.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
