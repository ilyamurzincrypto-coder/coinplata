// src/components/rates/RatesAuxPanel.jsx
// Вспомогательная панель справа от курсов (экран «Редактирование курсов»).
// Вкладки: Перестановки · Нерез · Конкуренты. Занимает пустую aux-область;
// ЛЕВУЮ колонку курсов не трогает. Данные — из курсов (getRate) и фида ЦБ (cbr).
//
// Перестановки (v2, 2026-07-15): валюта офиса берётся из timezone (структурное
// поле офиса), НЕ угадывается по названию. Пара — только РАЗНЫЕ страны. Цель —
// локальная валюта ПРИНИМАЮЩЕГО офиса (не список FIATS, как в старой версии,
// которая давала RUB→USD/EUR мусор).
import React, { useState, useMemo } from "react";
import { Landmark, Users, ChevronLeft, ChevronRight, ArrowLeftRight, ChevronDown, RotateCcw } from "lucide-react";
import { usdtPer } from "../../lib/rates.js";

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
// Локальная (наличная) валюта офиса — из timezone (структурное поле), а не из
// угадывания по имени. Новую страну → добавить её зону сюда. Неизвестная зона →
// офис не участвует в перестановках (НЕ подставляем USD-дефолт — это был баг).
const TZ_CCY = { "Europe/Moscow": "RUB", "Europe/Istanbul": "TRY" };
const officeCurrency = (o) => TZ_CCY[o?.timezone] ?? null;
// Виртуальный «международный» офис (город Worldwide) не наличный и не привязан к
// стране — в перестановках между странами не участвует. Реальные офисы имеют город.
const isPhysicalOffice = (o) => !!o?.city && o.city.trim().toLowerCase() !== "worldwide";
const CCY_META = {
  RUB: { flag: "🇷🇺", dp: 2 }, TRY: { flag: "🇹🇷", dp: 2 },
  USD: { flag: "🇺🇸", dp: 4 }, EUR: { flag: "🇪🇺", dp: 4 },
};
const dpOf = (c) => CCY_META[c]?.dp ?? 2;

const MARKUP_KEY = "per_markup_v1";
const readMarkups = () => { try { return JSON.parse(localStorage.getItem(MARKUP_KEY) || "{}") || {}; } catch { return {}; } };
const writeMarkups = (m) => { try { localStorage.setItem(MARKUP_KEY, JSON.stringify(m)); } catch { /* noop */ } };
const pnum = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const officeLabel = (o) => `${o?.name || "?"}${o?.city ? ` · ${o.city}` : ""}`;

const Chip = ({ children }) => (
  <span className="w-6 h-6 rounded-full bg-white border border-border-soft flex items-center justify-center text-[13px] shrink-0">{children}</span>
);

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

// Табличная сетка перестановок: получатель · цепочка · наценка · курс — одни и те
// же колонки во всех строках И в шапке (см. PerTab). На узком экране строка
// переполняет контейнер → горизонтальный скролл (панель overflow-auto).
const PER_GRID = { gridTemplateColumns: "minmax(170px,210px) minmax(300px,1fr) 116px minmax(150px,166px)" };

// Одна строка внутри группы отправителя: получаешь в офисе {receiver}.
// 1 {fromCur} → {rate} {toCur}, через USDT (курс офиса-отправителя и получателя).
// Ориентация к USDT — общий usdtPer из lib/rates (импорт, не копия — B2/B3).
function PerRow({ sender, receiver, fromCur, toCur, getRate, markups, setMarkup }) {
  const key = `${sender.id}:${receiver.id}:${fromCur}:${toCur}`;
  const mkStr = markups[key];
  const mk = pnum(mkStr ?? 0);
  const uFrom = usdtPer(fromCur, getRate, sender.id); // USDT за 1 fromCur (отправитель)
  const uTo = usdtPer(toCur, getRate, receiver.id);   // USDT за 1 toCur (получатель)
  const base = uFrom > 0 && uTo > 0 ? uFrom / uTo : NaN; // toCur за 1 fromCur
  const v = Number.isFinite(base) ? base * (1 + mk / 100) : NaN;
  const fromPerUsdt = uFrom > 0 ? 1 / uFrom : NaN;
  const toPerUsdt = uTo > 0 ? 1 / uTo : NaN;
  const arrow = (val, dp) => (
    <span className="inline-flex items-center gap-1 text-muted-soft">→<span className="text-muted tabular-nums font-normal">{fmt(val, dp)}</span>→</span>
  );
  return (
    <div className="grid items-center gap-3 bg-surface-soft rounded-card px-3.5 py-2.5 mb-1.5" style={PER_GRID}>
      {/* Получатель */}
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-muted-soft text-[13px]">→</span>
        <span className="font-bold text-body-sm text-ink truncate">{receiver.name}</span>
        {receiver.city ? <span className="text-[10px] text-muted-soft whitespace-nowrap hidden lg:inline">· {receiver.city}</span> : null}
      </span>
      {/* Цепочка через USDT */}
      <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold text-ink min-w-0 whitespace-nowrap overflow-hidden">
        <Chip>{CCY_META[fromCur]?.flag}</Chip>{fromCur}{arrow(fromPerUsdt, dpOf(fromCur))}<Chip><span className="text-success font-bold">₮</span></Chip>USDT{arrow(toPerUsdt, dpOf(toCur))}<Chip>{CCY_META[toCur]?.flag}</Chip>{toCur}
      </span>
      {/* Наценка */}
      <span className="flex items-center gap-1.5">
        <input
          value={mkStr ?? "0"}
          onChange={(e) => setMarkup(key, e.target.value)}
          inputMode="decimal"
          className="w-[44px] bg-white border border-border-soft rounded-button h-7 px-1.5 font-mono tabular-nums text-[12px] text-right outline-none focus:border-accent"
          title="Наценка за перестановку, %"
        />
        <span className="text-[11px] text-muted-soft">%</span>
      </span>
      {/* Курс */}
      <span className="font-mono tabular-nums flex items-baseline gap-1.5 whitespace-nowrap justify-self-end">
        <span className="text-[11px] text-muted-soft">1 {fromCur}</span>
        <span className="text-[15px] font-extrabold text-success">{fmt(v, dpOf(toCur))}</span>
        <span className="text-[11px] text-muted-soft">{toCur}</span>
      </span>
    </div>
  );
}

