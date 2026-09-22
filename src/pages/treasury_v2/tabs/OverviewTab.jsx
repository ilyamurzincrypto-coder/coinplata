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
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { capitalByCurrency, pnlForPeriod, exchangeIncome } from "../../../lib/treasury/v2selectors.js";
import { presetWindow } from "../PeriodPicker.jsx";
import { useBaseCurrency } from "../../../store/baseCurrency.js";
import { convert } from "../../../utils/convert.js";

// Левая граница группы колонок (Ностро / Лоро / Капитал / Баланс).
const GROUP = "border-l border-line pl-3";

const PROFIT_PRESETS = ["today", "week", "month", "quarter", "year"];

/**
 * Строки балансовой таблицы.
 *
 * СТРОКА = ВАЛЮТА, В КОТОРОЙ ОТКРЫТ СЧЁТ, а не «валюта, по которой были
 * движения». Пустой счёт — это не отсутствие счёта, а ноль на нём; спрятав
 * его, мы показали бы неполный план счетов, и валюта, в которой офис реально
 * работает, выглядела бы незаведённой. Тождество на такой строке выполняется
 * (0 = 0 − 0), поэтому и галочка там зелёная.
 *
 * Порядок: сначала валюты с деньгами, дальше пустые по алфавиту — нули не
 * должны отодвигать вниз то, ради чего страницу открыли.
 */
export function balanceRows(moved, accountsByCcy) {
  const byCcy = new Map((moved || []).map((r) => [r.currency, r]));
  const zero = (currency) => ({
    currency, nostro: 0, loro: 0, nostroBase: 0, loroBase: 0, capital: 0, capitalBase: 0,
  });
  const all = [...new Set([...(accountsByCcy?.keys() || []), ...byCcy.keys()])];
  return all
    .map((c) => byCcy.get(c) || zero(c))
    .sort((a, b) => {
      const d = Math.abs(b.capitalBase) - Math.abs(a.capitalBase);
      return d !== 0 ? d : a.currency.localeCompare(b.currency);
    });
}

