// src/components/rates/RatesControlPanel.jsx
// Панель управления курсами (касса = источник). Три блока по макету rates-control:
//   1. Нал (Tolunay)      — global pairs, market+маржа (копейки), обе стороны, единый для Ант/Ист.
//   2. USDT · Турция      — office_rate_overrides per-city (Анталья/Стамбул); USD↔USDT в %, прочее абс.
//   3. USDT · Россия      — office_rate_overrides RU (МСК/СПБ); Rapira-цена + оверрайд + ↻; спред в копейках.
// Локальное состояние; «Опубликовать» коммитит всё через существующие RPC (см. RatesPage).
// Данные/фиды — из движка кассы (Tolunay/Rapira → external_rates, pairs, overrides).
import React, { useState, useMemo, useCallback } from "react";
import { Loader2, Globe, Lock, Unlock } from "lucide-react";
import { officeCityCode } from "../../lib/rapiraSpreads.js";

// Замки зафиксированных итоговых цен (переживают переоткрытие панели).
const LOCKS_KEY = "rates_control_locks_v1";
function readLocks() {
  try { return JSON.parse(localStorage.getItem(LOCKS_KEY) || "{}") || {}; } catch { return {}; }
}
function writeLocks(m) {
  try { localStorage.setItem(LOCKS_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

const fmt = (n, dp) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString("ru-RU", { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "—";
const pnum = (v) => {
  const x = String(v).replace(/[^0-9.,-]/g, "").replace(/(?!^)-/g, "").replace(",", ".");
  const n = parseFloat(x);
  return Number.isNaN(n) ? 0 : n;
};
const pint = (v) => {
  const x = String(v).replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "");
  const n = parseInt(x, 10);
  return Number.isNaN(n) ? 0 : n;
};

// ── shared bits (дизайн кассы) ─────────────────────────────────────────────
function Card({ title, badge, badgeColor, fresh, children, hint }) {
  return (
    <div className="w-[360px] shrink-0 bg-white border border-border-soft rounded-card overflow-hidden shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-soft">
        <span className="text-body-sm font-bold text-ink">{title}</span>
        {badge && (
          <span className="inline-flex items-center gap-1 text-tiny font-semibold text-muted">
            <span className={`w-1.5 h-1.5 rounded-full ${badgeColor}`} /> {badge}
          </span>
        )}
        {fresh && <span className="ml-auto text-[9px] text-muted-soft tabular-nums">{fresh}</span>}
      </div>
      {children}
      {hint && <div className="px-3.5 py-2 text-[10px] leading-relaxed text-muted-soft">{hint}</div>}
    </div>
  );
}
const cellIn =
  "border border-border-soft rounded-[6px] h-[27px] px-1.5 font-mono tabular-nums text-[12px] text-right outline-none text-ink bg-white focus:border-accent focus:ring-2 focus:ring-accent/15";

// ── Блок 1 — Нал (Tolunay) ─────────────────────────────────────────────────
const NAL_CCYS = [
  { c: "USD", dp: 2 },
  { c: "EUR", dp: 2 },
  { c: "GBP", dp: 2 },
  { c: "CHF", dp: 2 },
  { c: "RUB", dp: 2 },
];
// Обе стороны отдельными строками: CUR→TRY (покупаем валюту) и TRY→CUR (продаём).
const NAL_DIRS = NAL_CCYS.flatMap(({ c, dp }) => [
  { from: c, to: "TRY", feed: `${c}_TRY`, dp, key: `${c}_TRY` },
  { from: "TRY", to: c, feed: `${c}_TRY`, dp, key: `TRY_${c}` },
]);
const TREND_WINS = [[30, "30м"], [60, "1ч"], [180, "3ч"]];
function NalBlock({ city, setCity, rows, onSpread, onItog, onToggleLock, trendWin, setTrendWin }) {
  return (
    <Card title="Нал" badge="Tolunay" badgeColor="bg-accent" hint={<>Цена Tolunay единая (TRY за 1 валюту). Колонка «{TREND_WINS.find(([m]) => m === trendWin)?.[1]} назад» — какой курс был столько времени назад (▲ вырос / ▼ упал / • без изменений). Итог = цена + спред (коп.).</>}>
      <div className="flex items-center gap-1 px-3.5 pt-2">
        {[["ANT", "Анталья"], ["IST", "Стамбул"]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setCity(id)}
            className={`px-2.5 py-1 rounded-[6px] text-[11px] font-bold transition-colors ${
              city === id ? "bg-[rgba(18,22,26,0.06)] text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          {TREND_WINS.map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setTrendWin(m)}
              className={`px-1.5 py-0.5 rounded-[5px] text-[10px] font-semibold transition-colors ${
                trendWin === m ? "bg-[rgba(18,22,26,0.06)] text-ink" : "text-muted-soft hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid px-3.5 pt-2 pb-1 text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft" style={{ gridTemplateColumns: "66px 50px 64px 48px 74px" }}>
        <span>Напр.</span><span className="text-right">Цена</span><span className="text-right">{TREND_WINS.find(([m]) => m === trendWin)?.[1]} назад</span><span className="text-right">Спр.</span><span className="text-right">Итог</span>
      </div>
      {rows.map((r) => {
        const delta = r.prev != null && r.price ? r.price - r.prev : null;
        return (
          <div key={r.key} className="grid items-center px-3.5 py-2 border-t border-border-soft" style={{ gridTemplateColumns: "66px 50px 64px 48px 74px" }}>
            <div className="font-mono text-[12px] font-semibold text-ink whitespace-nowrap">{r.from}<span className="text-muted-soft">→</span>{r.to}</div>
            <div className="text-right font-mono tabular-nums text-[12px] text-ink-soft" title="Цена Tolunay (авто)">{r.price ? fmt(r.price, r.dp) : "—"}</div>
            <div className="text-right pr-3">
              {delta != null ? (
                <span className={`inline-flex items-center gap-1 font-mono tabular-nums text-[12px] font-semibold ${delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted-soft"}`} title={`было ${fmt(r.prev, r.dp)} · Δ ${delta > 0 ? "+" : ""}${fmt(delta, r.dp)}`}>
                  <span className="inline-block w-[10px] text-center text-[10px] leading-none">{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"}</span>{fmt(r.prev, r.dp)}
                </span>
              ) : (
                <span className="text-muted-soft text-[12px]">—</span>
              )}
            </div>
            <div className="flex justify-end"><input disabled={r.locked} className={`${cellIn} w-[44px] ${r.locked ? "opacity-40 cursor-not-allowed" : ""}`} inputMode="numeric" value={r.spStr ?? String(r.spread)} onChange={(e) => onSpread(r.lockKey, e.target.value)} title="Спред, коп." /></div>
            <div className="flex items-center justify-end gap-1">
              <input
                className={`${cellIn} w-[52px] text-[13px] font-bold ${r.locked ? "border-warning bg-warning-soft text-warning" : "text-ink"}`}
                value={r.itogStr ?? (r.price ? fmt(r.itog, r.dp) : "")}
                onChange={(e) => onItog(r.lockKey, e.target.value)}
                title="Итоговая цена — можно вписать вручную"
              />
              <button type="button" onClick={() => onToggleLock(r.lockKey, r.itog)} title={r.locked ? "Цена зафиксирована — снять замок" : "Зафиксировать цену (не будет меняться от рынка)"} className="shrink-0">
                {r.locked ? <Lock className="w-3.5 h-3.5 text-warning" /> : <Unlock className="w-3.5 h-3.5 text-muted-soft hover:text-ink" />}
              </button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ── Блок 2 — USDT · Турция (Paramon) ───────────────────────────────────────
const TR_ROWS = [
  { d: "USDT→USD", from: "USDT", to: "USD", type: "pct", dp: 4 },
  { d: "USD→USDT", from: "USD", to: "USDT", type: "pct", dp: 4 },
  { d: "USDT→TRY", from: "USDT", to: "TRY", type: "abs", dp: 2 },
  { d: "TRY→USDT", from: "TRY", to: "USDT", type: "abs", dp: 2 },
  { d: "USDT→EUR", from: "USDT", to: "EUR", type: "abs", dp: 4 },
  { d: "EUR→USDT", from: "EUR", to: "USDT", type: "abs", dp: 4 },
];
const pctRate = (p) => 1 + p / 100;
function TrCell({ row, city, val, onChange }) {
  if (row.type === "pct") {
    return (
      <div className="flex items-center justify-end gap-1">
        <input className={`${cellIn} w-[50px]`} value={val.str ?? fmt(val.v, 2)} data-c={city} onChange={onChange} />
        <span className="text-[10px] text-muted-soft">%</span>
        <span className="font-mono tabular-nums text-[11px] font-semibold text-ink min-w-[42px] text-right">{fmt(pctRate(val.v), 4)}</span>
      </div>
    );
  }
  return (
    <div className="flex justify-end">
      <input className={`${cellIn} w-[92px]`} value={val.str ?? fmt(val.v, row.dp)} data-c={city} onChange={onChange} />
    </div>
  );
}
function TrBlock({ rows, setRows }) {
  const upd = (i) => (e) => {
    const city = e.target.dataset.c;
    const v = pnum(e.target.value);
    setRows((s) => s.map((r, idx) => (idx === i ? { ...r, [city]: { v, str: e.target.value } } : r)));
  };
  return (
    <Card title="USDT · Турция" badge="Paramon" badgeColor="bg-warning">
      <div className="grid px-3.5 pt-2 pb-1 text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft" style={{ gridTemplateColumns: "64px 1fr 1fr" }}>
        <span>Напр.</span><span className="text-right">Анталья</span><span className="text-right">Стамбул</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.d} className="grid items-center px-3.5 py-1.5 border-t border-border-soft" style={{ gridTemplateColumns: "64px 1fr 1fr" }}>
          <div className="font-mono text-[12px] font-semibold text-ink whitespace-nowrap">{r.from}<span className="text-muted-soft">→</span>{r.to}</div>
          <TrCell row={r} city="ant" val={r.ant} onChange={upd(i)} />
          <TrCell row={r} city="ist" val={r.ist} onChange={upd(i)} />
        </div>
      ))}
    </Card>
  );
}

// ── Блок 3 — USDT · Россия (Rapira) ────────────────────────────────────────
// Россия — кэш USDT↔RUB, без городов (2 направления).
const RU_DIRS = [
  { from: "USDT", to: "RUB", key: "USDT_RUB", dp: 2 },
  { from: "RUB", to: "USDT", key: "RUB_USDT", dp: 2 },
];
// Один-в-один как NalBlock: вкладки Москва/Питер + Напр | Цена(авто Rapira) | N назад | Спр | Итог.
function RuBlock({ city, setCity, rows, onSpread, onItog, onToggleLock, trendWin, setTrendWin }) {
  const winLabel = TREND_WINS.find(([m]) => m === trendWin)?.[1];
  const cols = "66px 50px 64px 48px 74px";
  return (
    <Card title="USDT · Россия" badge="Rapira" badgeColor="bg-info" hint={<>Цена — Rapira (авто, единая). Спред и итог — по вкладке города. Колонка «{winLabel} назад» — какой курс был столько времени назад (▲/▼/•). Итог = цена + спред (коп.); можно вписать вручную или зафиксировать замком.</>}>
      <div className="flex items-center gap-1 px-3.5 pt-2">
        {[["MSK", "Москва"], ["SPB", "Питер"]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setCity(id)}
            className={`px-2.5 py-1 rounded-[6px] text-[11px] font-bold transition-colors ${
              city === id ? "bg-[rgba(18,22,26,0.06)] text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          {TREND_WINS.map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setTrendWin(m)}
              className={`px-1.5 py-0.5 rounded-[5px] text-[10px] font-semibold transition-colors ${
                trendWin === m ? "bg-[rgba(18,22,26,0.06)] text-ink" : "text-muted-soft hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid px-3.5 pt-2 pb-1 text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft" style={{ gridTemplateColumns: cols }}>
        <span>Напр.</span><span className="text-right">Цена</span><span className="text-right">{winLabel} назад</span><span className="text-right">Спр.</span><span className="text-right">Итог</span>
      </div>
      {rows.map((r) => {
        const delta = r.prev != null && r.price ? r.price - r.prev : null;
        return (
          <div key={r.key} className="grid items-center px-3.5 py-2 border-t border-border-soft" style={{ gridTemplateColumns: cols }}>
            <div className="font-mono text-[12px] font-semibold text-ink whitespace-nowrap">{r.from}<span className="text-muted-soft">→</span>{r.to}</div>
            <div className="text-right font-mono tabular-nums text-[12px] text-ink-soft" title="Цена Rapira (авто)">{r.price ? fmt(r.price, r.dp) : "—"}</div>
            <div className="text-right pr-3">
              {delta != null ? (
                <span className={`inline-flex items-center gap-1 font-mono tabular-nums text-[12px] font-semibold ${delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted-soft"}`} title={`было ${fmt(r.prev, r.dp)} · Δ ${delta > 0 ? "+" : ""}${fmt(delta, r.dp)}`}>
                  <span className="inline-block w-[10px] text-center text-[10px] leading-none">{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"}</span>{fmt(r.prev, r.dp)}
                </span>
              ) : (
                <span className="text-muted-soft text-[12px]">—</span>
              )}
            </div>
            <div className="flex justify-end"><input disabled={r.locked} className={`${cellIn} w-[44px] ${r.locked ? "opacity-40 cursor-not-allowed" : ""}`} inputMode="numeric" value={r.spStr ?? String(r.spread)} onChange={(e) => onSpread(r.lockKey, e.target.value)} title="Спред, коп." /></div>
            <div className="flex items-center justify-end gap-1">
              <input
                className={`${cellIn} w-[52px] text-[13px] font-bold ${r.locked ? "border-warning bg-warning-soft text-warning" : "text-ink"}`}
                value={r.itogStr ?? (r.price ? fmt(r.itog, r.dp) : "")}
                onChange={(e) => onItog(r.lockKey, e.target.value)}
                title="Итоговая цена — можно вписать вручную"
              />
              <button type="button" onClick={() => onToggleLock(r.lockKey, r.itog)} title={r.locked ? "Цена зафиксирована — снять замок" : "Зафиксировать цену (не будет меняться от рынка)"} className="shrink-0">
                {r.locked ? <Lock className="w-3.5 h-3.5 text-warning" /> : <Unlock className="w-3.5 h-3.5 text-muted-soft hover:text-ink" />}
              </button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ── Панель ─────────────────────────────────────────────────────────────────
export default function RatesControlPanel({ offices, getGP, getOverride, tol, tolHistory, rapiraHistory, rapira, saveMargins, saveOverride, onDone }) {
  // Разрешаем офисы по городам (для записи overrides).
  const byCity = useMemo(() => {
    const m = { ANT: [], IST: [], MSK: [], SPB: [] };
    (offices || []).forEach((o) => {
      const cc = officeCityCode(o);
      if (m[cc]) m[cc].push(o);
    });
    return m;
  }, [offices]);
  const repOf = (city) => (byCity[city] || []).find((o) => o.active) ?? byCity[city]?.[0];
  const antRep = repOf("ANT");
  const istRep = repOf("IST");

  // Замки итоговых цен: key → зафиксированное значение (locks). Правки — буфер
  // ввода (edits): либо спред (итог=рынок+спред, живой), либо итог (фикс).
  const [locks, setLocks] = useState(readLocks);
  const [edits, setEdits] = useState({}); // key -> {field:'spread'|'itog', str}
  const toggleLock = useCallback((key, itog) => {
    setLocks((prev) => {
      const next = { ...prev };
      if (next[key] != null) delete next[key];
      else next[key] = Number(itog);
      writeLocks(next);
      return next;
    });
    setEdits((s) => { const n = { ...s }; delete n[key]; return n; });
  }, []);
  // Правка спреда → живой режим (снимаем замок). Правка итога → фикс (ставим замок).
  const onSpreadEdit = useCallback((key, val) => {
    setEdits((s) => ({ ...s, [key]: { field: "spread", str: val } }));
    setLocks((prev) => { if (prev[key] == null) return prev; const n = { ...prev }; delete n[key]; writeLocks(n); return n; });
  }, []);
  const onItogEdit = useCallback((key, val) => {
    setEdits((s) => ({ ...s, [key]: { field: "itog", str: val } }));
    setLocks((prev) => { const n = { ...prev, [key]: pnum(val) }; writeLocks(n); return n; });
  }, []);
  // Seed-спред из существующего оверрайда офиса-представителя (когда цена известна).
  const seedSpread = useCallback((city, d, price) => {
    const rep = (byCity[city] || []).find((o) => o.active) ?? byCity[city]?.[0];
    const ov = rep ? getOverride?.(rep.id, d.from, d.to) : null;
    const itog = Number(ov?.baseRate ?? ov?.rate ?? 0);
    return itog && price ? Math.round((itog - price) * 100) : 0;
  }, [byCity, getOverride]);
  // Разрешить строку → {spread, itog, spStr, itogStr, locked}.
  const resolveRow = useCallback((key, price, seed) => {
    const ed = edits[key];
    if (locks[key] != null) {
      const itog = locks[key];
      return { spread: Math.round((itog - price) * 100), itog, spStr: undefined, itogStr: ed?.field === "itog" ? ed.str : undefined, locked: true };
    }
    const spread = ed?.field === "spread" ? pint(ed.str) : seed;
    return { spread, itog: price + spread / 100, spStr: ed?.field === "spread" ? ed.str : undefined, itogStr: undefined, locked: false };
  }, [edits, locks]);
  const publishItog = useCallback((key, price, seed) => {
    if (locks[key] != null) return locks[key];
    const ed = edits[key];
    const spread = ed?.field === "spread" ? pint(ed.str) : seed;
    return price + spread / 100;
  }, [edits, locks]);

  // ── Нал per-city: в состоянии только спред (строка) по направлению; цена —
  // ЖИВАЯ из Tolunay (tol prop), итог = цена + спред/100. Спред-seed из
  // существующего оверрайда офиса-представителя (когда цена известна).
  const [nalCity, setNalCity] = useState("ANT");
  // Тренд Tolunay: предыдущая цена (свежайший снимок старше окна) по паре.
  const [trendWin, setTrendWin] = useState(30); // минут
  const prevFromHistory = (history) => {
    const cutoff = Date.now() - trendWin * 60000;
    const out = {};
    for (const r of history || []) {
      if (out[r.pair] === undefined && new Date(r.fetchedAt).getTime() <= cutoff) out[r.pair] = r.mid;
    }
    return out;
  };
  // Текущая цена — новейший снимок из истории (тот же надёжный запрос, что и prev).
  const curFromHistory = (history) => {
    const out = {};
    for (const r of history || []) if (out[r.pair] === undefined) out[r.pair] = r.mid;
    return out;
  };
  const tolCur = useMemo(() => curFromHistory(tolHistory), [tolHistory]);
  const rapiraCur = useMemo(() => curFromHistory(rapiraHistory), [rapiraHistory]);
  const tolPrev = useMemo(() => prevFromHistory(tolHistory), [tolHistory, trendWin]);
  const rapiraPrev = useMemo(() => prevFromHistory(rapiraHistory), [rapiraHistory, trendWin]);
  const nalRows = NAL_DIRS.map((d) => {
    const cur = d.from === "TRY" ? d.to : d.from; // валюта против TRY (для фолбэка)
    // Текущая цена Tolunay из истории (надёжно) → latest-view → глобальная пара (синхронный фолбэк).
    const feedMid = Number(tolCur[d.feed] ?? tol?.[d.feed]?.mid ?? 0);
    const gp = getGP?.(cur, "TRY");
    const price = feedMid || Number(gp?.rate ?? gp?.marketRate ?? gp?.baseRate ?? 0);
    const prev = feedMid > 0 ? tolPrev[d.feed] ?? null : null; // тренд из истории
    const key = `nal:${nalCity}:${d.key}`;
    const r = resolveRow(key, price, seedSpread(nalCity, d, price));
    return { ...d, price, prev, lockKey: key, ...r };
  });

  // ── init Турция из overrides представителя города ──
  const [tr, setTr] = useState(() =>
    TR_ROWS.map((r) => {
      const readCity = (rep) => {
        const ov = rep ? getOverride?.(rep.id, r.from, r.to) : null;
        if (!ov) return { v: 0 };
        if (r.type === "pct") {
          // %-строка = (эффективный курс − 1)·100, независимо от того, как хранили (base vs spread).
          const rate = Number(ov.rate ?? Number(ov.baseRate ?? 1) * (1 + Number(ov.spreadPercent ?? 0) / 100));
          return { v: Number(((rate - 1) * 100).toFixed(4)) };
        }
        return { v: Number(ov.baseRate ?? ov.rate ?? 0) };
      };
      return { ...r, ant: readCity(antRep), ist: readCity(istRep) };
    })
  );

  // ── Россия: кэш USDT↔RUB per-city (Москва/Питер), как нал per-city. Одна цена
  // Rapira; спред свой по городу; итог = Rapira + спред/100.
  const rapPrice = Number(rapiraCur.USDT_RUB ?? rapira?.USDT_RUB?.mid ?? getGP?.("USDT", "RUB")?.rate ?? 0);
  const [ruCity, setRuCity] = useState("MSK");
  const ruRows = RU_DIRS.map((d) => {
    const key = `ru:${ruCity}:${d.key}`;
    const r = resolveRow(key, rapPrice, seedSpread(ruCity, d, rapPrice));
    return { ...d, price: rapPrice, prev: rapiraPrev.USDT_RUB ?? null, lockKey: key, ...r };
  });

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const publish = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      let n = 0;
      // Блок 1 — нал per-city → office_rate_overrides офисов города. Каждая строка-
      // направление (CUR→TRY и TRY→CUR) сохраняется как итог = Tolunay + спред/100.
      for (const city of ["ANT", "IST"]) {
        const offs = byCity[city] || [];
        for (const d of NAL_DIRS) {
          const cur = d.from === "TRY" ? d.to : d.from;
          const gp = getGP?.(cur, "TRY");
          const price = Number(tolCur[d.feed] ?? tol?.[d.feed]?.mid ?? gp?.rate ?? gp?.marketRate ?? gp?.baseRate ?? 0);
          if (!(price > 0)) continue;
          const itog = publishItog(`nal:${city}:${d.key}`, price, seedSpread(city, d, price));
          if (!(itog > 0)) continue;
          for (const o of offs) {
            await saveOverride(o.id, d.from, d.to, itog, 0);
            n++;
          }
        }
      }
      // Блок 2 — Турция → overrides по всем офисам города.
      for (const r of tr) {
        for (const [cityKey, offs] of [["ant", byCity.ANT], ["ist", byCity.IST]]) {
          const val = r[cityKey].v;
          for (const o of offs) {
            if (r.type === "pct") await saveOverride(o.id, r.from, r.to, 1, val); // base=1, spread=%
            else await saveOverride(o.id, r.from, r.to, val, 0);
            n++;
          }
        }
      }
      // Блок 3 — Россия per-city → overrides офисов города (кэш USDT↔RUB).
      for (const city of ["MSK", "SPB"]) {
        const offs = byCity[city] || [];
        for (const d of RU_DIRS) {
          const itog = publishItog(`ru:${city}:${d.key}`, rapPrice, seedSpread(city, d, rapPrice));
          if (!(itog > 0)) continue;
          for (const o of offs) {
            await saveOverride(o.id, d.from, d.to, itog, 0);
            n++;
          }
        }
      }
      setMsg({ ok: true, text: `Опубликовано в БД кассы: ${n} записей.` });
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }, [publishItog, seedSpread, tol, tolCur, getGP, tr, rapPrice, byCity, saveOverride, onDone]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-tiny text-muted"><Globe className="w-3.5 h-3.5" /> Касса — источник курсов</span>
        {msg && <span className={`text-tiny ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
        <button
          type="button"
          onClick={publish}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-card bg-accent text-white text-body-sm font-bold hover:brightness-95 disabled:opacity-50 transition"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Опубликовать
        </button>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex flex-col gap-3 shrink-0">
          <NalBlock city={nalCity} setCity={setNalCity} rows={nalRows} onSpread={onSpreadEdit} onItog={onItogEdit} onToggleLock={toggleLock} trendWin={trendWin} setTrendWin={setTrendWin} />
          <TrBlock rows={tr} setRows={setTr} />
          <RuBlock city={ruCity} setCity={setRuCity} rows={ruRows} onSpread={onSpreadEdit} onItog={onItogEdit} onToggleLock={toggleLock} trendWin={trendWin} setTrendWin={setTrendWin} />
        </div>
        <div className="flex-1 min-w-0 self-stretch">
          <div className="h-full min-h-[400px] rounded-card border-[1.5px] border-dashed border-border-soft flex items-center justify-center text-muted-soft text-body-sm font-semibold bg-surface-soft/30">
            Вспомогательные панели (превью · история · калькулятор) — позже
          </div>
        </div>
      </div>
    </div>
  );
}
