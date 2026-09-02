// src/pages/RatesEditorV2.jsx
// Новый редактор курсов (фаза 2а, PR-B1 + PR-B2) — Экран 2 эталона r8.
// За флагом rates_v2_ui. Старый редактор нетронут и живёт по старому маршруту.
//
// PR-B2 закрыл заглушки: все пять блоков редактируются, каждый — своим типом
// экрана, а не общей таблицей. Тип экрана следует из ПРИРОДЫ блока:
//   manual  (USDT)         — таблица пар с прямым вводом
//   manual  (НЕРЕЗ)        — сетка Прод./Покуп. × базис: у сетки нет «пар»
//   auto    (Нал, QR)      — цена фида read-only + спред + замок
//   derived (Перестановки) — маршруты офисов с маржой, дефолт блока сверху
//
// ЧЕРНОВИК ЖИВЁТ В СТЕЙТЕ: до кнопки «Опубликовать» в базу не уходит ни один
// запрос. Превью «Клиенту» считается тем же rateEngine, что и публикация, —
// в UI нет ни одной собственной формулы.
//
// НАСЛЕДОВАНИЕ (семантика, утверждённая владельцем): черновик стартует от
// ПОСЛЕДНЕЙ ПУБЛИКАЦИИ, а не от значений в rate_rows. Публикация — всегда
// полный снимок включённых строк, поэтому не тронутое сегодня уходит вчерашним
// значением. Пустой навсегда остаётся только строка, которую не публиковали
// ни разу.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Loader2, Lock, Unlock, X } from "lucide-react";
import { computeAll, pricesToMap, priceKey, num } from "../lib/rateEngine.js";
import { pasteToDraft, pasteSummary } from "../lib/ratesPaste.js";
import { ratesHealth, LEVEL } from "../lib/ratesHealth.js";
import { auditAll, VERDICT } from "../lib/ratesAudit.js";
import {
  loadBlocks, loadPublished, loadSources, loadMarket, publishedMap, publishRates,
  officeCityMap, V2_BANNER,
} from "../lib/ratesV2.js";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";

const fmtRate = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Процент по-русски: запятая, не точка. Правило чисел — и в подписях тоже. */
function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

// Подпись значения «Было» в единицах строки: проценты показываем процентами.
function fmtWas(row, prevRate) {
  if (prevRate == null) return "—";
  if (row.value_mode === "pct") {
    const pct = (prevRate - 1) * 100;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }
  return fmtRate(prevRate);
}

/** Возраст котировки словами. Протухшее должно быть видно без арифметики. */
function ageLabel(min) {
  if (min == null) return "нет данных";
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  return `${h} ч назад`;
}

const Input = ({ bad, wide, ...rest }) => (
  <input
    inputMode="decimal"
    {...rest}
    className={`font-light text-[19px] tabular-nums rounded-[14px] px-3.5 py-2 outline-none border ${
      wide ? "w-[126px]" : "w-[92px]"
    } ${bad ? "border-danger bg-danger-soft text-danger" : "border-transparent bg-cream focus:border-ink"} ${
      rest.disabled ? "opacity-45" : ""
    }`}
  />
);

