// src/pages/settings/GeneralTab.jsx
// Системные настройки: base currency, min fee, referral %, rates (только для admin).

import React, { useState } from "react";
import { Settings as SettingsIcon, TrendingUp, Coins } from "lucide-react";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useRates, FEATURED_PAIRS, rateKey } from "../../store/rates.jsx";
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
  const { rates, setRate, lastUpdated } = useRates();
  const { codes: CURRENCIES } = useCurrencies();
  const { addEntry: logAudit } = useAudit();

  const [minFee, setMinFee] = useState(settings.minFeeUsd);
  const [refPct, setRefPct] = useState(settings.referralPct);

  // Base currency меняется напрямую (без явной кнопки Save)
  // — это settings-переключатель, эффект должен быть немедленным.
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
    const newMin = parseFloat(minFee) || 10;
    const newPct = parseFloat(refPct) || 0.1;
    const changes = [];
    if (newMin !== settings.minFeeUsd) {
      changes.push(`min fee $${settings.minFeeUsd} → $${newMin}`);
    }
    if (newPct !== settings.referralPct) {
      changes.push(`referral ${settings.referralPct}% → ${newPct}%`);
    }
    updateSettings({ minFeeUsd: newMin, referralPct: newPct });
    if (changes.length) {
      logAudit({
        action: "update",
        entity: "settings",
        entityId: "general",
        summary: changes.join(", "),
      });
    }
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
              {t("min_fee_label")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              disabled={!isAdmin}
              value={minFee}
              onChange={(e) => setMinFee(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              className="w-40 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500"
            />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-[13px] text-slate-700 font-medium">
              {t("referral_pct_label")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              disabled={!isAdmin}
              value={refPct}
              onChange={(e) => setRefPct(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
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
        </div>
      </section>

      <section>
        <SectionHeader
          icon={<TrendingUp className="w-4 h-4 text-slate-500" />}
          title={t("rates_management")}
          right={
            <span className="text-[11px] text-slate-500">
              {t("rate_updated")}: {lastUpdated.toLocaleTimeString()}
            </span>
          }
        />
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FEATURED_PAIRS.map(([from, to]) => (
              <div key={`${from}-${to}`} className="flex items-center gap-2">
                <div className="flex-1 text-[11px] font-bold text-slate-500 tracking-wide">
                  {from} → {to}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={!isAdmin}
                  value={rates[rateKey(from, to)] ?? ""}
                  onChange={(e) =>
                    setRate(from, to, e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                  }
                  className="w-32 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500 disabled:cursor-not-allowed"
                />
              </div>
            ))}
          </div>
          {isAdmin && (
            <p className="text-[11px] text-slate-500 mt-3">
              Full pair management with Add / Delete — in the Rates bar at the top of Cashier.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
