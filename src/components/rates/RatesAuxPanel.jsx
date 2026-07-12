// src/components/rates/RatesAuxPanel.jsx
// Вспомогательная панель справа от курсов (экран «Редактирование курсов»).
// Вкладки: Перестановки · Нерез · Конкуренты. Занимает пустую aux-область;
// ЛЕВУЮ колонку курсов не трогает. Данные — из существующих курсов (getRate) и
// фида ЦБ (cbr). Наценка перестановки, «Биржевой», снимки конкурентов — пробелы
// (пустое состояние / пометка), не выдумываем.
import React, { useState, useMemo } from "react";
import { ArrowLeftRight, Landmark, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { isPercentPair } from "../../utils/ratesFormat.js";

const fmt = (n, dp) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString("ru-RU", { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "—";

const TABS = [
  { id: "per", label: "Перестановки", Icon: ArrowLeftRight },
  { id: "ner", label: "Нерез", Icon: Landmark },
  { id: "comp", label: "Конкуренты", Icon: Users },
];

// ── Вкладка 1 — Перестановки ────────────────────────────────────────────────
// Вносим RUB в РФ-офисе → выдаём валюту в Турции через USDT.
// 1 CUR (RUB) = usdtPer(CUR, офис Турции) × rubPerUsdt(офис РФ). getRate кассы
// хранит «читаемые» значения (>1), ориентацию правим как в CrossRatesPanel.
const STRONG = new Set(["USD", "EUR"]); // котируются «USDT за X»
function usdtPer(cur, getRate, officeId) {
  if (cur === "USDT") return 1;
  const raw = Number(getRate?.("USDT", cur, officeId));
  if (!(raw > 0)) return NaN;
  if (isPercentPair("USDT", cur)) return 1 / raw;
  const readable = raw < 1 ? 1 / raw : raw;
  return STRONG.has(cur) ? readable : 1 / readable; // USDT за 1 CUR
}
function rubPerUsdt(getRate, officeId) {
  const raw = Number(getRate?.("USDT", "RUB", officeId));
  if (!(raw > 0)) return NaN;
  return raw < 1 ? 1 / raw : raw; // RUB за 1 USDT (>1)
}
function PerTab({ getRate, antRep, istRep, mskRep, spbRep }) {
  const TARGETS = [
    { cur: "TRY", flag: "🇹🇷" },
    { cur: "USD", flag: "🇺🇸" },
    { cur: "EUR", flag: "🇪🇺" },
  ];
  const RF = [["Москва", mskRep], ["Санкт-Петербург", spbRep]];
  const TR = [["Анталья", antRep], ["Стамбул", istRep]];
  const rubPer = (rfRep, trRep, cur) => {
    const up = usdtPer(cur, getRate, trRep?.id);
    const rp = rubPerUsdt(getRate, rfRep?.id);
    return up > 0 && rp > 0 ? up * rp : NaN; // наценка = 0 (пробел: конфига нет)
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-1"><ArrowLeftRight className="w-4 h-4 text-ink" /><span className="text-[15px] font-extrabold tracking-tight">Перестановки</span></div>
      <p className="text-caption text-muted-soft mb-3 leading-snug">Обмен между городами через USDT: вносите рубли в офисе РФ — получаете в офисе Турции.</p>
      {RF.map(([rfName, rfRep]) =>
        TR.map(([trName, trRep]) => (
          <div key={rfName + trName}>
            <div className="text-body-sm font-bold text-ink flex items-center gap-1.5 mt-3.5 mb-2 first:mt-1">
              {rfName} <ArrowLeftRight className="w-3 h-3 text-success" /> {trName}
            </div>
            {TARGETS.map(({ cur, flag }) => {
              const v = rubPer(rfRep, trRep, cur);
              return (
                <div key={cur} className="flex items-center gap-3 bg-surface-soft rounded-card px-3.5 py-2.5 mb-1.5">
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="w-7 h-7 rounded-full bg-white border border-border-soft flex items-center justify-center text-[15px]">🇷🇺</span>
                    <span className="text-muted-soft">→</span>
                    <span className="w-7 h-7 rounded-full bg-white border border-border-soft flex items-center justify-center text-[15px]">{flag}</span>
                  </span>
                  <span className="text-[8.5px] text-muted-soft uppercase">наличные</span>
                  <span className="flex-1" />
                  <span className="font-mono tabular-nums flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-[11px] text-muted-soft">1 {cur}</span>
                    <span className="text-[15px] font-extrabold text-success">{fmt(v, 4)}</span>
                    <span className="text-[11px] text-muted-soft">RUB</span>
                  </span>
                </div>
              );
            })}
          </div>
        ))
      )}
      <p className="text-caption text-muted-soft mt-3 pt-3 border-t border-border-soft leading-snug">
        Считается из курсов слева (RUB→USDT в РФ × USDT→валюта в Турции). <b className="text-muted">Наценка за перестановку пока не задана (0)</b> — нужен конфиг на бэке.
      </p>
    </div>
  );
}

// ── Вкладка 2 — Нерез (ЦБ РФ) ───────────────────────────────────────────────
function NerTab({ cbr, cbrAt }) {
  const PAIRS = [
    { cur: "USD", flag: "🇺🇸" },
    { cur: "EUR", flag: "🇪🇺" },
    { cur: "CNY", flag: "🇨🇳" },
    { cur: "AED", flag: "🇦🇪" }, // нет в cbr → «—»
    { cur: "TRY", flag: "🇹🇷" },
  ];
  const dt = cbrAt ? new Date(cbrAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <div>
      <div className="flex items-center gap-2 mb-1"><Landmark className="w-4 h-4 text-ink" /><span className="text-[15px] font-extrabold tracking-tight">Нерез · ЦБ РФ</span></div>
      <p className="text-caption text-muted-soft mb-3 leading-snug">Курсы ЦБ на {dt} МСК. Курс для сделки — по ЦБ.</p>
      <div className="grid text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft pb-1.5 px-1" style={{ gridTemplateColumns: "120px 1fr 1fr 1fr" }}>
        <span>Пара</span><span className="text-right">ЦБ РФ</span><span className="text-right">Биржевой</span><span className="text-right">Сделка</span>
      </div>
      {PAIRS.map(({ cur, flag }) => {
        const cb = cbr?.[`${cur}_RUB`];
        return (
          <div key={cur} className="grid items-center py-2.5 px-1 border-t border-border-soft" style={{ gridTemplateColumns: "120px 1fr 1fr 1fr" }}>
            <span className="font-bold text-body-sm flex items-center gap-2">{flag} {cur}/RUB</span>
            <span className="text-right font-mono tabular-nums text-body-sm text-muted">{cb != null ? fmt(cb, 4) : "—"}</span>
            <span className="text-right font-mono tabular-nums text-body-sm text-muted-soft">—</span>
            <span className="text-right font-mono tabular-nums text-body-sm font-extrabold text-success">
              {cb != null ? fmt(cb, 4) : "—"}<span className="text-[8.5px] font-sans font-bold text-success ml-1">ЦБ</span>
            </span>
          </div>
        );
      })}
      <p className="text-caption text-muted-soft mt-3 pt-3 border-t border-border-soft leading-snug">
        Для нерезидентских переводов. Не путать со спец-курсами СБП/НЕРЕЗ (TOD/TOM) внизу страницы — там Paramon.
        {" "}<b className="text-muted">AED/RUB и «Биржевой» — источника пока нет.</b>
      </p>
    </div>
  );
}

// ── Вкладка 3 — Конкуренты (снимки по датам) ────────────────────────────────
function CompTab({ snapshots }) {
  const dates = useMemo(() => Object.keys(snapshots || {}), [snapshots]);
  const today = dates[0];
  const [date, setDate] = useState(today);
  const i = dates.indexOf(date);
  const snap = snapshots?.[date];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-ink" /><span className="text-[15px] font-extrabold tracking-tight">Конкуренты</span>
          {date && date !== today && <span className="text-[10.5px] font-bold text-warning bg-warning-soft rounded-md px-2 py-0.5">архив</span>}
        </div>
        <div className="inline-flex items-center gap-1 bg-surface-soft rounded-card p-1">
          <button type="button" disabled={i >= dates.length - 1} onClick={() => setDate(dates[i + 1])} className="w-6 h-6 rounded-button flex items-center justify-center text-muted hover:bg-white disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-caption font-bold text-ink px-2">{date || "—"}</span>
          <button type="button" disabled={i <= 0} onClick={() => setDate(dates[i - 1])} className="w-6 h-6 rounded-button flex items-center justify-center text-muted hover:bg-white disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      {!snap ? (
        <div className="rounded-card border border-dashed border-border-soft py-10 text-center text-body-sm text-muted-soft">
          Снимки котировок конкурентов ещё не заведены.<br />
          <span className="text-caption">Нужно хранилище снимков по датам + ввод/парсинг их сообщений (задача на бэк).</span>
        </div>
      ) : (
        <CompTable snap={snap} />
      )}
      <p className="text-caption text-muted-soft mt-3 pt-3 border-t border-border-soft leading-snug">
        Δ — насколько наш курс отличается от конкурента. «Наш» — из курсов слева, «Конкурент» — из снимка за дату.
      </p>
    </div>
  );
}
function CompTable({ snap }) {
  const Delta = ({ ours, comp }) => {
    if (typeof ours !== "number" || typeof comp !== "number") return <td className="text-right font-mono text-muted-soft">—</td>;
    const d = ours - comp;
    return <td className={`text-right font-mono tabular-nums font-bold ${d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-muted-soft"}`}>{d > 0 ? "+" : ""}{fmt(d, 2)}</td>;
  };
  const Sec = ({ title, rows, dp }) => (
    <>
      <tr><td colSpan={4} className="text-[9.5px] font-bold uppercase tracking-wide text-muted-soft pt-3">{title}</td></tr>
      {rows.map((r, k) => (
        <tr key={k}>
          <td className="font-mono font-semibold text-body-sm py-1.5">{r.pair}</td>
          <td className="text-right font-mono tabular-nums text-body-sm font-extrabold text-success py-1.5">{typeof r.ours === "number" ? fmt(r.ours, dp) : r.ours ?? "—"}</td>
          <td className="text-right font-mono tabular-nums text-body-sm text-muted py-1.5">{typeof r.comp === "number" ? fmt(r.comp, dp) : r.comp ?? "—"}</td>
          <Delta ours={r.ours} comp={r.comp} />
        </tr>
      ))}
    </>
  );
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft">
          <th className="text-left pb-1.5">Пара</th><th className="text-right pb-1.5">Наш</th><th className="text-right pb-1.5">Конкурент</th><th className="text-right pb-1.5">Δ</th>
        </tr>
      </thead>
      <tbody>
        {snap.cash?.length > 0 && <Sec title="Наличные" rows={snap.cash} dp={2} />}
        {snap.crypto?.length > 0 && <Sec title="Крипта" rows={snap.crypto} dp={4} />}
      </tbody>
    </table>
  );
}

// ── Панель ──────────────────────────────────────────────────────────────────
export default function RatesAuxPanel({ getRate, antRep, istRep, mskRep, spbRep, cbr, cbrAt, competitorSnapshots }) {
  const [tab, setTab] = useState("per");
  return (
    <div className="bg-white border border-border-soft rounded-card overflow-hidden sticky top-4">
      <div className="flex gap-0.5 px-2.5 pt-2 border-b border-border-soft">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-body-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === id ? "text-success border-success" : "text-muted border-transparent hover:text-ink"
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      <div className="p-4 overflow-auto" style={{ maxHeight: "calc(100vh - 150px)" }}>
        {tab === "per" && <PerTab getRate={getRate} antRep={antRep} istRep={istRep} mskRep={mskRep} spbRep={spbRep} />}
        {tab === "ner" && <NerTab cbr={cbr} cbrAt={cbrAt} />}
        {tab === "comp" && <CompTab snapshots={competitorSnapshots || {}} />}
      </div>
    </div>
  );
}
