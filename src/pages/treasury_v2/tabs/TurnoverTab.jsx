// src/pages/treasury_v2/tabs/TurnoverTab.jsx
//
// Оборотно-сальдовая ведомость видом CoinPay.
//
// 🔴 ЧТО УБРАНО. Была вкладка «Обороты» с переключателем «ОСВ / Шахматка» и разворачиваемыми
// строками (счёт → проводки → субконто). Она выпала из навигации при переходе на четыре раздела
// и полгода лежала мёртвым кодом. Возвращаю только ОСВ: «шахматка» (счёт×счёт) — отчёт, который
// в кассе не открывали ни разу, а развёртки канон запрещает прямо («страничная навигация, ноль
// развёрток»): клик по строке ведёт в карточку счёта, где выписка показана целиком.
//
// 🔴 РАЗДЕЛЫ ТЕ ЖЕ, ЧТО В РЕЕСТРЕ. Лоро · Ностро и кассы · Капитал, одна раскладка на оба экрана
// (`sectionOf`). Раньше ОСВ резала счета по сырому `type` и показывала «Доходы»/«Расходы»
// отдельными классами — те же счета, но в другом порядке и под другими названиями, чем рядом в
// Реестре. Один план счетов обязан выглядеть одинаково везде.
//
// 🔴 ИТОГ — ПО ВАЛЮТАМ, А НЕ ОДНОЙ СУММОЙ. Валюты не складываются. Общая сумма трёх разделов
// тождественно равна удвоенным активам и смысла не имеет, поэтому внизу — строка на валюту с
// проверкой Ностро − Лоро − Капитал ≈ 0 и честной невязкой, если не сошлось.

import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import { trialBalance } from "../../../lib/treasury/v2selectors.js";
import { SECTION, SECTION_TITLE, sectionOf } from "../../../lib/ledgerView/accountRoles.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountDetailModal from "../parts/AccountDetailModal.jsx";

const ORDER = [SECTION.NOSTRO, SECTION.LORO, SECTION.CAPITAL, SECTION.UNSORTED];

/** Сумма в валюте счёта: разряды, две копейки, типографский минус. */
function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/^-/, "−");
}

const GRID =
  "grid-cols-[72px_minmax(0,1fr)_56px_repeat(4,minmax(96px,120px))] gap-x-3";

function HeadCell({ children, right = false }) {
  return <div className={right ? "text-right" : ""}>{children}</div>;
}

/**
 * Невязка раздела по валюте. Активы растут дебетом, обязательства и капитал — кредитом,
 * поэтому в каноне сходимость читается как Ностро − Лоро − Капитал ≈ 0.
 */