// Порядок групп: РФ-отправители (RUB) сверху — чаще шлют из РФ; турецкие (TRY) ниже.
const SENDER_CCY_ORDER = { RUB: 0, TRY: 1 };

function PerTab({ getRate, offices }) {
  // Все офисы с распознаваемой валютой (вкл. закрытые — напр. Питер): перестановки
  // считаются и для сезонно закрытых офисов. Валюта — из timezone.
  const all = useMemo(() => offices || [], [offices]);
  const [aId, setAId] = useState(""); // отправитель
  const [bId, setBId] = useState(""); // получатель
  const [markups, setMarkups] = useState(readMarkups);
  const setMarkup = (key, val) => setMarkups((m) => { const n = { ...m, [key]: val }; writeMarkups(n); return n; });
  const withCcy = useMemo(
    () => all.filter(isPhysicalOffice).map((o) => ({ o, ccy: officeCurrency(o) })).filter((x) => x.ccy),
    [all]
  );
  // Группировка ПО ОФИСУ-ОТПРАВИТЕЛЮ: «Внёс в S» → все офисы-получатели другой
  // страны. РФ-отправители сверху, турецкие ниже; внутри — активные раньше, по имени.
  const groups = useMemo(() => {
    const senders = aId ? withCcy.filter((x) => x.o.id === aId) : withCcy;
    return senders
      .map((s) => ({
        s,
        targets: withCcy.filter(
          (t) => t.o.id !== s.o.id && t.ccy !== s.ccy && (!bId || t.o.id === bId)
        ),
      }))
      .filter((g) => g.targets.length > 0)
      .sort((g1, g2) => {
        const c = (SENDER_CCY_ORDER[g1.s.ccy] ?? 9) - (SENDER_CCY_ORDER[g2.s.ccy] ?? 9);
        if (c) return c;
        const act = (g1.s.o.active !== false ? 0 : 1) - (g2.s.o.active !== false ? 0 : 1);
        if (act) return act;
        return (g1.s.o.name || "").localeCompare(g2.s.o.name || "", "ru");
      });
  }, [withCcy, aId, bId]);
  return (
    <div>
      <div className="flex items-center gap-2 mb-1"><ArrowLeftRight className="w-4 h-4 text-ink" /><span className="text-[15px] font-extrabold tracking-tight">Перестановки</span></div>
      <p className="text-caption text-muted-soft mb-3 leading-snug">Обмен между офисами <b className="text-muted">разных стран</b> через USDT: вносишь наличные в одном — получаешь в другом. Сгруппировано по офису-отправителю. Валюта офиса — по его часовому поясу.</p>
      <div className="flex items-end gap-2.5 mb-4">
        <OfficeSelect label="Отправитель" offices={all} value={aId} onChange={setAId} />
        <ArrowLeftRight className="w-4 h-4 text-success shrink-0 mb-3" />
        <OfficeSelect label="Получатель" offices={all} value={bId} onChange={setBId} />
        <button
          type="button"
          onClick={() => { setAId(""); setBId(""); }}
          className="shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-card border border-border-soft text-body-sm font-semibold text-muted hover:text-ink hover:bg-surface-soft transition-colors"
          title="Показать все офисы"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Сброс
        </button>
      </div>
      {groups.length > 0 && (
        <div className="grid items-center gap-3 px-3.5 pb-1.5 text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft" style={PER_GRID}>
          <span>Получаешь в офисе</span>
          <span>Через USDT</span>
          <span>Наценка</span>
          <span className="justify-self-end">Курс</span>
        </div>
      )}
      {groups.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-soft py-8 text-center text-body-sm text-muted-soft">Нет офисов из разных стран.</div>
      ) : (
        groups.map(({ s, targets }) => (
          <div key={s.o.id} className="mb-3 pb-2 border-b border-border-soft last:border-0">
            <div className="text-body-sm font-extrabold text-ink flex items-center gap-1.5 mb-2 first:mt-0">
              <span className="text-[9px] text-muted-soft uppercase font-semibold">внёс в</span>
              {s.o.name}
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-muted">{CCY_META[s.ccy]?.flag} {s.ccy}</span>
              <span className="text-success">→</span>
            </div>
            {targets.map((t) => (
              <PerRow
                key={t.o.id}
                sender={s.o}
                receiver={t.o}
                fromCur={s.ccy}
                toCur={t.ccy}
                getRate={getRate}
                markups={markups}
                setMarkup={setMarkup}
              />
            ))}
          </div>
        ))
      )}
      <p className="text-caption text-muted-soft mt-3 pt-3 border-t border-border-soft leading-snug">
        Считается из курсов слева (через USDT) + наценка %. Наценки — локально; серверного конфига пока нет.
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
