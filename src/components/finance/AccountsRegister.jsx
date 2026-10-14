// src/components/finance/AccountsRegister.jsx
//
// Реестр счетов — вид перенесён из CoinPay.
//
// 🔴 ПРАВИЛО ВЛАДЕЛЬЦА: Лоро, Ностро и кассы, Капитал выглядят ИДЕНТИЧНО — ОДИН компонент, один
// набор колонок, те же ширины и порядок; различаются только данные строк. Поэтому раздел здесь —
// это проп, а не отдельный экран. Колонка «Контрагент» есть ВЕЗДЕ: в Лоро это клиент, в Ностро и
// Капитале — «Платформа».
//
// 🔴 ЖЕЛЕЗОБЕТОННОЕ ПРАВИЛО: НИ ОДНА ячейка не переносится на вторую строку, и никаких <br>.
// Строка ВСЕГДА одна. Цифры выравниваются `tabular-nums` (класс `tnum`/`tabular-nums`), а НЕ
// моноширинным шрифтом — моноширинный запрещён дизайн-системой.
//
// 🔴 НЕТ КУРСА — ПРОЧЕРК, А НЕ НОЛЬ. Колонки $ и € заполняются, только если передан пересчёт.
// Ноль здесь утверждал бы, что счёт ничего не стоит; прочерк честно говорит «не знаем».

import { SECTION_TITLE } from "../../lib/ledgerView/accountRoles.js";
import { currencySymbol, formatAmountText, isNegative, NO_VALUE } from "../../lib/ledgerView/money.js";
import { sectionTotals } from "../../lib/ledgerView/registerRows.js";

const CELL = "px-3 py-2.5 align-middle whitespace-nowrap";
const HEAD = "px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap";

/** Денежная ячейка: число — tabular-nums, символ валюты приглушён отдельно. */
function MoneyCell({ raw, currency }) {
  const text = formatAmountText(raw, currency);
  if (text === NO_VALUE) return <span className="text-slate-400">{NO_VALUE}</span>;
  return (
    <span className={`tabular-nums font-semibold ${isNegative(raw) ? "text-rose-600" : "text-slate-900"}`}>
      {text}
      <span className="ml-1 font-normal text-slate-400">{currencySymbol(currency)}</span>
    </span>
  );
}

export function AccountsRegister({
  section,
  rows,
  /** (raw, currency) → сумма в долларах строкой, либо null. Нет функции — колонка в прочерках. */
  toUsd = null,
  /** (raw, currency) → сумма в евро строкой, либо null. */
  toEur = null,
  emptyText = "Счетов нет.",
  onOpenAccount = null,
}) {
  const totals = sectionTotals(rows);

  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
          {SECTION_TITLE[section] || "Счета"}
        </h2>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            {/* Ширины заданы один раз — иначе колонки разъезжаются между разделами. */}
            <colgroup>
              <col style={{ width: "132px" }} />
              <col style={{ width: "180px" }} />
              <col />
              <col style={{ width: "190px" }} />
              <col style={{ width: "150px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "120px" }} />
            </colgroup>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={`${HEAD} text-left`}>Номер</th>
                <th className={`${HEAD} text-left`}>Контрагент</th>
                <th className={`${HEAD} text-left`}>Наименование</th>
                <th className={`${HEAD} text-left`}>Тип</th>
                <th className={`${HEAD} text-right`}>Остаток</th>
                <th className={`${HEAD} text-left`}>Вал</th>
                <th className={`${HEAD} text-right`}>$</th>
                <th className={`${HEAD} text-right`}>€</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className={`${CELL} tabular-nums text-slate-900`}>
                    {onOpenAccount ? (
                      <button type="button" onClick={() => onOpenAccount(r)} className="text-sky-700 hover:underline">
                        {r.number}
                      </button>
                    ) : (
                      r.number
                    )}
                  </td>
                  <td className={`${CELL} text-slate-700 truncate`}>{r.counterparty}</td>
                  <td className={`${CELL} text-slate-900 truncate`}>{r.name}</td>
                  <td className={`${CELL} text-slate-600 truncate`}>{r.typeLabel}</td>
                  <td className={`${CELL} text-right`}>
                    <MoneyCell raw={r.presentedRaw} currency={r.currency} />
                  </td>
                  <td className={`${CELL} tabular-nums text-slate-600`}>{r.currency || NO_VALUE}</td>
                  <td className={`${CELL} text-right`}>
                    <MoneyCell raw={toUsd ? toUsd(r.presentedRaw, r.currency) : null} currency="USD" />
                  </td>
                  <td className={`${CELL} text-right`}>
                    <MoneyCell raw={toEur ? toEur(r.presentedRaw, r.currency) : null} currency="EUR" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        🔴 Итог — ПО ВАЛЮТАМ, отдельными строками. Единого «всего» здесь нет намеренно: валюты не
        складываются, а сумма по всем валютам — число, которого не существует.
      */}
      {rows.length > 0 && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-xs text-slate-500">{rows.length} счетов</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {totals.map((t) => (
              <span key={t.currency} className="text-sm">
                <span className="mr-1.5 text-xs text-slate-500">Итого</span>
                <MoneyCell raw={t.raw} currency={t.currency} />
              </span>
            ))}
          </span>
        </footer>
      )}
    </section>
  );
}

export default AccountsRegister;
