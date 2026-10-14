// src/pages/treasury_v2/tabs/RegisterTab.jsx
//
// «Счета» — единый реестр видом CoinPay. Заменяет три вкладки (Активы · Пассивы · Капитал).
//
// 🔴 ЗАЧЕМ ЗАМЕНИЛ, А НЕ ДОБАВИЛ. Те три были тремя ОТДЕЛЬНЫМИ компонентами на 1471 строку,
// каждый со своим набором колонок: у «Активов» колонка офиса, у «Капитала» своя «с учётом P&L»,
// у «Пассивов» третий набор. Одни и те же счета тремя разными способами — отсюда ощущение, что
// экран завален лишним.
//
// Канон CoinPay: Лоро, Ностро и кассы, Капитал выглядят ИДЕНТИЧНО — один компонент, один набор
// колонок, те же ширины и порядок; различаются ТОЛЬКО данные строк.
//
// 🔴 ИНСТРУМЕНТЫ ПЕРЕНЕСЕНЫ, А НЕ ВЫБРОШЕНЫ. Поиск, «Ненулевые» с запоминанием, выгрузка CSV,
// «+ Счёт в план» и карточка счёта жили в убранных вкладках. Выкинуть их вместе с дублирующей
// вёрсткой значило бы починить вид ценой работы — поэтому они здесь.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useLedger } from "../../../store/ledger.jsx";
import { useRates } from "../../../store/rates.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { convert } from "../../../utils/convert.js";
import { exportCSV } from "../../../utils/csv.js";
import { SECTION, SECTION_TITLE } from "../../../lib/ledgerView/accountRoles.js";
import { buildRegisterRows } from "../../../lib/ledgerView/registerRows.js";
import { formatAmountText, parseExact } from "../../../lib/ledgerView/money.js";
import AccountsRegister from "../../../components/finance/AccountsRegister.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import AccountDetailModal from "../parts/AccountDetailModal.jsx";

const ORDER = [SECTION.LORO, SECTION.NOSTRO, SECTION.CAPITAL];
const NONZERO_KEY = "coinplata:register-nonzero";

/** Ненулевой ли остаток — без float, по строке. */
function isNonZero(raw) {
  const p = parseExact(raw);
  return p ? /[1-9]/.test(p.int + p.frac) : false;
}

