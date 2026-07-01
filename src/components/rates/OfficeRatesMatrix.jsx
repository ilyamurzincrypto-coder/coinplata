// src/components/rates/OfficeRatesMatrix.jsx
// «Курсы по офисам (USDT-якоря)» — матрица: строки = направления USDT↔валюта,
// колонки = офисы, сгруппированные по странам. Тап по клетке → ввод курса
// (office override). Нал↔нал бот/касса считает через USDT-пивот — портянка не
// нужна, здесь только якоря. «—» = не задан для офиса.
//
// Данные/логика без изобретений: значение клетки — office override (getOverride),
// сохранение — onSave(officeId, from, to, rate) → rpcUpsertOfficeRate.

import React, { useMemo, useState } from "react";
import { freshnessOf, shortAge } from "../../utils/rateFreshness.jsx";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const ru = (n, dp) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const d = dp != null ? dp : Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 4 : 5;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: d });
};

// Страны — по city/name офиса (страновое поле в БД отсутствует).
const COUNTRIES = [
  { label: "🇹🇷 Турция", match: (o) => /antal|istanbul|стамбул|анталь|turkey|турец/i.test(`${o.city} ${o.name}`) },
  { label: "🇷🇺 Россия", match: (o) => /mosc|москв|питер|спб|spb|peterburg|petersburg|росси/i.test(`${o.city} ${o.name}`) },
];

// Порядок направлений (валюты против USDT, обе стороны).
const CCY_ORDER = ["TRY", "USD", "EUR", "RUB", "GBP", "CHF"];

function dot(state) {
  return state === "fresh" ? "bg-[#0c9c6b]" : state === "stale" ? "bg-[#c9a14a]" : "bg-[#aeb4bb]";
}

function Cell({ ovr, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const rate = ovr && Number.isFinite(ovr.rate) ? Number(ovr.rate) : null;

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        defaultValue={rate != null ? String(rate) : ""}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,-]/g, ""))}
        onBlur={() => {
          const n = Number(String(draft).replace(",", "."));
          if (draft !== "" && Number.isFinite(n) && n > 0 && n !== rate) onSave(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft("");
            setEditing(false);
          }
        }}
        className="w-[86px] bg-transparent border-0 border-b border-[#0c9c6b] rounded-none px-1 py-0.5 text-[12.5px] font-mono tabular-nums text-center outline-none"
      />
    );
  }

  if (rate == null) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full text-center text-[13px] text-[#cdd1de] hover:text-[#6a717a] py-1"
        title="Задать курс"
      >
        —
      </button>
    );
  }

  const { state, ageMs } = freshnessOf(ovr.updatedAt);
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="w-full flex flex-col items-center py-1 rounded-[6px] hover:bg-[rgba(18,22,26,0.03)] transition-colors"
      title="Тап — изменить"
    >
      <span className="font-mono tabular-nums text-[13px] text-[#15191d]">{ru(rate)}</span>
      {rate < 1 && (
        <span className="font-mono text-[9px] text-[#aeb4bb]">≈ {ru(1 / rate, 2)}</span>
      )}
      <span className="inline-flex items-center gap-1 mt-0.5 text-[8.5px] text-[#aeb4bb]">
        <span className={`w-[4px] h-[4px] rounded-full ${dot(state)}`} />
        {shortAge(ageMs)}
      </span>
    </button>
  );
}

export default function OfficeRatesMatrix({ offices, pairs, getOverride, onSave, onOpenPaste }) {
  // Колонки: офисы, сгруппированные по странам (+ «Другое» для несопоставленных).
  const groups = useMemo(() => {
    const used = new Set();
    const out = COUNTRIES.map((c) => {
      const list = (offices || []).filter((o) => c.match(o));
      list.forEach((o) => used.add(o.id));
      return { label: c.label, offices: list };
    }).filter((g) => g.offices.length > 0);
    const rest = (offices || []).filter((o) => !used.has(o.id));
    if (rest.length) out.push({ label: "Другое", offices: rest });
    return out;
  }, [offices]);
  const flatOffices = useMemo(() => groups.flatMap((g) => g.offices), [groups]);

  // Строки: направления USDT↔валюта (обе стороны), только существующие пары.
  const rows = useMemo(() => {
    const have = new Set((pairs || []).map((p) => `${p.from}_${p.to}`));
    const list = [];
    CCY_ORDER.forEach((c) => {
      if (have.has(`USDT_${c}`)) list.push(["USDT", c]);
      if (have.has(`${c}_USDT`)) list.push([c, "USDT"]);
    });
    // прочие USDT-пары, не попавшие в порядок
    (pairs || []).forEach((p) => {
      if ((p.from === "USDT" || p.to === "USDT") && !list.some(([a, b]) => a === p.from && b === p.to)) {
        list.push([p.from, p.to]);
      }
    });
    return list;
  }, [pairs]);

  if (!flatOffices.length) return <div className="text-caption text-muted py-6">Нет активных офисов</div>;

  const COL = "220px";
  const gridCols = `${COL} repeat(${flatOffices.length}, minmax(96px, 1fr))`;

  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="mb-2 text-[11.5px] text-[#6a717a] leading-snug max-w-[720px]">
        Задай курс <b className="text-[#15191d]">USDT ↔ валюта</b> для каждого офиса. Нал↔нал направления касса считает
        сама через USDT — портянка не нужна. Тап по клетке — ввод; «—» = не задан.
      </div>

      <div className="inline-block min-w-full align-top">
        {/* Шапка: страны */}
        <div className="grid items-end" style={{ gridTemplateColumns: gridCols }}>
          <span />
          {groups.map((g, gi) => (
            <div
              key={g.label}
              className={`text-center text-[11px] font-bold text-[#454a66] pb-1 ${gi > 0 ? "border-l border-[rgba(18,22,26,0.08)]" : ""}`}
              style={{ gridColumn: `span ${g.offices.length}` }}
            >
              {g.label}
            </div>
          ))}
        </div>
        {/* Шапка: офисы */}
        <div
          className="grid items-center pb-1.5 border-b border-[rgba(18,22,26,0.12)] text-[8.5px] font-bold uppercase tracking-[0.7px] text-[#aeb4bb]"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span className="pl-1">Направление</span>
          {flatOffices.map((o) => (
            <span key={o.id} className="text-center truncate px-1" title={o.name}>
              {o.name}
            </span>
          ))}
        </div>

        {/* Строки направлений */}
        {rows.map(([from, to]) => (
          <div
            key={`${from}_${to}`}
            className="grid items-center border-b border-[rgba(18,22,26,0.05)] hover:bg-[rgba(18,22,26,0.015)]"
            style={{ gridTemplateColumns: gridCols }}
          >
            <span className="flex items-center gap-1.5 pl-1 py-1.5 text-[12.5px] font-mono">
              <span className="font-bold text-[#15191d]">{from}</span>
              <span className="text-[#aeb4bb]">→</span>
              <span className="font-semibold text-[#6a717a]">{to}</span>
            </span>
            {flatOffices.map((o) => (
              <div key={o.id} className="px-1">
                <Cell
                  ovr={getOverride(o.id, from, to)}
                  onSave={(n) => onSave(o.id, from, to, n)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
