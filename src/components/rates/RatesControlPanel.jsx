// src/components/rates/RatesControlPanel.jsx
// Панель управления курсами (касса = источник). Три блока по макету rates-control:
//   1. Нал (Tolunay)      — global pairs, market+маржа (копейки), обе стороны, единый для Ант/Ист.
//   2. USDT · Турция      — office_rate_overrides per-city (Анталья/Стамбул); USD↔USDT в %, прочее абс.
//   3. USDT · Россия      — office_rate_overrides RU (МСК/СПБ); Rapira-цена + оверрайд + ↻; спред в копейках.
// Локальное состояние; «Опубликовать» коммитит всё через существующие RPC (см. RatesPage).
// Данные/фиды — из движка кассы (Tolunay/Rapira → external_rates, pairs, overrides).
import React, { useState, useMemo, useCallback } from "react";
import { RotateCcw, Loader2, Globe } from "lucide-react";
import { officeCityCode } from "../../lib/rapiraSpreads.js";

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
function NalBlock({ rows, setRows, tol }) {
  // out sell = price + ss/100 ; out buy = price + sb/100 (sb обычно отрицателен)
  return (
    <Card title="Нал" badge="Tolunay" badgeColor="bg-accent" hint={<>Единый для Антальи и Стамбула. <b className="text-muted">Прод.</b> = цена + спред, <b className="text-muted">Пок.</b> = цена − |спред| (коп.).</>}>
      <div className="grid px-3.5 pt-2 pb-1 text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft" style={{ gridTemplateColumns: "70px 54px 46px 56px 46px 56px" }}>
        <span>Вал.</span><span className="text-right">Цена</span><span className="text-right">Спр.</span><span className="text-right">Прод.</span><span className="text-right">Спр.</span><span className="text-right">Пок.</span>
      </div>
      {NAL_CCYS.map(({ c, dp }) => {
        const r = rows[c];
        const feed = tol[`${c}_TRY`]?.mid;
        const price = r.price;
        const sell = price + r.ss / 100;
        const buy = price + r.sb / 100;
        return (
          <div key={c} className="grid items-center px-3.5 py-1.5 border-t border-border-soft" style={{ gridTemplateColumns: "70px 54px 46px 56px 46px 56px" }}>
            <div className="font-mono text-[12px] font-semibold text-ink">{c}<span className="text-muted-soft font-medium">/TRY</span></div>
            {feed != null ? (
              <div className="text-right font-mono tabular-nums text-[12px] text-muted" title="Tolunay (авто)">{fmt(price, dp)}</div>
            ) : (
              <input className={`${cellIn} w-[50px] justify-self-end`} value={r.priceStr ?? fmt(price, dp)} onChange={(e) => setRows((s) => ({ ...s, [c]: { ...s[c], price: pnum(e.target.value), priceStr: e.target.value } }))} title="Нет фида — ручная цена" />
            )}
            <input className={`${cellIn} w-[42px] justify-self-end`} inputMode="numeric" value={r.ssStr ?? String(r.ss)} onChange={(e) => setRows((s) => ({ ...s, [c]: { ...s[c], ss: pint(e.target.value), ssStr: e.target.value } }))} />
            <div className="text-right font-mono tabular-nums text-[13px] font-bold text-ink">{fmt(sell, dp)}</div>
            <input className={`${cellIn} w-[42px] justify-self-end`} inputMode="numeric" value={r.sbStr ?? String(r.sb)} onChange={(e) => setRows((s) => ({ ...s, [c]: { ...s[c], sb: pint(e.target.value), sbStr: e.target.value } }))} />
            <div className="text-right font-mono tabular-nums text-[13px] font-bold text-ink">{fmt(buy, dp)}</div>
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
const RU_ROWS = [
  { d: "USDT→RUB", from: "USDT", to: "RUB", city: "МСК", cityCode: "MSK", dp: 2 },
  { d: "USDT→RUB", from: "USDT", to: "RUB", city: "СПБ", cityCode: "SPB", dp: 2 },
  { d: "RUB→USDT", from: "RUB", to: "USDT", city: "МСК", cityCode: "MSK", dp: 2 },
  { d: "RUB→USDT", from: "RUB", to: "USDT", city: "СПБ", cityCode: "SPB", dp: 2 },
];
function RuBlock({ rows, setRows }) {
  const isOver = (r) => Math.abs(r.price - r.rapira) > 1e-9;
  return (
    <Card title="USDT · Россия" badge="Rapira" badgeColor="bg-info" hint={<>Цена — Rapira, можно перебить (оверрайд). <b className="text-muted">↻</b> — вернуть. Итог = цена + спред (коп.).</>}>
      <div className="grid px-3.5 pt-2 pb-1 text-[8.5px] font-semibold uppercase tracking-wide text-muted-soft" style={{ gridTemplateColumns: "112px 88px 46px 68px" }}>
        <span>Напр.</span><span className="text-right">Rapira</span><span className="text-right">Спр.</span><span className="text-right">Итог</span>
      </div>
      {rows.map((r, i) => {
        const itog = r.price + (r.spread || 0) / 100;
        const over = isOver(r);
        return (
          <div key={r.d + r.city} className="grid items-center px-3.5 py-1.5 border-t border-border-soft" style={{ gridTemplateColumns: "112px 88px 46px 68px" }}>
            <div className="font-mono text-[12px] font-semibold text-ink whitespace-nowrap">{r.from}<span className="text-muted-soft">→</span>{r.to} <span className="text-muted text-[10px] font-sans font-semibold">{r.city}</span></div>
            <div className="flex flex-col items-end">
              <input
                className={`${cellIn} w-[84px] ${over ? "border-warning bg-warning-soft" : ""}`}
                value={r.priceStr ?? fmt(r.price, r.dp)}
                onChange={(e) => setRows((s) => s.map((x, idx) => (idx === i ? { ...x, price: pnum(e.target.value), priceStr: e.target.value } : x)))}
              />
              <div className="flex items-center gap-1 text-[8px] text-muted-soft mt-0.5">
                Rapira <b className="font-mono text-muted font-semibold">{fmt(r.rapira, r.dp)}</b>
                <button type="button" className="text-accent inline-flex" title="Вернуть Rapira" onClick={() => setRows((s) => s.map((x, idx) => (idx === i ? { ...x, price: x.rapira, priceStr: undefined } : x)))}>
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <input className={`${cellIn} w-[42px]`} inputMode="numeric" value={r.spreadStr ?? String(r.spread)} onChange={(e) => setRows((s) => s.map((x, idx) => (idx === i ? { ...x, spread: pint(e.target.value), spreadStr: e.target.value } : x)))} />
            </div>
            <div className="text-right font-mono tabular-nums text-[13px] font-bold text-ink">{fmt(itog, r.dp)}</div>
          </div>
        );
      })}
    </Card>
  );
}

// ── Панель ─────────────────────────────────────────────────────────────────
export default function RatesControlPanel({ offices, getGP, getOverride, tol, rapira, saveMargins, saveOverride, onDone }) {
  // Разрешаем офисы по городам (для записи overrides).
  const byCity = useMemo(() => {
    const m = { ANT: [], IST: [], MSK: [], SPB: [] };
    (offices || []).forEach((o) => {
      const cc = officeCityCode(o);
      if (m[cc]) m[cc].push(o);
    });
    return m;
  }, [offices]);
  const antRep = byCity.ANT[0];
  const istRep = byCity.IST[0];

  // ── init нал из global pairs (market+маржа) + Tolunay цена ──
  const [nal, setNal] = useState(() => {
    const s = {};
    NAL_CCYS.forEach(({ c }) => {
      const gp = getGP?.(c, "TRY");
      const feed = tol?.[`${c}_TRY`]?.mid;
      const market = Number(gp?.marketRate ?? gp?.baseRate ?? feed ?? 0);
      s[c] = {
        price: feed != null ? feed : market,
        ss: Math.round(-(Number(gp?.sellMargin ?? 0)) * 100), // продажа = market − sellMargin = price + ss/100
        sb: Math.round(Number(gp?.buyMargin ?? 0) * 100), // покупка = market + buyMargin = price + sb/100
      };
    });
    return s;
  });

  // ── init Турция из overrides представителя города ──
  const [tr, setTr] = useState(() =>
    TR_ROWS.map((r) => {
      const readCity = (rep) => {
        const ov = rep ? getOverride?.(rep.id, r.from, r.to) : null;
        if (!ov) return { v: r.type === "pct" ? 0 : 0 };
        return { v: r.type === "pct" ? Number(ov.spreadPercent ?? 0) : Number(ov.baseRate ?? ov.rate ?? 0) };
      };
      return { ...r, ant: readCity(antRep), ist: readCity(istRep) };
    })
  );

  // ── init Россия из overrides RU + Rapira mid ──
  const rapMid = Number(rapira?.USDT_RUB?.mid ?? 0);
  const [ru, setRu] = useState(() =>
    RU_ROWS.map((r) => {
      const rep = byCity[r.cityCode]?.[0];
      const ov = rep ? getOverride?.(rep.id, r.from, r.to) : null;
      const rapiraRef = rapMid || Number(ov?.rate ?? ov?.baseRate ?? 0);
      const price = Number(ov?.baseRate ?? ov?.rate ?? rapiraRef);
      return { ...r, rapira: rapiraRef, price, spread: 0 };
    })
  );

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const publish = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      let n = 0;
      // Блок 1 — нал → global pairs (market+маржа, копейки). rate=market+buyMargin(=sb),
      // продажа=market−sellMargin(=−ss). Пишем pair CUR→TRY.
      for (const { c } of NAL_CCYS) {
        const r = nal[c];
        await saveMargins(c, "TRY", { market: r.price, buyMargin: r.sb / 100, sellMargin: -r.ss / 100 });
        n++;
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
      // Блок 3 — Россия → overrides RU-офисов. Итог = price + spread/100.
      for (const r of ru) {
        const offs = byCity[r.cityCode] || [];
        const itog = r.price + (r.spread || 0) / 100;
        for (const o of offs) {
          await saveOverride(o.id, r.from, r.to, itog, 0);
          n++;
        }
      }
      setMsg({ ok: true, text: `Опубликовано в БД кассы: ${n} записей.` });
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }, [nal, tr, ru, byCity, saveMargins, saveOverride, onDone]);

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
          <NalBlock rows={nal} setRows={setNal} tol={tol || {}} />
          <TrBlock rows={tr} setRows={setTr} />
          <RuBlock rows={ru} setRows={setRu} />
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