export default function RegisterTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { accounts, balances, loading, counterpartyName } = useLedger();
  const { getRate } = useRates();
  const can = useCan();
  const canAddAccount = can("accounting", "edit");

  const [section, setSection] = useState(SECTION.LORO);
  const [query, setQuery] = useState("");
  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try {
      return localStorage.getItem(NONZERO_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(NONZERO_KEY, nonZeroOnly ? "1" : "0");
    } catch {
      /* приватный режим — настройка просто не запомнится */
    }
  }, [nonZeroOnly]);

  // Защитный вызов: стор может не отдать резолвер имён (другой провайдер, тест, частичная
  // загрузка). Падать всей вкладкой из-за подписи контрагента нельзя — счета важнее имён.
  const names = useMemo(
    () => ({ get: (id) => (id && typeof counterpartyName === "function" ? counterpartyName(id) : null) }),
    [counterpartyName]
  );

  const rowsBySection = useMemo(() => {
    const out = {};
    for (const s of [...ORDER, SECTION.UNSORTED]) {
      out[s] = buildRegisterRows({ accounts, balances, names, section: s, officeFilter: ctx?.officeFilter });
    }
    return out;
  }, [accounts, balances, names, ctx?.officeFilter]);

  /**
   * Пересчёт в доллары и евро — их же `convert` по их же курсам. Второй источник курса означал
   * бы, что одна и та же сумма на соседних экранах стоит разных денег.
   *
   * 🔴 Курса нет → null, и колонка показывает прочерк. Ноль утверждал бы, что счёт ничего не
   * стоит: соврать приблизительным числом хуже, чем не показать.
   */
  const toCurrency = useCallback(
    (raw, from, to) => {
      if (!raw || !from) return null;
      const num = Number(raw);
      if (!Number.isFinite(num)) return null;
      const got = convert(num, from, to, getRate);
      if (got === null || got === undefined || !Number.isFinite(got)) return null;
      return String(got);
    },
    [getRate]
  );

  const toUsd = useCallback((raw, ccy) => toCurrency(raw, ccy, "USD"), [toCurrency]);
  const toEur = useCallback((raw, ccy) => toCurrency(raw, ccy, "EUR"), [toCurrency]);

  // «Не разнесено» — вкладка-сигнал: показывается ТОЛЬКО когда есть нераспознанные счета.
  // Пустая вкладка «всё хорошо» приучает её не замечать; непустая требует разбора.
  const tabs = rowsBySection[SECTION.UNSORTED].length > 0 ? [...ORDER, SECTION.UNSORTED] : ORDER;
  const current = tabs.includes(section) ? section : SECTION.LORO;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rowsBySection[current].filter((r) => {
      if (nonZeroOnly && !isNonZero(r.presentedRaw)) return false;
      if (!q) return true;
      return [r.number, r.counterparty, r.name, r.currency]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rowsBySection, current, query, nonZeroOnly]);

  const downloadCsv = useCallback(() => {
    exportCSV({
      filename: `accounts_${current}_${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "number", label: "Номер" },
        { key: "counterparty", label: "Контрагент" },
        { key: "name", label: "Наименование" },
        { key: "typeLabel", label: "Тип" },
        { key: "balance", label: "Остаток" },
        { key: "currency", label: "Валюта" },
      ],
      // 🔴 В выгрузке знаков столько же, сколько в ячейке на экране. В CoinPay копия жила своей
      // жизнью и делила на 100 при любой валюте: экран показывал «218,5224 ₮», а в файл уезжало
      // «21852,24» — в сто раз больше, и это уходило в банк.
      rows: visible.map((r) => ({
        number: r.number,
        counterparty: r.counterparty,
        name: r.name,
        typeLabel: r.typeLabel,
        balance: formatAmountText(r.presentedRaw, r.currency),
        currency: r.currency,
      })),
    });
  }, [visible, current]);

  return (
    <div className="space-y-4">
      {/* Разделы — пилюлями, как в CoinPay. Число счетов рядом: видно, где пусто, не открывая. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((s) => {
            const on = s === current;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSection(s)}
                className={`px-4 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
                  on
                    ? "bg-surface text-ink border border-line-2"
                    : s === SECTION.UNSORTED
                      ? "text-amber-700 border border-amber-300 hover:bg-amber-50"
                      : "text-ink-soft border border-transparent hover:bg-cream-2"
                }`}
              >
                {SECTION_TITLE[s]}
                <span className="ml-1.5 text-xs opacity-60">{rowsBySection[s].length}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по счёту и контрагенту"
              className="h-9 w-60 rounded-full border border-line-2 bg-surface pl-8 pr-3 text-[13px] outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => setNonZeroOnly((v) => !v)}
            className={`h-9 rounded-full border px-3 text-[13px] ${
              nonZeroOnly ? "border-line-2 bg-surface text-ink" : "border-transparent text-ink-soft hover:bg-cream-2"
            }`}
          >
            Ненулевые
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            title="Выгрузить видимые строки"
            className="h-9 rounded-full border border-line-2 bg-surface px-3 text-[13px]"
          >
            CSV
          </button>
          {canAddAccount && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-9 items-center gap-1 rounded-full bg-ink px-3 text-[13px] font-medium text-white"
            >
              <Plus className="h-4 w-4" /> Счёт в план
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="px-1 py-6 text-sm text-ink-soft">Загружаем счета…</p>
      ) : (
        <AccountsRegister
          section={current}
          rows={visible}
          toUsd={toUsd}
          toEur={toEur}
          onOpenAccount={(r) => setDetail(r)}
          emptyText={
            query || nonZeroOnly
              ? "Ничего не найдено — измените запрос или снимите «Ненулевые»."
              : current === SECTION.UNSORTED
                ? "Нераспознанных счетов нет — все разнесены по разделам."
                : "Счетов нет."
          }
        />
      )}

      {addOpen && (
        <ChartAccountModal
          open
          onClose={() => setAddOpen(false)}
          defaultType={current === SECTION.LORO ? "liability" : current === SECTION.CAPITAL ? "equity" : "asset"}
        />
      )}

      <AccountDetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        ctx={ctx}
        formatBase={formatBase}
        baseCurrency={baseCurrency}
        onOpenTx={onOpenTx}
        accountId={detail?.accountId || null}
      />
    </div>
  );
}
