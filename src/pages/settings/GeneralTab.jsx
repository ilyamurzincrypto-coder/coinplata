// src/pages/settings/GeneralTab.jsx
// Глобальные системные настройки: base currency + referral % + биржевые
// курсы (fxRates) для пересчёта на дашборде между display валютами.
// Min fee и другие fee-параметры вынесены на уровень офиса (Settings → Offices).
// Rates обмена — в Dashboard → Edit rates.

import React, { useState } from "react";
import { Settings as SettingsIcon, Coins, Info, TrendingUp, ArrowLeftRight } from "lucide-react";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useRates } from "../../store/rates.jsx";
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
  const { getRate } = useRates();

  const [refPct, setRefPct] = useState(settings.referralPct);

  // FX rates state — биржевой курс для пересчёта на дашборде между USD/EUR.
  // Хранится в settings.fxRates как { "USD_EUR": 0.92, "EUR_USD": 1.087 }.
  // Reverse вычисляется автоматически при сохранении (1/sell).
  const fxRates = settings.fxRates || {};
  const [fxUsdEur, setFxUsdEur] = useState(
    fxRates.USD_EUR != null ? String(fxRates.USD_EUR) : ""
  );
  const [fxEurUsd, setFxEurUsd] = useState(
    fxRates.EUR_USD != null ? String(fxRates.EUR_USD) : ""
  );

  // Курс выбранной base currency на сегодня (через USD триангуляцию).
  // Показываем рядом с переключателем чтобы админ видел по какому курсу
  // считается эквивалент на главной.
  const baseCur = settings.baseCurrency || "USD";
  const baseToUsd = baseCur === "USD" ? 1 : getRate(baseCur, "USD");
  const usdToBase = baseCur === "USD" ? 1 : getRate("USD", baseCur);

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

  const saveFx = () => {
    const sell = parseFloat(String(fxUsdEur).replace(",", ".")) || 0;
    const buy = parseFloat(String(fxEurUsd).replace(",", ".")) || 0;
    const next = { ...fxRates };
    if (sell > 0) next.USD_EUR = sell;
    if (buy > 0) next.EUR_USD = buy;
    // Если задан только sell — auto-вычисляем reverse
    if (sell > 0 && buy <= 0) next.EUR_USD = Number((1 / sell).toFixed(6));
    if (buy > 0 && sell <= 0) next.USD_EUR = Number((1 / buy).toFixed(6));
    updateSettings({ fxRates: next });
    logAudit({
      action: "update",
      entity: "settings",
      entityId: "fx_rates",
      summary: `FX rates updated: USD→EUR=${next.USD_EUR ?? "—"}, EUR→USD=${next.EUR_USD ?? "—"}`,
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
            <p className="text-[11px] text-slate-500 mb-2">
              {t("base_currency_hint")}
            </p>
            {/* Курс выбранной base на сегодня — чтобы админ видел по
                какому курсу считаются эквиваленты на главной. Если
                нужно — поменять курс можно через DailyRatesModal /
                Edit rates. */}
            {baseCur !== "USD" && (
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-[10px] bg-emerald-50/50 border border-emerald-200 text-[12px]">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="text-slate-600">
                  Курс на сегодня:{" "}
                </span>
                <span className="font-bold tabular-nums text-emerald-800">
                  1 {baseCur} ={" "}
                  {Number.isFinite(baseToUsd) ? baseToUsd.toFixed(4) : "—"} USD
                </span>
                {Number.isFinite(usdToBase) && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-bold tabular-nums text-slate-700">
                      1 USD = {usdToBase.toFixed(4)} {baseCur}
                    </span>
                  </>
                )}
                <span className="text-[10px] text-slate-400 ml-1">
                  изменить → Касса → Quick / Edit rates
                </span>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100" />

          {/* Биржевой курс USD↔EUR для пересчёта на дашборде. Используется
              только для display-конвертации между базовыми валютами; не
              влияет на rates обмена офиса. Reverse вычисляется автоматически
              если задано только одно поле. */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <ArrowLeftRight className="w-3.5 h-3.5 text-slate-500" />
              <label className="text-[13px] text-slate-700 font-medium">
                Биржевой курс (для дашборда)
              </label>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              Используется при переключении USD/EUR на главной странице
              (Balances). Не влияет на курсы обмена офиса. Если задан
              только один — обратный вычисляется автоматически (1/курс).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  1 USD → EUR
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={!isAdmin}
                  value={fxUsdEur}
                  onChange={(e) =>
                    setFxUsdEur(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                  }
                  placeholder="0.92"
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  1 EUR → USD
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={!isAdmin}
                  value={fxEurUsd}
                  onChange={(e) =>
                    setFxEurUsd(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                  }
                  placeholder="1.087"
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] font-semibold tabular-nums outline-none disabled:text-slate-500"
                />
              </div>
            </div>
            {isAdmin && (
              <div className="mt-2 flex justify-end">
                <button
                  onClick={saveFx}
                  className="px-3 py-1.5 rounded-[8px] bg-slate-900 text-white text-[12px] font-semibold hover:bg-slate-800 transition-colors"
                >
                  Сохранить fx-курсы
                </button>
              </div>
            )}
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