/** Офисный фильтр — как в селекторах: "all" пропускает всё. */
function passesOffice(acc, officeFilter) {
  if (!officeFilter || officeFilter === "all") return true;
  return acc.officeId === officeFilter;
}

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

  // Счетов на валюту — по плану счетов, а не по остаткам: счёт без движений
  // всё равно открыт, и в «7 счетов» он входит.
  const accountsByCcy = useMemo(() => {
    const m = new Map();
    for (const a of ctx.accounts || []) {
      if (a.type !== "asset" && a.type !== "liability") continue;
      if (!passesOffice(a, officeFilter)) continue;
      const c = a.currency;
      if (!c) continue;
      m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [ctx.accounts, officeFilter]);

  const rows = useMemo(
    () => balanceRows(capitalByCurrency({ ...ctx, officeFilter }), accountsByCcy),
    [ctx, officeFilter, accountsByCcy]
  );

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

  // Приведение — сразу к $ и € (витрина по курсам на сегодня), без
  // переключателя: базовая валюта для сверки остаётся из Настроек.
  const { getRateFx } = useBaseCurrency();
  const usdOf = (n, ccy) => { const v = convert(n, ccy, "USD", getRateFx); return Number.isFinite(v) ? v : 0; };
  const eurOf = (n, ccy) => { const v = convert(n, ccy, "EUR", getRateFx); return Number.isFinite(v) ? v : 0; };

  const sum = useMemo(() => {
    let assets = 0, liabilities = 0, capital = 0;
    let nostroUsd = 0, nostroEur = 0, loroUsd = 0, loroEur = 0;
    const toUsd = (n, c) => { const v = convert(n, c, "USD", getRateFx); return Number.isFinite(v) ? v : 0; };
    const toEur = (n, c) => { const v = convert(n, c, "EUR", getRateFx); return Number.isFinite(v) ? v : 0; };
    for (const r of rows) {
      assets += r.nostroBase;
      liabilities += r.loroBase;
      capital += r.capitalBase;
      nostroUsd += toUsd(r.nostro, r.currency);
      nostroEur += toEur(r.nostro, r.currency);
      loroUsd += toUsd(r.loro, r.currency);
      loroEur += toEur(r.loro, r.currency);
    }
    return {
      assets, liabilities, capital,
      nostroUsd, nostroEur, loroUsd, loroEur,
      capitalUsd: nostroUsd - loroUsd, capitalEur: nostroEur - loroEur,
    };
  }, [rows, getRateFx]);

  // Раскрытие валюты → её счета (Ностро и Лоро) с остатками.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (ccy) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(ccy)) next.delete(ccy); else next.add(ccy);
    return next;
  });
  const balanceByAcc = useMemo(() => {
    const m = new Map();
    for (const b of ctx.balances || []) m.set(b.accountId, (m.get(b.accountId) || 0) + (Number(b.balance) || 0));
    return m;
  }, [ctx.balances]);
  const accountsOf = (ccy) =>
    (ctx.accounts || [])
      .filter((a) => (a.type === "asset" || a.type === "liability") && a.currency === ccy && passesOffice(a, officeFilter))
      .map((a) => ({ ...a, balance: balanceByAcc.get(a.id) || 0 }))
      .sort((x, y) => (x.type === y.type ? String(x.code || "").localeCompare(String(y.code || "")) : x.type === "asset" ? -1 : 1));

  const negativeCcy = rows.filter((r) => r.capital < 0).map((r) => r.currency);
  const ok = totals?.identityCheck?.ok !== false;
  const delta = totals?.identityCheck?.delta || 0;

  // Колонки как в эталоне: валюта | Ностро (родная, $·€) | Лоро (родная, $·€) |
  // Капитал (родная, $·€) | баланс. На узком экране таблица скроллится
  // горизонтально, а не сжимает цифры друг в друга.
  const GRID = "grid-cols-[minmax(210px,1.5fr)_repeat(6,minmax(100px,1fr))_76px] gap-x-3";

  return (
    <div className="space-y-3">
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

      {/* ── Средства по валютам: Ностро · Лоро · Капитал ── */}
      <div>
        <div className="text-[13.5px] font-semibold px-1 pb-2">{t("trv2_ov_funds")}</div>
        <div className="bg-cream-2 rounded-[26px] p-2">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              {/* Шапка в два яруса: группа (Ностро/Лоро/Капитал) и её колонки. */}
              <div className={`grid ${GRID} items-end px-[18px] pt-2.5 text-[11px] uppercase tracking-[0.07em] text-muted font-medium`}>
                <div />
                <div className={`${GROUP} col-span-2 pb-1.5`}>{t("trv2_ov_col_assets")}</div>
                <div className={`${GROUP} col-span-2 pb-1.5`}>{t("trv2_ov_col_liabilities")}</div>
                <div className={`${GROUP} col-span-2 pb-1.5`}>{t("trv2_ov_col_capital")}</div>
                <div className={`${GROUP} text-right pb-1.5`}>{t("trv2_ov_col_balance")}</div>
              </div>
              <div className={`grid ${GRID} items-center px-[18px] pb-2 text-[11.5px] text-muted`}>
                <div className="pl-7">{t("trv2_ov_col_currency")}</div>
                <div className={`${GROUP} text-right`}>{t("trv2_ov_sub_ours")}</div>
                <div className="text-right">$ · €</div>
                <div className={`${GROUP} text-right`}>{t("trv2_ov_sub_clients")}</div>
                <div className="text-right">$ · €</div>
                <div className={`${GROUP} text-right`}>{t("trv2_ov_col_capital")}</div>
                <div className="text-right">$ · €</div>
                <div className={`${GROUP} text-right font-mono`}>Н−Л−К</div>
              </div>

              <div className="bg-surface rounded-[18px] overflow-hidden">
                {rows.map((r) => {
                  const neg = r.capital < 0;
                  const isUsdt = /^USD[TC]$/.test(r.currency);
                  const open = expanded.has(r.currency);
                  const accs = accountsOf(r.currency);
                  return (
                    <div key={r.currency} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => toggle(r.currency)}
                        aria-expanded={open}
                        className={`grid ${GRID} w-full text-left items-center px-[18px] py-[7px] min-h-[62px] hover:bg-[rgba(26,25,21,.02)] transition-colors`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ChevronRight className={`w-3.5 h-3.5 text-muted-soft shrink-0 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.2} />
                          <span
                            className={`w-[30px] h-[30px] shrink-0 rounded-full grid place-items-center text-[11.5px] font-semibold ${
                              isUsdt ? "bg-dark text-lime" : "bg-cream-2 text-ink-soft"
                            }`}
                          >
                            {ccySymbol(r.currency)}
                          </span>
                          <b className="text-[13.5px] font-semibold whitespace-nowrap">{r.currency}</b>
                          <span className="text-[11.5px] text-muted whitespace-nowrap">
                            · {accountsByCcy.get(r.currency) || 0} {t("trv2_ov_accounts_n")}
                          </span>
                        </div>

                        <Native value={r.nostro} ccy={r.currency} className={GROUP} />
                        <UsdEur usd={usdOf(r.nostro, r.currency)} eur={eurOf(r.nostro, r.currency)} />
                        <Native value={r.loro} ccy={r.currency} className={GROUP} />
                        <UsdEur usd={usdOf(r.loro, r.currency)} eur={eurOf(r.loro, r.currency)} />
                        <Native value={r.capital} ccy={r.currency} className={GROUP} neg={neg} />
                        <UsdEur usd={usdOf(r.capital, r.currency)} eur={eurOf(r.capital, r.currency)} />

                        {/* Капитал по валюте считается как Н − Л, поэтому невязка
                            строки всегда ноль; «!» — предупреждение о минусе. */}
                        <div className={`${GROUP} text-right`} title={neg ? `${t("trv2_ov_note_neg")} ${r.currency}` : ""}>
                          <span className={`text-[14px] font-semibold ${neg ? "text-warning" : "text-success"}`}>
                            {neg ? "!" : "✓"}
                          </span>
                        </div>
                      </button>

                      {open && (
                        <div className="bg-[rgba(26,25,21,.02)] border-t border-line">
                          {accs.length === 0 && (
                            <div className="px-[18px] py-3 pl-[62px] text-[12px] text-muted-soft">{t("trv2_ov_no_accounts")}</div>
                          )}
                          {accs.map((a) => (
                            <div key={a.id} className={`grid ${GRID} items-center px-[18px] py-2 text-[12.5px]`}>
                              <div className="pl-[62px] min-w-0 truncate text-ink-soft">
                                {a.code && <span className="font-mono text-[11px] text-muted-soft mr-2">{a.code}</span>}
                                {a.name}
                              </div>
                              {a.type === "asset" ? (
                                <>
                                  <Native value={a.balance} ccy={r.currency} className={GROUP} small />
                                  <UsdEur usd={usdOf(a.balance, r.currency)} eur={eurOf(a.balance, r.currency)} small />
                                  <div className={GROUP} /><div />
                                </>
                              ) : (
                                <>
                                  <div className={GROUP} /><div />
                                  <Native value={a.balance} ccy={r.currency} className={GROUP} small />
                                  <UsdEur usd={usdOf(a.balance, r.currency)} eur={eurOf(a.balance, r.currency)} small />
                                </>
                              )}
                              <div className={GROUP} /><div /><div className={GROUP} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Пусто только когда счетов нет ВООБЩЕ. «Нет движений» и «нет
                    счетов» — разные состояния: первое чинится сделкой, второе —
                    заведением счёта, и подсказка должна вести в нужное место. */}
                {rows.length === 0 && (
                  <div className="px-5 py-12 text-center">
                    <p className="text-[13px] text-muted-soft">{t("trv2_ov_no_accounts")}</p>
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent("coinplata:navigate", { detail: "accounts" }))}
                      className="mt-2.5 text-[13px] font-medium text-ink underline underline-offset-4 decoration-line-2 hover:decoration-ink transition-colors"
                    >
                      {t("trv2_ov_go_accounts")}
                    </button>
                  </div>
                )}
              </div>

              {rows.length > 0 && (
                <div className={`grid ${GRID} items-center px-[18px] min-h-[58px] bg-surface rounded-[18px] mt-1.5 font-semibold`}>
                  <div className="pl-7 text-[12.5px] uppercase tracking-[0.05em] text-ink">
                    {t("trv2_ov_total")} {t("trv2_ov_in")} $ · €
                  </div>
                  <div className={`${GROUP} text-right text-muted-soft font-normal`}>—</div>
                  <UsdEur usd={sum.nostroUsd} eur={sum.nostroEur} strong />
                  <div className={`${GROUP} text-right text-muted-soft font-normal`}>—</div>
                  <UsdEur usd={sum.loroUsd} eur={sum.loroEur} strong />
                  <div className={`${GROUP} text-right text-muted-soft font-normal`}>—</div>
                  <UsdEur usd={sum.capitalUsd} eur={sum.capitalEur} strong />
                  {/* Невязка всей книги (Σ Дт − Σ Кт) — из сверки, не из таблицы. */}
                  <div className={`${GROUP} text-right tabular-nums whitespace-nowrap ${ok ? "text-success" : "text-danger"}`}>
                    {ok ? "✓" : formatBase(Math.abs(delta))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-[18px] pt-2 pb-1.5 text-[11.5px] text-muted-soft">
            {t("trv2_ov_note")}
            {negativeCcy.length > 0 && ` · ⚠ ${t("trv2_ov_note_neg")} ${negativeCcy.join(", ")}`}
          </div>
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

/** Родная сумма со знаком валюты: «19 591,83 ₽». */
function Native({ value, ccy, neg = false, small = false, className = "" }) {
  const zero = !value;
  return (
    <div className={`text-right tabular-nums whitespace-nowrap min-w-0 ${className}`}>
      <span className={`${small ? "text-[12.5px] font-medium" : "text-[13.5px] font-semibold"} ${neg ? "text-warning" : zero ? "text-muted-soft font-normal" : "text-ink"}`}>
        {fmtNative(value)}
      </span>
      <span className="text-muted-soft ml-1 text-[12px]">{ccySymbol(ccy)}</span>
    </div>
  );
}

/** Приведение: $ сверху, € под ним. */
function UsdEur({ usd, eur, strong = false, small = false }) {
  return (
    <div className="text-right tabular-nums whitespace-nowrap min-w-0 leading-tight">
      <span className={`block ${strong ? "text-[14.5px] font-semibold text-ink" : small ? "text-[12px] text-muted" : "text-[13px] text-ink-soft"}`}>
        {fmtNative(usd)} $
      </span>
      <span className="block text-[11px] text-muted-soft font-normal">{fmtNative(eur)} €</span>
    </div>
  );
}
