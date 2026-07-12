// src/components/rates/RatesAuxPanel.jsx
// Вспомогательная панель справа от курсов (экран «Редактирование курсов»).
// Вкладки: Перестановки · Нерез · Конкуренты. Занимает пустую aux-область;
// ЛЕВУЮ колонку курсов не трогает. Данные — из существующих курсов (getRate) и
// фида ЦБ (cbr). Наценка перестановки, «Биржевой», снимки конкурентов — пробелы
// (пустое состояние / пометка), не выдумываем.
import React, { useState, useMemo } from "react";
import { ArrowLeftRight, Landmark, Users, ChevronLeft, ChevronRight, ChevronDown, RotateCcw } from "lucide-react";
import { isPercentPair } from "../../utils/ratesFormat.js";

const fmt = (n, dp) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString("ru-RU", { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "—";
const pnum = (v) => {
  const x = String(v).replace(/[^0-9.,-]/g, "").replace(/(?!^)-/g, "").replace(",", ".");
  const n = parseFloat(x);
  return Number.isNaN(n) ? 0 : n;
};

// Наценка перестановки, % по строке — переживает переоткрытие (localStorage).
const MARKUP_KEY = "per_markup_v1";
const readMarkups = () => { try { return JSON.parse(localStorage.getItem(MARKUP_KEY) || "{}") || {}; } catch { return {}; } };
const writeMarkups = (m) => { try { localStorage.setItem(MARKUP_KEY, JSON.stringify(m)); } catch { /* noop */ } };

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
const Chip = ({ children }) => (
  <span className="w-6 h-6 rounded-full bg-white border border-border-soft flex items-center justify-center text-[13px] shrink-0">{children}</span>
);
// Категоризация офисов по региону (масштабируется: по городу/стране/названию).
const isRF = (o) => /росс|москв|moscow|питер|петербург|санкт|\bспб\b|st\.?\s?p|\bru\b/i.test(`${o?.city || ""} ${o?.country || ""} ${o?.name || ""}`);
const isTR = (o) => /турц|антал|antalya|стамбул|istanbul|turkey|\btr\b|liman|terra|mark antalya/i.test(`${o?.city || ""} ${o?.country || ""} ${o?.name || ""}`);
const officeLabel = (o) => `${o?.name || "?"}${o?.city ? ` · ${o.city}` : ""}`;
// Реверс-анкоры (обратное направление): офис ПРИНИМАЕТ валюту/отдаёт RUB.
function usdtPerRev(cur, getRate, officeId) {
  if (cur === "USDT") return 1;
  const raw = Number(getRate?.(cur, "USDT", officeId)); // CUR→USDT (офис покупает CUR)
  if (!(raw > 0)) return NaN;
  if (isPercentPair(cur, "USDT")) return raw;
  const readable = raw < 1 ? 1 / raw : raw;
  return STRONG.has(cur) ? readable : 1 / readable;
}
function rubPerUsdtRev(getRate, officeId) {
  const raw = Number(getRate?.("RUB", "USDT", officeId)); // RUB→USDT
  if (!(raw > 0)) return NaN;
  return raw < 1 ? 1 / raw : raw;
}
const TARGETS = [
  { cur: "TRY", flag: "🇹🇷", dp2: 2 },
  { cur: "USD", flag: "🇺🇸", dp2: 4 },
  { cur: "EUR", flag: "🇪🇺", dp2: 4 },
];
function OfficeSelect({ label, offices, value, onChange }) {
  return (
    <div className="flex-1 min-w-[160px]">
      <div className="text-[9px] font-bold uppercase tracking-wide text-muted-soft mb-1">{label}</div>
      <div className="relative">
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none w-full h-10 bg-white border border-border-soft focus:border-accent focus:ring-2 focus:ring-accent/15 rounded-card pl-3 pr-9 text-body font-semibold text-ink outline-none cursor-pointer truncate"
        >
          <option value="">— Все офисы —</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>{officeLabel(o)}</option>
          ))}
        </select>
        <ChevronDown className="w-4 h-4 text-muted-soft absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
}
// Одна строка направления (fwd: РФ→Турция вносим RUB; rev: Турция→РФ вносим валюту).
function PerRow({ dir, rf, tr, cur, flag, dp2, getRate, markups, setMarkup }) {
  const key = `${dir}:${rf?.id}:${tr?.id}:${cur}`;
  const mkStr = markups[key];
  const mk = pnum(mkStr ?? 0);
  const usdtP = dir === "fwd" ? usdtPer(cur, getRate, tr?.id) : usdtPerRev(cur, getRate, tr?.id); // USDT за 1 CUR
  const rubP = dir === "fwd" ? rubPerUsdt(getRate, rf?.id) : rubPerUsdtRev(getRate, rf?.id); // RUB за 1 USDT
  const b = usdtP > 0 && rubP > 0 ? usdtP * rubP : NaN;
  const v = Number.isFinite(b) ? b * (1 + mk / 100) : NaN;
  const legCur = usdtP > 0 ? 1 / usdtP : NaN; // валюта за 1 USDT
  const legRub = rubP; // RUB за 1 USDT
  const arrow = (val, dp) => (
    <span className="inline-flex items-center gap-1 text-muted-soft">→<span className="text-muted tabular-nums font-normal">{fmt(val, dp)}</span>→</span>
  );
  return (
    <div className="flex items-center gap-3 bg-surface-soft rounded-card px-3.5 py-2.5 mb-1.5">
      <span className="flex items-center gap-1.5 shrink-0 font-mono text-[10.5px] font-semibold text-ink">
        {dir === "fwd" ? (
          <>
            <Chip>🇷🇺</Chip>RUB{arrow(legRub, 2)}<Chip><span className="text-success font-bold">₮</span></Chip>USDT{arrow(legCur, dp2)}<Chip>{flag}</Chip>{cur}
          </>
        ) : (
          <>
            <Chip>{flag}</Chip>{cur}{arrow(legCur, dp2)}<Chip><span className="text-success font-bold">₮</span></Chip>USDT{arrow(legRub, 2)}<Chip>🇷🇺</Chip>RUB
          </>
        )}
      </span>
      <span className="text-[8.5px] text-muted-soft uppercase hidden xl:inline">наличные</span>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-muted-soft uppercase tracking-wide">наценка за&nbsp;перестановку</span>
        <input
          value={mkStr ?? "0"}
          onChange={(e) => setMarkup(key, e.target.value)}
          inputMode="decimal"
          className="w-[44px] bg-white border border-border-soft rounded-button h-7 px-1.5 font-mono tabular-nums text-[12px] text-right outline-none focus:border-accent"
          title="Наценка за перестановку, %"
        />
        <span className="text-[11px] text-muted-soft">%</span>
      </span>
      <span className="font-mono tabular-nums flex items-baseline gap-1.5 whitespace-nowrap min-w-[150px] justify-end">
        <span className="text-[11px] text-muted-soft">1 {cur}</span>
        <span className="text-[15px] font-extrabold text-success">{fmt(v, 4)}</span>
        <span className="text-[11px] text-muted-soft">RUB</span>
      </span>
    </div>
  );
}
function PerTab({ getRate, offices }) {
  const rfOffices = useMemo(() => (offices || []).filter(isRF), [offices]);
  const trOffices = useMemo(() => (offices || []).filter(isTR), [offices]);
  const [rfId, setRfId] = useState(""); // "" = все
  const [trId, setTrId] = useState("");
  const rfList = rfId ? rfOffices.filter((o) => o.id === rfId) : rfOffices;
  const trList = trId ? trOffices.filter((o) => o.id === trId) : trOffices;
  const [markups, setMarkups] = useState(readMarkups);
  const setMarkup = (key, val) => setMarkups((m) => { const n = { ...m, [key]: val }; writeMarkups(n); return n; });
  return (
    <div>
      <div className="flex items-center gap-2 mb-1"><ArrowLeftRight className="w-4 h-4 text-ink" /><span className="text-[15px] font-extrabold tracking-tight">Перестановки</span></div>
      <p className="text-caption text-muted-soft mb-3 leading-snug">Обмен между городами через USDT. Оба направления: <b className="text-muted">РФ→Турция</b> (вносите RUB) и <b className="text-muted">Турция→РФ</b> (вносите валюту).</p>
      <div className="flex items-end gap-2.5 mb-4">
        <OfficeSelect label="Офис РФ (рубли)" offices={rfOffices} value={rfId} onChange={setRfId} />
        <ArrowLeftRight className="w-4 h-4 text-success shrink-0 mb-3" />
        <OfficeSelect label="Офис Турции" offices={trOffices} value={trId} onChange={setTrId} />
        <button
          type="button"
          onClick={() => { setRfId(""); setTrId(""); }}
          className="shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-card border border-border-soft text-body-sm font-semibold text-muted hover:text-ink hover:bg-surface-soft transition-colors"
          title="Показать все офисы"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Сброс
        </button>
      </div>
      {rfList.length === 0 || trList.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-soft py-8 text-center text-body-sm text-muted-soft">Нет офисов РФ и/или Турции.</div>
      ) : (
        rfList.map((rf) =>
          trList.map((tr) => (
            <div key={rf.id + tr.id} className="mb-2">
              <div className="text-body-sm font-bold text-ink flex items-center gap-1.5 mt-3.5 mb-2 first:mt-1">
                {rf.name} <span className="text-success">→</span> {tr.name}
              </div>
              {TARGETS.map((t) => <PerRow key={"f" + t.cur} dir="fwd" rf={rf} tr={tr} {...t} getRate={getRate} markups={markups} setMarkup={setMarkup} />)}
              <div className="text-body-sm font-bold text-ink flex items-center gap-1.5 mt-3 mb-2">
                {tr.name} <span className="text-success">→</span> {rf.name} <span className="text-[9px] text-muted-soft uppercase font-semibold">обратно</span>
              </div>
              {TARGETS.map((t) => <PerRow key={"r" + t.cur} dir="rev" rf={rf} tr={tr} {...t} getRate={getRate} markups={markups} setMarkup={setMarkup} />)}
            </div>
          ))
        )
      )}
      <p className="text-caption text-muted-soft mt-3 pt-3 border-t border-border-soft leading-snug">
        Считается из курсов слева (через USDT) + наценка %. Обратное направление берёт обратные курсы офисов. Наценки — локально; серверного конфига пока нет.
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
export default function RatesAuxPanel({ getRate, offices, cbr, cbrAt, competitorSnapshots }) {
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
        {tab === "per" && <PerTab getRate={getRate} offices={offices} />}
        {tab === "ner" && <NerTab cbr={cbr} cbrAt={cbrAt} />}
        {tab === "comp" && <CompTab snapshots={competitorSnapshots || {}} />}
      </div>
    </div>
  );
}
