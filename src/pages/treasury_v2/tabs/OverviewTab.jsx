// src/pages/treasury_v2/tabs/OverviewTab.jsx
//
// Обзор Казначейства по эталону treasury-r3.
//
// ГЛАВНОЕ ПРАВИЛО СТРАНИЦЫ: всё, кроме карточки прибыли, показывает состояние
// «сейчас». Период у балансов бессмыслен — остаток либо есть, либо нет, — и
// переключатель периода наверху приводил к тому, что «Активы за неделю»
// читались как сумма за неделю, хотя это был остаток на конец.
//
// Карточки без данных НЕ рендерятся. Пустая карточка с нулём выглядит как
// посчитанный ноль, а на деле означает «мы это не считаем»; разница
// принципиальная, когда речь о прибыли и валютной позиции.

import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { capitalByCurrency, pnlForPeriod, exchangeIncome } from "../../../lib/treasury/v2selectors.js";
import { presetWindow } from "../PeriodPicker.jsx";

const BASE_OPTIONS = ["USD", "EUR", "TRY", "RUB"];
const PROFIT_PRESETS = ["today", "week", "month", "quarter", "year"];

/** Символ валюты для кружка. Неизвестной — первая буква кода. */
function ccySymbol(code) {
  return { USD: "$", EUR: "€", TRY: "₺", RUB: "₽", GBP: "£", CHF: "₣", USDT: "₮", USDC: "₮" }[code]
    || (code || "?").slice(0, 1);
}

/**
 * Родная сумма: разряды пробелом, две копейки, типографский минус.
 *
 * Дефис в колонке цифр читается как перенос или прочерк — на отрицательном
 * капитале это ровно та строка, где ошибиться нельзя.
 */
function fmtNative(n) {
  const v = Number(n) || 0;
  return v
    .toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/^-/, "\u2212");
}