export function checkByCurrency(rows) {
  const by = new Map();
  for (const r of rows) {
    const rec = by.get(r.currency) || { currency: r.currency, nostro: 0, loro: 0, capital: 0 };
    if (r.section === SECTION.NOSTRO) rec.nostro += r.closing;
    else if (r.section === SECTION.LORO) rec.loro += r.closing;
    else if (r.section === SECTION.CAPITAL) rec.capital += r.closing;
    by.set(r.currency, rec);
  }
  return [...by.values()]
    .map((r) => ({ ...r, delta: r.nostro - r.loro - r.capital }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export default function TurnoverTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_turnover_period") || "month"; } catch { return "month"; }
  });
  const setP = (v) => {
    setPeriod(v);
    try { localStorage.setItem("coinplata.treasury_turnover_period", v); } catch { /* приватное окно */ }
  };
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState(null);

  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  // Строки ОСВ из общего селектора; раздел берём из той же раскладки, что и Реестр.
  const rows = useMemo(() => {
    const tb = trialBalance(ctx, win, officeFilter);
    const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
    return tb.classes.flatMap((c) => c.accounts).map((r) => ({
      ...r,
      section: sectionOf(accById.get(r.accountId) || { type: r.type, subtype: r.subtype }),
    }));
  }, [ctx, win, officeFilter]);

  const nq = q.trim().toLowerCase();
  const visible = useMemo(
    () => (nq ? rows.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(nq)) : rows),
    [rows, nq]
  );

  // Проверка считается по ВСЕМ строкам, а не по видимым: поиск — это прицел, а не правка книги.
  const checks = useMemo(() => checkByCurrency(rows), [rows]);

  const sections = ORDER.map((s) => ({
    id: s,
    title: SECTION_TITLE[s],
    rows: visible.filter((r) => r.section === s).sort((a, b) => String(a.code).localeCompare(String(b.code))),
  })).filter((s) => s.rows.length > 0);

  function doExport() {
    exportCSV({
      filename: `osv_${String(win.from).slice(0, 10)}_${String(win.to).slice(0, 10)}.csv`,
      columns: [
        { key: "section", label: "Раздел" },
        { key: "code", label: "Счёт" },
        { key: "name", label: "Наименование" },
        { key: "currency", label: "Валюта" },
        { key: "opening", label: "Сальдо нач." },
        { key: "debitTurnover", label: "Оборот Дт" },
        { key: "creditTurnover", label: "Оборот Кт" },
        { key: "closing", label: "Сальдо кон." },
      ],
      rows: sections.flatMap((s) => s.rows.map((r) => ({ ...r, section: s.title }))),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <PeriodPicker value={period} onChange={setP} />
        <label className="flex items-center gap-2.5 bg-surface border border-line rounded-full px-[15px] py-2 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-muted shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Счёт или наименование"
            className="w-full bg-transparent border-none outline-none text-[13px] placeholder:text-muted-soft"
          />
        </label>
        <button
          type="button"
          onClick={doExport}
          disabled={rows.length === 0}
          className="ml-auto text-[12.5px] font-medium text-muted hover:text-ink px-3.5 py-2 rounded-full hover:bg-cream-2 disabled:opacity-40 transition-colors"
        >
          Выгрузить CSV
        </button>
      </div>

      {truncated && (
        <div className="rounded-[18px] px-[18px] py-2.5 text-[12.5px] bg-warning-soft text-warning border border-warning/20">
          {t("trv2_window_partial")}
        </div>
      )}

      <div className="bg-cream-2 rounded-[26px] p-2">
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className={`grid ${GRID} items-end px-[18px] pt-2.5 pb-2 text-[11px] uppercase tracking-[0.07em] text-muted font-medium`}>
              <HeadCell>Счёт</HeadCell>
              <HeadCell>Наименование</HeadCell>
              <HeadCell>Вал.</HeadCell>
              <HeadCell right>Сальдо нач.</HeadCell>
              <HeadCell right>Оборот Дт</HeadCell>
              <HeadCell right>Оборот Кт</HeadCell>
              <HeadCell right>Сальдо кон.</HeadCell>
            </div>

            <div className="bg-surface rounded-[18px] overflow-hidden">
              {sections.length === 0 && (
                <div className="px-5 py-12 text-center text-[13px] text-muted-soft">
                  За период движений нет
                </div>
              )}

              {sections.map((s) => (
                <div key={s.id}>
                  <div className="px-[18px] py-2 text-[11.5px] uppercase tracking-[0.06em] text-muted bg-[rgba(26,25,21,.03)] border-y border-line">
                    {s.title}
                  </div>
                  {s.rows.map((r) => (
                    <button
                      key={`${r.accountId}-${r.currency}`}
                      type="button"
                      onClick={() => setDetail({ accountId: r.accountId })}
                      className={`grid ${GRID} w-full text-left items-center px-[18px] py-[9px] border-b border-line last:border-b-0 hover:bg-[rgba(26,25,21,.02)] transition-colors`}
                    >
                      <span className="font-mono text-[12px] text-muted-soft">{r.code}</span>
                      <span className="text-[13px] text-ink truncate">{r.name}</span>
                      <span className="text-[12px] text-muted">{r.currency}</span>
                      <span className="text-right tabular-nums text-[12.5px] text-ink-soft">{fmt(r.opening)}</span>
                      <span className="text-right tabular-nums text-[12.5px] text-ink-soft">{fmt(r.debitTurnover)}</span>
                      <span className="text-right tabular-nums text-[12.5px] text-ink-soft">{fmt(r.creditTurnover)}</span>
                      <span className="text-right tabular-nums text-[13px] font-semibold">{fmt(r.closing)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {checks.length > 0 && (
              <div className="mt-1.5 bg-surface rounded-[18px] px-[18px] py-2.5">
                <div className="text-[11px] uppercase tracking-[0.07em] text-muted font-medium pb-1.5">
                  Сходимость по валютам · Ностро − Лоро − Капитал
                </div>
                {checks.map((c) => {
                  const ok = Math.abs(c.delta) < 0.01;
                  return (
                    <div key={c.currency} className="grid grid-cols-[56px_repeat(4,minmax(96px,1fr))] gap-x-3 items-center py-1 text-[12.5px]">
                      <span className="font-semibold">{c.currency}</span>
                      <span className="text-right tabular-nums text-ink-soft">{fmt(c.nostro)}</span>
                      <span className="text-right tabular-nums text-ink-soft">{fmt(c.loro)}</span>
                      <span className="text-right tabular-nums text-ink-soft">{fmt(c.capital)}</span>
                      <span className={`text-right tabular-nums font-semibold ${ok ? "text-success" : "text-danger"}`}>
                        {ok ? "✓" : fmt(c.delta)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Карточку монтируем только открытой: её хуки тянут офисы и курсы, а ОСВ
          обязана рисоваться и там, где этих провайдеров нет (тест, узкий экран). */}
      {detail && (
      <AccountDetailModal
        open
        onClose={() => setDetail(null)}
        ctx={ctx}
        formatBase={formatBase}
        baseCurrency={baseCurrency}
        onOpenTx={onOpenTx}
        accountId={detail.accountId}
      />
      )}
    </div>
  );
}
