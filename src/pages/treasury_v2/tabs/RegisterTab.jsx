// src/pages/treasury_v2/tabs/RegisterTab.jsx
//
// «Реестр» — счета видом CoinPay.
//
// 🔴 ЗАЧЕМ ЭТО, КОГДА РЯДОМ УЖЕ ЕСТЬ АКТИВЫ/ПАССИВЫ/КАПИТАЛ. Те три вкладки — три ОТДЕЛЬНЫХ
// компонента на 1471 строку, каждый со своим набором колонок: у «Активов» есть колонка офиса,
// у «Капитала» своя «с учётом P&L», у «Пассивов» третий набор. Одно и то же — три разных вида,
// и именно отсюда ощущение «лишних полей».
//
// Канон CoinPay: Лоро, Ностро и кассы, Капитал обязаны выглядеть ИДЕНТИЧНО — один компонент,
// один набор колонок, те же ширины и порядок; различаются ТОЛЬКО данные строк. Здесь так и
// сделано: разделы переключаются, таблица одна.
//
// Старые вкладки намеренно НЕ тронуты: их можно открыть рядом и сравнить. Заменять рабочие
// экраны вслепую, пока новый не принят глазами, — не тот размен.

import React, { useMemo, useState } from "react";
import { useLedger } from "../../../store/ledger.jsx";
import { SECTION, SECTION_TITLE } from "../../../lib/ledgerView/accountRoles.js";
import { buildRegisterRows } from "../../../lib/ledgerView/registerRows.js";
import AccountsRegister from "../../../components/finance/AccountsRegister.jsx";

/** Порядок разделов — как в CoinPay. «Не разнесено» показывается, только если там что-то есть. */
const ORDER = [SECTION.LORO, SECTION.NOSTRO, SECTION.CAPITAL];

export default function RegisterTab({ onOpenAccount = null }) {
  const { accounts, balances, loading, counterpartyName } = useLedger();
  const [section, setSection] = useState(SECTION.LORO);

  // Имена контрагентов — та же функция, что у остальных вкладок: вторая правда об именах
  // означала бы, что один клиент в разных разделах называется по-разному.
  const names = useMemo(
    () => ({ get: (id) => (id ? counterpartyName(id) : null) }),
    [counterpartyName]
  );

  const rowsBySection = useMemo(() => {
    const out = {};
    for (const s of [...ORDER, SECTION.UNSORTED]) {
      out[s] = buildRegisterRows({ accounts, balances, names, section: s });
    }
    return out;
  }, [accounts, balances, names]);

  // «Не разнесено» — вкладка-сигнал: появляется ТОЛЬКО когда есть нераспознанные счета.
  // Пустая вкладка «всё хорошо» приучает её не замечать, а непустая требует разбора.
  const tabs = rowsBySection[SECTION.UNSORTED].length > 0 ? [...ORDER, SECTION.UNSORTED] : ORDER;
  const current = tabs.includes(section) ? section : SECTION.LORO;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {tabs.map((s) => {
          const on = s === current;
          const count = rowsBySection[s].length;
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
              <span className="ml-1.5 text-xs opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="px-1 py-6 text-sm text-slate-500">Загружаем счета…</p>
      ) : (
        <AccountsRegister
          section={current}
          rows={rowsBySection[current]}
          onOpenAccount={onOpenAccount}
          emptyText={
            current === SECTION.UNSORTED
              ? "Нераспознанных счетов нет — все разнесены по разделам."
              : "Счетов нет."
          }
        />
      )}

      {/*
        Курсы в колонки $ и € ещё не подключены, и колонки честно стоят в прочерках.
        🔴 Ноль там означал бы «счёт ничего не стоит» — соврать приблизительным числом хуже,
        чем не показать.
      */}
      <p className="px-1 text-xs text-slate-500">
        Колонки $ и € заполнятся, когда будет подключён пересчёт по курсу. Пока там прочерк —
        это «курса нет», а не «ноль».
      </p>
    </div>
  );
}