export default function OverviewTab({
  ctx, officeFilter, setOffice, formatBase, baseCurrency, totals, freshTime,
}) {
  const { t } = useTranslation();

  // Единственный период на странице — внутри карточки прибыли. Храним
  // пресет-строкой: окно из неё считает presetWindow, а селектору нужно окно.
  const [profitPreset, setProfitPreset] = useState("month");
  const [presetOpen, setPresetOpen] = useState(false);
  const profitPeriod = useMemo(() => presetWindow(profitPreset), [profitPreset]);

  const rows = useMemo(() => capitalByCurrency({ ...ctx, officeFilter }), [ctx, officeFilter]);

  // Счетов на валюту — считаем по счетам, а не по остаткам: счёт без движений
  // всё равно открыт, и в «7 счетов» он входит.
  const accountsByCcy = useMemo(() => {
    const m = new Map();
    for (const a of ctx.accounts || []) {
      if (a.type !== "asset" && a.type !== "liability") continue;
      const c = a.currency;
      if (!c) continue;
      m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [ctx.accounts]);

  const profit = useMemo(
    () => pnlForPeriod(ctx, profitPeriod, officeFilter),
    [ctx, profitPeriod, officeFilter]
  );
  const income = useMemo(
    () => exchangeIncome(ctx, profitPeriod, officeFilter),
    [ctx, profitPeriod, officeFilter]
  );

  // Транзакций за период — для подписи карточки прибыли.
  const txCount = useMemo(() => {
    const from = new Date(profitPeriod.from).getTime();
    const to = new Date(profitPeriod.to).getTime();
    return (ctx.transactions || []).filter((tx) => {
      const ts = new Date(tx.effectiveDate).getTime();
      return Number.isFinite(ts) && ts >= from && ts <= to;
    }).length;
  }, [ctx.transactions, profitPeriod]);

  const clientsCount = (ctx.clients || []).length;

  const sum = useMemo(() => {
    let assets = 0, liabilities = 0, capital = 0;
    for (const r of rows) {
      assets += r.nostroBase;
      liabilities += r.loroBase;
      capital += r.capitalBase;
    }
    return { assets, liabilities, capital };
  }, [rows]);

  const negativeCcy = rows.filter((r) => r.capital < 0).map((r) => r.currency);
  const ok = totals?.identityCheck?.ok !== false;
  const delta = totals?.identityCheck?.delta || 0;

  // Три ступени. На узком экране в строке остаётся валюта, капитал и значок:
  // три колонки цифр в 390px не помещаются и наезжают друг на друга — числа
  // при этом читаются как одно, и ошибиться в них проще, чем не увидеть.
  const GRID =
    "grid-cols-[minmax(90px,1fr)_minmax(96px,auto)_28px] " +
    "sm:grid-cols-[minmax(150px,1.2fr)_1fr_1fr_40px] " +
    "xl:grid-cols-[minmax(190px,1.2fr)_1fr_1fr_1fr_54px]";

  return (
    <div className="space-y-3">
      {/* ── Тулбар: приведение. Фильтр офиса живёт в шапке раздела — второй
             такой же селектор рядом читался бы как ещё один, независимый. ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.07em] text-muted-soft font-medium">
            {t("trv2_ov_conversion")}
          </span>
          <div className="flex gap-0.5 bg-surface border border-line rounded-full p-[3px]">
            {BASE_OPTIONS.map((c) => (
              <span
                key={c}
                title={c === baseCurrency ? "" : "Базовая валюта меняется в Настройках"}
                className={`px-3.5 py-[7px] rounded-full text-[12.5px] font-medium ${
                  c === baseCurrency ? "bg-dark text-cream" : "text-ink-soft opacity-50"
                }`}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Строка сверки ── */}
      <div className="flex items-center gap-3 flex-wrap bg-surface border border-line rounded-[18px] px-[18px] py-3 font-medium">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            ok ? "bg-lime shadow-[0_0_0_4px_rgba(200,217,111,.35)]" : "bg-warning shadow-[0_0_0_4px_rgba(176,122,60,.25)]"
          }`}
        />
        {ok ? (
          <span>
            {t("trv2_ov_reconciled")}{" "}
            <span className="text-muted font-normal">
              — {t("trv2_ov_capital")} <b className="font-semibold text-ink">{formatBase(sum.capital)}</b>{" "}
              = {t("trv2_ov_assets")} <b className="font-semibold text-ink">{formatBase(sum.assets)}</b>{" "}
              − {t("trv2_ov_liabilities")} <b className="font-semibold text-ink">{formatBase(sum.liabilities)}</b>
            </span>
          </span>
        ) : (
          <span className="text-warning">
            {t("trv2_ov_mismatch")}{" "}
            <span className="font-normal">— {formatBase(Math.abs(delta))}</span>
          </span>
        )}
        <span className="ml-auto font-mono text-[12px] text-muted-soft">
          Σ Дт = Σ Кт {ok ? "✓" : "≠"}
        </span>
      </div>

      {/* ── Балансовая таблица по валютам ── */}
      <div className="bg-cream-2 rounded-[26px] p-2">
        <div className={`grid ${GRID} gap-3 items-center px-[18px] pt-2.5 pb-0.5 text-[11px] uppercase tracking-[0.07em] text-muted font-medium`}>
          <div />
          <div className="text-right hidden sm:block">{t("trv2_ov_col_assets")}</div>
          <div className="text-right sm:hidden">{t("trv2_ov_col_capital")}</div>
          <div className="text-right hidden sm:block">{t("trv2_ov_col_liabilities")}</div>
          <div className="text-right hidden xl:block">{t("trv2_ov_col_capital")}</div>
          <div />
        </div>
        <div className={`grid ${GRID} gap-3 items-center px-[18px] pb-2 text-[11.5px] text-muted`}>
          <div>{t("trv2_ov_col_currency")}</div>
          <div className="text-right">{baseCurrency}</div>
          <div className="text-right hidden sm:block">{baseCurrency}</div>
          <div className="text-right hidden xl:block">= А − О</div>
          <div className="text-right hidden sm:block">{t("trv2_ov_col_balance")}</div>
        </div>

        <div className="bg-surface rounded-[18px] overflow-hidden">
          {rows.map((r) => {
            const neg = r.capital < 0;
            const isUsdt = /^USD[TC]$/.test(r.currency);
            return (
              <div
                key={r.currency}
                className={`grid ${GRID} gap-3 items-center px-[18px] py-[7px] min-h-[58px] border-b border-line last:border-b-0`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-[30px] h-[30px] shrink-0 rounded-full grid place-items-center text-[11.5px] font-semibold ${
                      isUsdt ? "bg-dark text-lime" : "bg-cream-2 text-ink-soft"
                    }`}
                  >
                    {ccySymbol(r.currency)}
                  </span>
                  <div className="min-w-0">
                    <b className="block text-[13.5px] font-semibold whitespace-nowrap">{r.currency}</b>
                    <span className="text-[11.5px] text-muted">
                      {accountsByCcy.get(r.currency) || 0} {t("trv2_ov_accounts_n")}
                    </span>
                  </div>
                </div>

                <Money native={r.nostro} base={r.nostroBase} formatBase={formatBase} className="hidden sm:block" />
                {/* На узком экране единственная колонка цифр — капитал: это
                    ответ на вопрос «сколько наше», ради которого сюда заходят. */}
                <Money native={r.capital} base={r.capitalBase} formatBase={formatBase} neg={neg} className="sm:hidden" />
                <Money native={r.loro} base={r.loroBase} formatBase={formatBase} className="hidden sm:block" />
                <Money native={r.capital} base={r.capitalBase} formatBase={formatBase} neg={neg} className="hidden xl:block" />

                <span
                  className={`w-[22px] h-[22px] rounded-full grid place-items-center justify-self-end ${
                    neg ? "bg-warning-soft" : "bg-[rgba(200,217,111,.4)]"
                  }`}
                  title={neg ? t("trv2_ov_note_neg") : ""}
                >
                  <span className={`text-[11px] font-semibold ${neg ? "text-warning" : "text-lime-ink"}`}>
                    {neg ? "!" : "✓"}
                  </span>
                </span>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className="px-5 py-12 text-center text-[13px] text-muted-soft">
              {t("trv2_ov_empty")}
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className={`grid ${GRID} gap-3 items-center px-[18px] min-h-[52px] bg-surface rounded-[18px] mt-1.5 font-semibold`}>
            <div className="text-[12.5px] uppercase tracking-[0.05em] text-muted">
              {t("trv2_ov_total")} ≈ {baseCurrency}
            </div>
            <div className="text-right tabular-nums text-[14.5px] hidden sm:block">{formatBase(sum.assets)}</div>
            <div className="text-right tabular-nums text-[14.5px] sm:hidden">{formatBase(sum.capital)}</div>
            <div className="text-right tabular-nums text-[14.5px] hidden sm:block">{formatBase(sum.liabilities)}</div>
            <div className="text-right tabular-nums text-[14.5px] hidden xl:block">{formatBase(sum.capital)}</div>
            <div />
          </div>
        )}

        <div className="px-[18px] pt-2 pb-1.5 text-[11.5px] text-muted-soft">
          {t("trv2_ov_note")}
          {negativeCcy.length > 0 && ` · ⚠ ${t("trv2_ov_note_neg")} ${negativeCcy.join(", ")}`}
        </div>
      </div>

      {/* ── Карточки. Рендерим только те, для которых есть расчёт. ── */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <div className="bg-dark border border-dark rounded-[22px] px-5 py-[18px] text-cream">
          <div className="flex items-center text-[12.5px] text-cream/60 mb-2">
            {t("trv2_ov_kpi_profit")}
            {/* Компактный выбор — общий PeriodPicker разворачивает шесть кнопок
                и диапазон дат, внутри карточки это заняло бы её целиком. */}
            <span className="ml-auto relative">
              <button
                type="button"
                onClick={() => setPresetOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-cream/65 hover:text-cream transition-colors"
              >
                {t(`trv2_period_${profitPreset}`)}
                <ChevronDown className="w-3 h-3" strokeWidth={2.2} />
              </button>
              {presetOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[150px] bg-surface border border-line rounded-[16px] shadow-[0_14px_40px_rgba(26,25,21,.2)] p-1.5">
                  {PROFIT_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setProfitPreset(p); setPresetOpen(false); }}
                      className={`flex w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium transition-colors ${
                        profitPreset === p ? "bg-cream-2 text-ink" : "text-ink-soft hover:bg-cream-2"
                      }`}
                    >
                      {t(`trv2_period_${p}`)}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </div>
          <div className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums text-lime whitespace-nowrap">
            {profit.netProfit >= 0 ? "+" : ""}{formatBase(profit.netProfit)}
          </div>
          <div className="text-[12px] text-cream/50 mt-1.5">
            {txCount} {t("trv2_ov_kpi_txs")}
          </div>
        </div>

        {/* Доход обмена — только когда есть проводки по спреду и переоценке.
            Ноль здесь означал бы «обмен не приносит», а не «мы это не считали». */}
        {income.hasData && (
          <div className="bg-surface border border-line rounded-[22px] px-5 py-[18px]">
            <div className="text-[12.5px] text-muted mb-2">{t("trv2_xi_total")}</div>
            <div className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums text-success whitespace-nowrap">
              {income.total >= 0 ? "+" : ""}{formatBase(income.total)}
            </div>
            <div className="text-[12px] text-muted-soft mt-1.5">
              {t("trv2_xi_spread").toLowerCase()} + {t("trv2_xi_fx").toLowerCase()}
            </div>
          </div>
        )}

        <div className="bg-surface border border-line rounded-[22px] px-5 py-[18px]">
          <div className="text-[12.5px] text-muted mb-2">{t("trv2_ov_kpi_liab")}</div>
          <div className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums whitespace-nowrap">
            {formatBase(sum.liabilities)}
          </div>
          <div className="text-[12px] text-muted-soft mt-1.5">
            {clientsCount} {t("trv2_ov_kpi_clients")}
          </div>
        </div>

        {/* TODO: карточка «Валютная позиция». Расчёта нет — ни формулы
            длинная/короткая, ни порога «открыта». Считать её здесь на глазок
            значило бы выдать догадку за измерение: по этой цифре закрывают
            позицию живыми деньгами. */}
      </div>
    </div>
  );
}

/** Ячейка суммы: родная жирным, приведённая под ней. */
function Money({ native, base, formatBase, neg = false, className = "" }) {
  const zero = !native && !base;
  return (
    <div className={`text-right tabular-nums whitespace-nowrap min-w-0 ${className}`}>
      <span className={`block text-[13.5px] font-semibold ${neg ? "text-warning" : zero ? "text-muted-soft font-normal" : ""}`}>
        {fmtNative(native)}
      </span>
      <span className="block text-[12px] text-muted-soft font-normal">{formatBase(base)}</span>
    </div>
  );
}