export default function RatesEditorV2({ onClose }) {
  const { activeOffices } = useOffices();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "owner" || currentUser?.role === "admin";

  const [blocks, setBlocks] = useState(null);
  const [published, setPublished] = useState(null);
  const [sources, setSources] = useState({});
  const [market, setMarket] = useState([]);
  const [sourceMeta, setSourceMeta] = useState({});
  const [activeBlock, setActiveBlock] = useState(null);
  const [activeScope, setActiveScope] = useState(null);
  const [draft, setDraft] = useState({});          // rowId → строка ввода
  const [locks, setLocks] = useState({});          // rowId → зафиксированный итог
  const [closed, setClosed] = useState({});        // rowId → «сегодня не торгуем»
  const [paste, setPaste] = useState(null);        // окно вставки: { text, parsed }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);      // ответ RPC

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [bs, pub] = await Promise.all([loadBlocks(), loadPublished()]);
        if (!alive) return;
        setBlocks(bs);
        setPublished(pub);
        const first = bs.find((b) => b.code === "usdt") || bs.find((b) => b.enabled) || bs[0];
        setActiveBlock(first?.code || null);
        setActiveScope(first?.scopes?.[0] || null);

        // Котировки нужны только auto-блокам; провайдеры берём из их config.
        const providers = [...new Set(bs.filter((b) => b.kind === "auto").map((b) => b.config?.provider).filter(Boolean))];
        const { sources: src, meta } = await loadSources(providers);
        if (!alive) return;
        setSources(src);
        setSourceMeta(meta);
        setMarket(await loadMarket());
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  const officeCity = useMemo(() => officeCityMap(activeOffices), [activeOffices]);
  const officeName = useMemo(
    () => Object.fromEntries((activeOffices || []).map((o) => [o.id, o.name || o.city || o.id])),
    [activeOffices]
  );
  const prevMap = useMemo(() => publishedMap(published), [published]);
  const block = useMemo(() => (blocks || []).find((b) => b.code === activeBlock) || null, [blocks, activeBlock]);

  // Наследование: значения и замки последней публикации — старт черновика.
  const inherited = useMemo(() => {
    const inp = published?.inputs || {};
    return { values: inp.values || {}, locks: inp.locks || {}, closed: inp.closed || {} };
  }, [published]);

  const valueOf = useCallback(
    (r) => (Object.prototype.hasOwnProperty.call(draft, r.id) ? draft[r.id] : inherited.values[r.id] ?? r.value),
    [draft, inherited]
  );
  const lockOf = useCallback(
    (r) => (Object.prototype.hasOwnProperty.call(locks, r.id) ? locks[r.id] : inherited.locks[r.id] ?? null),
    [locks, inherited]
  );
  // «Не торгуем» НЕ наследуется: вчерашнее закрытие не должно молча закрывать
  // строку сегодня. Каждое утро состояние приходит из свежего сообщения.
  const closedOf = useCallback((r) => closed[r.id] === true, [closed]);

  const visibleRows = useMemo(() => {
    if (!block) return [];
    return block.rows
      .filter((r) => r.enabled !== false)
      .filter((r) => !activeScope || r.scope === activeScope || r.scope == null);
  }, [block, activeScope]);

  // ── Черновик → прайс. Единственная арифметика в UI — вызов rateEngine.
  const engineRows = useMemo(() => {
    if (!blocks) return [];
    return blocks.flatMap((b) =>
      b.rows.map((r) => ({
        block_code: b.code,
        scope: r.scope,
        from_ccy: r.from_ccy,
        to_ccy: r.to_ccy,
        value_mode: r.value_mode,
        band_pct: r.band_pct,
        enabled: r.enabled,
        value: valueOf(r),
        locked_rate: lockOf(r),
        closed: closedOf(r),
      }))
    );
  }, [blocks, valueOf, lockOf, closedOf]);

  const computed = useMemo(() => {
    if (!blocks) return { prices: [], errors: [], violations: [], closed: [] };
    return computeAll({
      blocks: (blocks || []).map((b) => ({ ...b, config: b.config || {} })),
      rows: engineRows,
      sources,
      previous: prevMap,
      officeCity,
    });
  }, [blocks, engineRows, sources, prevMap, officeCity]);

  const priceMap = useMemo(() => pricesToMap(computed.prices), [computed.prices]);
  const violByKey = useMemo(
    () => Object.fromEntries((computed.violations || []).map((v) => [v.key, v])),
    [computed.violations]
  );
  const errByKey = useMemo(
    () => Object.fromEntries((computed.errors || []).map((e) => [e.key, e])),
    [computed.errors]
  );

  const keyOf = useCallback(
    (r) => priceKey({ block: block?.code, scope: r.scope, from: r.from_ccy, to: r.to_ccy }),
    [block]
  );

  const summary = useMemo(() => {
    const changed = computed.prices.filter((p) => {
      const prev = prevMap[priceKey({ block: p.block, scope: p.scope, from: p.from, to: p.to })];
      return prev == null || Math.abs(prev - p.rate) > 1e-9;
    });
    return { count: changed.length, blocks: new Set(changed.map((c) => c.block)).size };
  }, [computed.prices, prevMap]);

  // Аудит: каждая котировка против рынка. Здоровье говорит про панель целиком
  // и остаётся зелёным при одной неверной цифре — а стоит денег именно она.
  const audit = useMemo(() => auditAll(computed.prices, market), [computed.prices, market]);
  const auditBad = audit.summary.bad + audit.summary.orientationClashes;

  // Здоровье: чем торгуем и можно ли этому верить. Считается из тех же
  // данных, что и публикация, — отдельного источника правды нет.
  const health = useMemo(
    () => ratesHealth({ sources: sourceMeta, published, computed, bridgeEnabled: false }),
    [sourceMeta, published, computed]
  );

  const nextVersion = (published?.version || 0) + 1;
  // Публикацию блокируют и границы, и спорные котировки: цена, разошедшаяся
  // с рынком в разы, уедет на сайт и в агрегаторы, где её увидит клиент.
  const blocked = computed.violations.length > 0 || auditBad > 0;
  const dirty = Object.keys(draft).length > 0 || Object.keys(locks).length > 0 || Object.keys(closed).length > 0;

  const setValue = useCallback((rowId, raw) => {
    setResult(null);
    setDraft((d) => ({ ...d, [rowId]: raw }));
    // Правка спреда/значения снимает замок — как в работающей панели: человек
    // вернулся к живому курсу, и держать поверх зафиксированный итог нечестно.
    setLocks((l) => (Object.prototype.hasOwnProperty.call(l, rowId) ? { ...l, [rowId]: null } : l));
  }, []);

  const toggleClosed = useCallback((rowId) => {
    setResult(null);
    setClosed((c) => ({ ...c, [rowId]: !c[rowId] }));
  }, []);

  const toggleLock = useCallback((row, currentRate) => {
    setResult(null);
    setLocks((l) => {
      const now = Object.prototype.hasOwnProperty.call(l, row.id) ? l[row.id] : inherited.locks[row.id] ?? null;
      return { ...l, [row.id]: now != null ? null : num(currentRate) };
    });
  }, [inherited]);

  const onPublish = useCallback(async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      // inputs — весь ввод, а не только сегодняшние правки: следующая сессия
      // стартует от них, и потерянный ключ означал бы пустое поле завтра.
      const values = {};
      const lockMap = {};
      const closedMap = {};
      for (const b of blocks || []) {
        for (const r of b.rows) {
          const v = valueOf(r);
          if (v != null && v !== "") values[r.id] = v;
          const lk = lockOf(r);
          if (lk != null) lockMap[r.id] = lk;
          if (closedOf(r)) closedMap[r.id] = true;
        }
      }
      const res = await publishRates({
        inputs: { values, locks: lockMap, closed: closedMap },
        prices: computed.prices,
        sourceMeta: { editor: "v2", shadow: true, sources: sourceMeta },
      });
      setResult(res);
      if (res?.ok) {
        setDraft({});
        setLocks({});
        setClosed({});
        setPublished(await loadPublished());
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [blocks, valueOf, lockOf, closedOf, computed.prices, sourceMeta]);

  // ── вставка документа ───────────────────────────────────────────────────
  const onPasteText = useCallback((text) => {
    setPaste({ text, parsed: pasteToDraft({ blocks: blocks || [], text }) });
  }, [blocks]);

  const applyPaste = useCallback(() => {
    if (!paste?.parsed) return;
    setResult(null);
    setDraft((d) => ({ ...d, ...paste.parsed.draft }));
    setClosed((c) => ({ ...c, ...(paste.parsed.closed || {}) }));
    setPaste(null);
  }, [paste]);

  if (err && !blocks) {
    return <div className="p-6 text-[13px] text-danger">Не удалось загрузить блоки: {err}</div>;
  }
  if (!blocks) {
    return (
      <div className="p-6 flex items-center gap-2 text-[13px] text-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Загрузка блоков…
      </div>
    );
  }

  // ── вкладка: ручные пары (USDT) ─────────────────────────────────────────
  const renderPairs = () => (
    <table className="w-full border-collapse table-fixed">
      <thead>
        <tr className="text-[11.5px] text-faint">
          <th className="text-left font-normal pb-3 w-[30%]">Пара</th>
          <th className="text-left font-normal pb-3 w-[20%]">Было</th>
          <th className="text-left font-normal pb-3 w-[28%]">Стало</th>
          <th className="text-right font-normal pb-3 w-[22%]">Клиенту</th>
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((r) => {
          const key = keyOf(r);
          const viol = violByKey[key];
          return (
            <tr key={r.id}>
              <td className="py-3 border-t border-line text-[14px]">{r.from_ccy} → {r.to_ccy}</td>
              <td className="py-3 border-t border-line font-light text-[19px] text-faint tabular-nums">
                {fmtWas(r, prevMap[key])}
              </td>
              <td className="py-3 border-t border-line">
                <Input
                  wide
                  bad={!!viol}
                  value={valueOf(r) ?? ""}
                  onChange={(e) => setValue(r.id, e.target.value)}
                  placeholder={r.value_mode === "pct" ? "0,00%" : "0,00"}
                />
              </td>
              <td className="py-3 border-t border-line text-right">
                {viol
                  ? <span className="text-[12px] text-danger">вне границ</span>
                  : <span className="font-light text-[23px] tabular-nums">{fmtRate(priceMap[key])}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // ── вкладка: авто-блок с фидом (Нал, QR) ────────────────────────────────
  const renderSource = () => {
    const isAbs = block.config?.spread_mode === "abs";
    const unit = isAbs ? "коп." : "%";
    const meta = sourceMeta[block.config?.provider];
    return (
      <>
        <div className="flex items-center gap-2.5 mb-3 text-[12px]">
          <span className={`rounded-full px-3 py-1.5 ${meta && meta.age_min <= 120 ? "bg-cream text-[#6B675C]" : "bg-orange-bg text-orange-ink"}`}>
            {block.config?.provider || "фид"} · {ageLabel(meta?.age_min)}
          </span>
          <span className="text-faint">
            цена приходит из фида и не редактируется — редактируется спред ({unit})
          </span>
        </div>
        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr className="text-[11.5px] text-faint">
              <th className="text-left font-normal pb-3 w-[26%]">Пара</th>
              <th className="text-left font-normal pb-3 w-[20%]">Цена фида</th>
              <th className="text-left font-normal pb-3 w-[20%]">Спред, {unit}</th>
              <th className="text-left font-normal pb-3 w-[12%]">Замок</th>
              <th className="text-right font-normal pb-3 w-[22%]">Клиенту</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const key = keyOf(r);
              const provider = block.config?.provider;
              const feed = sources[`${provider}|${r.from_ccy}|${r.to_ccy}`];
              const lock = lockOf(r);
              const locked = lock != null;
              const rowErr = errByKey[key];
              return (
                <tr key={r.id}>
                  <td className="py-3 border-t border-line text-[14px]">{r.from_ccy} → {r.to_ccy}</td>
                  <td className="py-3 border-t border-line font-light text-[19px] tabular-nums text-faint">
                    {feed == null ? <span className="text-[12px] text-orange-ink">нет котировки</span> : fmtRate(feed)}
                  </td>
                  <td className="py-3 border-t border-line">
                    <Input
                      value={valueOf(r) ?? ""}
                      disabled={locked}
                      onChange={(e) => setValue(r.id, e.target.value)}
                      placeholder={String(block.config?.spread_pct ?? 0)}
                      title={locked ? "Курс зафиксирован замком" : undefined}
                    />
                  </td>
                  <td className="py-3 border-t border-line">
                    <button
                      type="button"
                      onClick={() => toggleLock(r, locked ? null : priceMap[key])}
                      disabled={!locked && priceMap[key] == null}
                      title={locked ? "Снять замок — курс пойдёт за фидом" : "Зафиксировать текущий итог"}
                      className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors ${
                        locked ? "bg-ink text-cream border-ink" : "border-line-2 text-[#6B675C] hover:text-ink disabled:opacity-30"
                      }`}
                    >
                      {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                  <td className="py-3 border-t border-line text-right">
                    {rowErr
                      // «нет котировки» уже сказано в колонке фида — второй раз
                      // тем же словом строка становится нечитаемой полосой.
                      ? <span className="text-[19px] text-faint">—</span>
                      : <span className={`font-light text-[23px] tabular-nums ${locked ? "text-ink" : ""}`}>{fmtRate(priceMap[key])}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  };

  // ── вкладка: НЕРЕЗ — сетка базис × сторона ──────────────────────────────
  const renderGrid = () => {
    const bases = block.scopes || [];
    const sides = [
      { label: "Продажа", from: "USDT", to: "RUB" },
      { label: "Покупка", from: "RUB", to: "USDT" },
    ];
    const rowFor = (basis, s) =>
      block.rows.find((r) => r.scope === basis && r.from_ccy === s.from && r.to_ccy === s.to && r.enabled !== false);
    return (
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr className="text-[11.5px] text-faint">
            <th className="text-left font-normal pb-3 w-[26%]">Базис</th>
            {sides.map((s) => (
              <th key={s.label} className="text-left font-normal pb-3">
                {s.label} <span className="opacity-70">· {s.from} → {s.to}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bases.map((basis) => (
            <tr key={basis}>
              <td className="py-3 border-t border-line text-[14px]">{basis}</td>
              {sides.map((s) => {
                const r = rowFor(basis, s);
                if (!r) return <td key={s.label} className="py-3 border-t border-line text-[12px] text-faint">нет строки</td>;
                const key = keyOf(r);
                const isClosed = closedOf(r);
                return (
                  <td key={s.label} className="py-3 border-t border-line">
                    <div className="flex items-baseline gap-3">
                      {isClosed ? (
                        <span className="text-[15px] text-faint w-[126px]">не торгуем</span>
                      ) : (
                        <Input
                          wide
                          bad={!!violByKey[key]}
                          value={valueOf(r) ?? ""}
                          onChange={(e) => setValue(r.id, e.target.value)}
                          placeholder="0,00"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleClosed(r.id)}
                        title={isClosed ? "Вернуть в торговлю" : "Сегодня по этому базису не торгуем"}
                        className={`text-[11.5px] rounded-full px-2.5 py-1 transition-colors ${
                          isClosed ? "bg-ink text-cream" : "text-faint hover:text-ink"
                        }`}
                      >
                        {isClosed ? "вернуть" : "закрыть"}
                      </button>
                      {!isClosed && (
                        <span className="text-[12px] text-faint tabular-nums">было {fmtWas(r, prevMap[key])}</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  // ── вкладка: перестановки — маршруты офисов ─────────────────────────────
  const renderRoutes = () => {
    const def = block.config?.margin_pct ?? 0;
    // Группируем по НАПРАВЛЕНИЮ ПАРЫ (TRY→RUB и RUB→TRY), а не по офису-
    // отправителю: офисов-отправителей столько же, сколько маршрутов, и
    // группировка по ним даёт пять заголовков над одной строкой каждый.
    // Направлений всегда два, и они и есть тот разговор, который ведёт меняла:
    // «выплата в рублях» против «выплата в лирах». Правило общее, без
    // упоминания Москвы: хаб может смениться.
    const groups = new Map();
    for (const r of block.rows.filter((x) => x.enabled !== false)) {
      const dir = `${r.from_ccy}→${r.to_ccy}`;
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(r);
    }
    return (
      <>
        <div className="flex items-center gap-2.5 mb-4 text-[12.5px]">
          <span className="bg-cream rounded-full px-3 py-1.5 text-[12px] text-[#6B675C]">
            маржа блока по умолчанию · {fmtPct(def)}
          </span>
          <span className="text-faint">пустое поле маршрута = маржа блока</span>
        </div>
        {[...groups.entries()].map(([dir, rows]) => (
          <div key={dir} className="mb-5 last:mb-0">
            <div className="text-[13px] text-muted mb-1.5">
              {dir.replace("→", " → ")} <span className="text-faint">· {rows.length} {rows.length === 1 ? "маршрут" : "маршрутов"}</span>
            </div>
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr className="text-[11.5px] text-faint">
                  <th className="text-left font-normal pb-2 w-[36%]">Откуда</th>
                  <th className="text-left font-normal pb-2 w-[18%]">Куда</th>
                  <th className="text-left font-normal pb-2 w-[24%]">Маржа, %</th>
                  <th className="text-right font-normal pb-2 w-[22%]">Клиенту</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [fromId, toId] = String(r.scope || "").split("→");
                  const key = keyOf(r);
                  const rowErr = errByKey[key];
                  const own = valueOf(r);
                  return (
                    <tr key={r.id}>
                      <td className="py-2.5 border-t border-line text-[14px]">{officeName[fromId] || fromId}</td>
                      <td className="py-2.5 border-t border-line text-[13px] text-muted">{officeName[toId] || toId}</td>
                      <td className="py-2.5 border-t border-line">
                        <Input
                          value={own ?? ""}
                          onChange={(e) => setValue(r.id, e.target.value)}
                          placeholder={String(def).replace(".", ",")}
                          title={own == null || own === "" ? "используется маржа блока" : "своя маржа маршрута"}
                        />
                      </td>
                      <td className="py-2.5 border-t border-line text-right">
                        {rowErr
                          ? <span className="text-[12px] text-orange-ink">нет курса города</span>
                          : <span className="font-light text-[21px] tabular-nums">{fmtRate(priceMap[key])}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </>
    );
  };

  // ── вкладка: якорный блок (QR) — курс из сообщения + наш подсчёт ────────
  const renderAnchor = () => {
    const cfg = block.config?.anchor;
    const anchorRow = block.rows.find(
      (r) => r.from_ccy === cfg.from && r.to_ccy === cfg.to && r.enabled !== false
    );
    const rest = block.rows.filter((r) => r !== anchorRow && r.enabled !== false);
    const aKey = anchorRow ? keyOf(anchorRow) : null;

    return (
      <>
        {/* ЯКОРЬ — это КУРС, а не маржа. Общий экран производных блоков
            подписывал поле «Маржа, %» и показывал 93,45 как процент: число
            верное, подпись врёт, а такая пара опаснее пустого поля. */}
        <div className="flex items-baseline gap-4 pb-4 border-b border-line">
          <div className="min-w-0">
            <div className="text-[14px]">{cfg.from} → {cfg.to}</div>
            <div className="text-[12px] text-faint mt-0.5">
              якорь из утреннего сообщения · {cfg.from === "RUB" ? "рублей за 1 USDT" : "курс"}
            </div>
          </div>
          <div className="ml-auto flex items-baseline gap-4 shrink-0">
            <span className="text-[12px] text-faint">было {fmtRate(prevMap[aKey])}</span>
            {anchorRow && (
              <Input
                wide
                bad={!!violByKey[aKey]}
                value={valueOf(anchorRow) ?? ""}
                onChange={(e) => setValue(anchorRow.id, e.target.value)}
                placeholder="0,00"
              />
            )}
          </div>
        </div>

        <div className="text-[12px] text-faint py-3">
          ниже — наш подсчёт: якорь ÷ курс USDT города. Правится только якорь.
        </div>

        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr className="text-[11.5px] text-faint">
              <th className="text-left font-normal pb-3 w-[22%]">Город</th>
              <th className="text-left font-normal pb-3 w-[26%]">Пара</th>
              <th className="text-left font-normal pb-3 w-[26%]">Курс USDT города</th>
              <th className="text-right font-normal pb-3 w-[26%]">Клиенту</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((r) => {
              const key = keyOf(r);
              const leg = priceMap[priceKey({
                block: block.config?.base_block_code, scope: r.scope, from: "USDT", to: r.to_ccy,
              })];
              const rowErr = errByKey[key];
              return (
                <tr key={r.id}>
                  <td className="py-3 border-t border-line text-[14px]">{r.scope}</td>
                  <td className="py-3 border-t border-line text-[13px] text-muted">{r.from_ccy} → {r.to_ccy}</td>
                  <td className="py-3 border-t border-line text-[13px] text-muted tabular-nums">
                    {leg == null ? <span className="text-orange-ink">нет курса</span> : `USDT → ${r.to_ccy} = ${fmtRate(leg)}`}
                  </td>
                  <td className="py-3 border-t border-line text-right">
                    {rowErr
                      ? <span className="text-[19px] text-faint">—</span>
                      : <span className="font-light text-[23px] tabular-nums">{fmtRate(priceMap[key])}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  };

  const renderBody = () => {
    if (!block) return null;
    if (block.code === "nerez") return renderGrid();
    if (block.config?.anchor) return renderAnchor();
    if (block.kind === "auto") return renderSource();
    if (block.kind === "derived") return renderRoutes();
    return renderPairs();
  };

  // Чипы измерений: у маршрутов и сетки они не измерение выбора, а данные
  // самого экрана — показывать их значило бы прятать половину таблицы.
  // Чип-переключатель имеет смысл, только если строки РАЗНЫЕ по измерениям.
  // У Нал и QR строки общие (scope null) — там чипы переключали пустоту, и
  // человек вправе был решить, что фильтр сломан. Показываем те же города
  // подписью: блок действительно на них действует, просто выбирать нечего.
  const scopedRows = block?.rows?.some((r) => r.scope != null);
  const showScopes =
    block?.scopes?.length > 0 && scopedRows && block.kind !== "derived" && block.code !== "nerez" && !block?.config?.anchor;
  const showScopeNote = block?.scopes?.length > 0 && !scopedRows && block.kind !== "derived" && block.code !== "nerez";

  return (
    <div className="min-h-full bg-bg px-6 py-5">
      {/* Баннер теневого режима — постоянный, снимается только с мостом */}
      <div className="mb-4 flex items-center gap-2.5 bg-orange-bg rounded-full px-4 py-2.5 w-fit">
        <span className="w-[19px] h-[19px] rounded-[6px] bg-orange text-white text-[12px] flex items-center justify-center shrink-0">!</span>
        <span className="text-[13px] text-orange-ink">{V2_BANNER}</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <span className="text-[19px]">Курсы · редактирование</span>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="inline-flex items-center gap-2 rounded-full bg-orange-bg text-orange-ink text-[13px] px-4 py-2">
              <span className="w-[7px] h-[7px] rounded-full bg-orange" />
              Черновик · не опубликован
            </span>
          )}
          <button
            type="button"
            onClick={() => onPasteText("")}
            className="inline-flex items-center gap-2 rounded-full border border-line-2 text-[#6B675C] hover:text-ink text-[13px] px-[18px] py-2.5"
          >
            <ClipboardPaste className="w-3.5 h-3.5" /> Вставить курсы
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-full border border-line-2 text-muted hover:text-ink flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Вкладки-блоки по position */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {blocks.map((b) => (
          <button
            key={b.code}
            type="button"
            onClick={() => { setActiveBlock(b.code); setActiveScope(b.scopes?.[0] || null); }}
            className={`rounded-full text-[13px] px-[18px] py-2.5 transition-colors ${
              b.code === activeBlock ? "bg-ink text-cream" : "border border-line-2 text-[#6B675C] hover:text-ink"
            }`}
          >
            {b.title}
            {b.kind !== "derived" && b.code !== "nerez" && b.scopes?.length > 1 && (
              <span className="opacity-70"> · {b.scopes.length}</span>
            )}
          </button>
        ))}
        {isAdmin && (
          <button type="button" disabled title="создание блоков — следующий этап" className="rounded-full text-[13px] px-[18px] py-2.5 text-muted opacity-50 cursor-not-allowed">
            + блок
          </button>
        )}
      </div>

      {/* Здоровье курсов — одной строкой над картой блока. Неделю дашборд
          показывал «курс не загрузился», и это считали особенностью фронта:
          нигде не было написано, что упал фид. Теперь написано. */}
      <div className="flex items-center gap-2 mb-3 flex-wrap text-[11.5px]">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
          health.level === LEVEL.BAD ? "bg-danger-soft text-danger"
            : health.level === LEVEL.WARN ? "bg-orange-bg text-orange-ink"
            : "bg-cream text-[#6B675C]"
        }`}>
          <span className={`w-[7px] h-[7px] rounded-full ${
            health.level === LEVEL.BAD ? "bg-danger" : health.level === LEVEL.WARN ? "bg-orange" : "bg-success"
          }`} />
          Здоровье
        </span>
        {health.items.map((it) => (
          <span
            key={it.key}
            title={it.kind === "feed" ? `фид ${it.key}` : it.kind === "publication" ? "последняя публикация" : it.kind === "coverage" ? "покрытие модели ценами" : "доставка в каналы"}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
              it.muted ? "text-faint"
                : it.level === LEVEL.BAD ? "bg-danger-soft text-danger"
                : it.level === LEVEL.WARN ? "bg-orange-bg text-orange-ink"
                : "bg-cream text-[#6B675C]"
            }`}
          >
            {!it.muted && (
              <span className={`w-[6px] h-[6px] rounded-full ${
                it.level === LEVEL.BAD ? "bg-danger" : it.level === LEVEL.WARN ? "bg-orange" : "bg-success"
              }`} />
            )}
            {it.kind === "feed" ? it.key : it.kind === "publication" ? "публикация" : it.kind === "coverage" ? "покрытие" : "каналы"}
            <span className="opacity-70">· {it.note}</span>
          </span>
        ))}
      </div>

      <div className="bg-card rounded-card-2 px-6 py-5">
        <div className="flex items-center gap-2.5 text-[12.5px] text-muted mb-4 flex-wrap">
          <span className="bg-cream rounded-full px-3 py-1.5 text-[12px] text-[#6B675C]">
            {block?.kind === "manual" ? "Источник: вручную" : block?.kind === "auto" ? `Источник: ${block?.config?.provider || "авто"}` : "Производный от базового блока"}
          </span>
          {block?.code === "usdt" && (
            <span className="bg-cream rounded-full px-3 py-1.5 text-[12px] text-[#6B675C]">
              USD — процент · TRY и EUR — абсолют
            </span>
          )}
          <span className="ml-auto">
            {published ? `опубликовано v. ${published.version}` : "публикаций ещё нет"}
          </span>
        </div>

        {showScopeNote && (
          <div className="mb-4 text-[12px] text-faint">
            действует в: {block.scopes.join(" · ")} — курс общий, по городам не делится
          </div>
        )}

        {showScopes && (
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {block.scopes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveScope(s)}
                className={`text-[12px] px-[15px] py-[7px] rounded-full border transition-colors ${
                  s === activeScope ? "bg-ink text-cream border-ink" : "border-line-2 text-[#6B675C] hover:text-ink"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {renderBody()}

        {/* АУДИТ КАЖДОЙ КОТИРОВКИ. Границы band_pct сравнивают со вчерашней
            ценой и бессильны, если вчера уже было неверно. Рынок — свидетель
            со стороны, поэтому спорные строки перечислены поимённо. */}
        {audit.orientation.map((o) => (
          <div key={o.pair} className="flex items-start gap-2.5 mt-3.5 bg-danger-soft rounded-[16px] px-4 py-3 text-[12.5px] text-danger">
            <span className="w-[19px] h-[19px] rounded-[6px] bg-danger text-white text-[12px] flex items-center justify-center shrink-0">!</span>
            <span>
              <b className="font-normal">{o.pair} уходит в двух разных единицах.</b> {o.note}.
              <br />
              {o.examples.join("   ·   ")}
            </span>
          </div>
        ))}

        {audit.quotes.filter((q) => q.verdict === VERDICT.BAD).map((q) => (
          <div key={`${q.block}|${q.scope}|${q.from}|${q.to}`} className="flex items-center gap-2.5 mt-2 bg-danger-soft rounded-[16px] px-4 py-2.5 text-[12.5px] text-danger">
            <span className="w-[19px] h-[19px] rounded-[6px] bg-danger text-white text-[12px] flex items-center justify-center shrink-0">!</span>
            {q.block} {q.scope ? `· ${String(q.scope).slice(0, 8)} ` : ""}{q.from} → {q.to} = {fmtRate(q.rate)} — {q.note}
          </div>
        ))}

        {computed.violations.map((v) => (
          <div key={v.key} className="flex items-center gap-2.5 mt-3.5 bg-danger-soft rounded-[16px] px-4 py-3 text-[12.5px] text-danger">
            <span className="w-[19px] h-[19px] rounded-[6px] bg-danger text-white text-[12px] flex items-center justify-center shrink-0">!</span>
            {v.from} → {v.to} отличается от последней публикации на{" "}
            {Math.abs(v.deviationPct).toFixed(1)}% при границе ±{v.bandPct}%. Исправьте значение — публикация заблокирована.
          </div>
        ))}

        <div className="mt-3 text-[11.5px] text-faint">
          в публикацию войдёт {computed.prices.length} строк
          {computed.errors.length > 0 && ` · ${computed.errors.length} без значений`}
          {computed.closed?.length > 0 && ` · ${computed.closed.length} не торгуем`}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line mt-5 pt-4.5">
          <div className="text-[12.5px] text-muted leading-relaxed">
            <b className="text-ink font-normal">
              Изменится {summary.count} курсов в {summary.blocks} блоках.
            </b>
            <br />
            Уйдёт в: <span className="text-orange-ink">никуда — тестовый режим, мост не включён</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { setDraft({}); setLocks({}); setClosed({}); setResult(null); }}
              disabled={!dirty}
              className="rounded-full border border-line-2 text-[#6B675C] text-[13px] px-[18px] py-2.5 disabled:opacity-40"
            >
              Отменить
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={blocked || busy || summary.count === 0}
              title={blocked ? (auditBad > 0 ? "Есть котировки, спорные по сверке с рынком" : "Есть значения вне границ") : undefined}
              className={`rounded-full text-[13px] px-[18px] py-2.5 inline-flex items-center gap-2 ${
                blocked || summary.count === 0
                  ? "bg-line-2 text-[#6B675C] cursor-not-allowed"
                  : "bg-ink text-cream hover:bg-black"
              }`}
            >
              {blocked ? <Lock className="w-3.5 h-3.5" /> : busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Опубликовать v. {nextVersion}
            </button>
          </div>
        </div>

        {result && (
          <div className={`mt-3.5 rounded-[16px] px-4 py-3 text-[12.5px] ${result.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
            {result.ok
              ? `Опубликовано v. ${result.version} · ${result.prices_count} цен. В каналы не ушло — тестовый режим.`
              : `${result.error}${result.stale ? `: ${result.stale.map((s) => `${s.provider} (${s.age_min} мин)`).join(", ")}` : ""}`}
          </div>
        )}
        {err && <div className="mt-3 text-[12.5px] text-danger">{err}</div>}
      </div>

      {paste && (
        <PasteWindow
          text={paste.text}
          parsed={paste.parsed}
          onText={onPasteText}
          onApply={applyPaste}
          onClose={() => setPaste(null)}
        />
      )}
    </div>
  );
}

/**
 * Окно вставки утреннего документа. Заполняет ЧЕРНОВИК, а не публикует:
 * между «вставил» и «ушло клиентам» остаётся человек, смотрящий на превью.
 */
function PasteWindow({ text, parsed, onText, onApply, onClose }) {
  const s = pasteSummary(parsed);
  const BLOCK_TITLE = { usdt: "USDT", qr: "QR", nerez: "НЕРЕЗ", cash: "Нал", perestanovka: "Перестановки" };
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-card rounded-card-2 w-full max-w-[720px] max-h-[86vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-[17px]">Вставить курсы</span>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full border border-line-2 text-muted hover:text-ink flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => onText(e.target.value)}
          rows={10}
          autoFocus
          placeholder={"ANT\nUSDT -> USD  -1,00%\nUSDT -> TRY  45,50"}
          className="w-full bg-cream rounded-[16px] px-4 py-3 text-[13px] leading-relaxed outline-none border border-transparent focus:border-ink font-mono"
        />

        <div className="mt-3.5 text-[12.5px] text-muted">
          {s.total === 0 && text.trim() === "" && "Вставьте документ — распознавание пойдёт сразу."}
          {(s.total > 0 || (text.trim() !== "" && s.unmatched > 0)) && (
            <>
              Распознано <b className="text-ink font-normal">{s.total}</b> значений
              {Object.keys(s.byBlock).length > 0 && (
                <> · {Object.entries(s.byBlock).map(([b, n]) => `${BLOCK_TITLE[b] || b}: ${n}`).join(" · ")}</>
              )}
            </>
          )}
        </div>

        {parsed.unmatched.length > 0 && (
          <div className="mt-3 bg-orange-bg rounded-[16px] px-4 py-3">
            <div className="text-[12.5px] text-orange-ink mb-1.5">
              Не распознано {parsed.unmatched.length} — эти строки просто не применятся, остальное встанет.
            </div>
            <ul className="text-[12px] text-orange-ink/85 space-y-0.5 max-h-[140px] overflow-auto">
              {parsed.unmatched.map((u, i) => (
                <li key={i} className="truncate">· {u.raw || "—"} <span className="opacity-70">({u.reason})</span></li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 mt-5">
          <span className="text-[12px] text-faint">Заполняет черновик — публикация остаётся отдельным действием.</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full border border-line-2 text-[#6B675C] text-[13px] px-[18px] py-2.5">
              Отмена
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={s.total === 0}
              className={`rounded-full text-[13px] px-[18px] py-2.5 ${s.total === 0 ? "bg-line-2 text-[#6B675C] cursor-not-allowed" : "bg-ink text-cream hover:bg-black"}`}
            >
              Заполнить черновик
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
