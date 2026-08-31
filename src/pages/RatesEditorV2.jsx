// src/pages/RatesEditorV2.jsx
// Новый редактор курсов (фаза 2а, PR-B1) — Экран 2 эталона r8.
// За флагом rates_v2_ui. Старый редактор нетронут и живёт по старому маршруту.
//
// PR-B1 — критический путь до первой публикации: каркас вкладок + вкладка
// USDT целиком. Остальные вкладки — честная заглушка «в PR-B2», а не пустой
// экран: блок виден, его строки видны, но редактирование ещё не включено.
//
// ЧЕРНОВИК ЖИВЁТ В СТЕЙТЕ: до кнопки «Опубликовать» в базу не уходит ни один
// запрос. Превью «Клиенту» считается тем же rateEngine, что и публикация, —
// в UI нет ни одной собственной формулы.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Loader2, X } from "lucide-react";
import { computeAll, pricesToMap, priceKey, deviationPct, num } from "../lib/rateEngine.js";
import { loadBlocks, loadPublished, publishedMap, publishRates, officeCityMap, V2_BANNER } from "../lib/ratesV2.js";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";

const fmtRate = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

// Подпись значения «Было» в единицах строки: проценты показываем процентами.
function fmtWas(row, prevRate) {
  if (prevRate == null) return "—";
  if (row.value_mode === "pct") {
    const pct = (prevRate - 1) * 100;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }
  return fmtRate(prevRate);
}

export default function RatesEditorV2({ onClose }) {
  const { activeOffices } = useOffices();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "owner" || currentUser?.role === "admin";

  const [blocks, setBlocks] = useState(null);
  const [published, setPublished] = useState(null);
  const [activeBlock, setActiveBlock] = useState(null);
  const [activeScope, setActiveScope] = useState(null);
  const [draft, setDraft] = useState({});           // rowId → строка ввода
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);        // ответ RPC

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [bs, pub] = await Promise.all([loadBlocks(), loadPublished()]);
        if (!alive) return;
        setBlocks(bs);
        setPublished(pub);
        const first = bs.find((b) => b.enabled) || bs[0];
        setActiveBlock(first?.code || null);
        setActiveScope(first?.scopes?.[0] || null);
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  const officeCity = useMemo(() => officeCityMap(activeOffices), [activeOffices]);
  const prevMap = useMemo(() => publishedMap(published), [published]);
  const block = useMemo(() => (blocks || []).find((b) => b.code === activeBlock) || null, [blocks, activeBlock]);

  // Строки блока для текущего чипа. scope null = строка на все измерения блока.
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
        // черновик перекрывает сохранённое значение строки
        value: Object.prototype.hasOwnProperty.call(draft, r.id) ? draft[r.id] : r.value,
      }))
    );
  }, [blocks, draft]);

  const computed = useMemo(() => {
    if (!blocks) return { prices: [], errors: [], violations: [] };
    return computeAll({
      blocks: (blocks || []).map((b) => ({ ...b, config: b.config || {} })),
      rows: engineRows,
      sources: {},          // auto-блоки — PR-B2
      previous: prevMap,
      officeCity,
    });
  }, [blocks, engineRows, prevMap, officeCity]);

  const priceMap = useMemo(() => pricesToMap(computed.prices), [computed.prices]);
  const violByKey = useMemo(
    () => Object.fromEntries((computed.violations || []).map((v) => [v.key, v])),
    [computed.violations]
  );

  // Сводка: сколько строк реально изменилось против последней публикации.
  const summary = useMemo(() => {
    const changed = computed.prices.filter((p) => {
      const k = priceKey({ block: p.block, scope: p.scope, from: p.from, to: p.to });
      const prev = prevMap[k];
      return prev == null || Math.abs(prev - p.rate) > 1e-9;
    });
    const blocksTouched = new Set(changed.map((c) => c.block));
    return { count: changed.length, blocks: blocksTouched.size };
  }, [computed.prices, prevMap]);

  const nextVersion = (published?.version || 0) + 1;
  const blocked = computed.violations.length > 0;

  const setValue = useCallback((rowId, raw) => {
    setResult(null);
    setDraft((d) => ({ ...d, [rowId]: raw }));
  }, []);

  const onPublish = useCallback(async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const res = await publishRates({
        inputs: draft,
        prices: computed.prices,
        sourceMeta: { editor: "v2", shadow: true },
      });
      setResult(res);
      if (res?.ok) {
        setDraft({});
        setPublished(await loadPublished());
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, computed.prices]);

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
          {Object.keys(draft).length > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-orange-bg text-orange-ink text-[13px] px-4 py-2">
              <span className="w-[7px] h-[7px] rounded-full bg-orange" />
              Черновик · не опубликован
            </span>
          )}
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
            {b.scopes?.length > 1 && <span className="opacity-70"> · {b.scopes.length}</span>}
          </button>
        ))}
        {isAdmin && (
          <button type="button" disabled title="в PR-B2" className="rounded-full text-[13px] px-[18px] py-2.5 text-muted opacity-50 cursor-not-allowed">
            + блок
          </button>
        )}
      </div>

      <div className="bg-card rounded-card-2 px-6 py-5">
        {/* Строка источника */}
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

        {/* Чипы измерений блока (города / базисы / маршруты) */}
        {block?.scopes?.length > 0 && (
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {block.scopes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveScope(s)}
                className={`text-[12px] px-[15px] py-[7px] rounded-full border transition-colors ${
                  s === activeScope ? "bg-ink text-cream border-ink" : "border-line-2 text-[#6B675C] hover:text-ink"
                }`}
                title={s.includes("→") ? "маршрут офисов" : undefined}
              >
                {s.includes("→") ? "маршрут" : s}
              </button>
            ))}
          </div>
        )}

        {block?.code !== "usdt" ? (
          <div className="py-10 text-center">
            <div className="text-[14px] text-muted">Вкладка «{block?.title}» — в PR-B2</div>
            <div className="text-[12px] text-faint mt-1.5">
              {visibleRows.length} строк уже в модели; редактирование включится следующим PR
            </div>
          </div>
        ) : (
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
                const key = priceKey({ block: block.code, scope: r.scope, from: r.from_ccy, to: r.to_ccy });
                const viol = violByKey[key];
                const rate = priceMap[key];
                const drafted = Object.prototype.hasOwnProperty.call(draft, r.id);
                const shown = drafted ? draft[r.id] : r.value ?? "";
                return (
                  <tr key={r.id}>
                    <td className="py-3 border-t border-line text-[14px]">
                      {r.from_ccy} → {r.to_ccy}
                    </td>
                    <td className="py-3 border-t border-line font-light text-[19px] text-faint tabular-nums">
                      {fmtWas(r, prevMap[key])}
                    </td>
                    <td className="py-3 border-t border-line">
                      <input
                        value={shown}
                        onChange={(e) => setValue(r.id, e.target.value)}
                        inputMode="decimal"
                        placeholder={r.value_mode === "pct" ? "0,00%" : "0,00"}
                        className={`font-light text-[19px] tabular-nums rounded-[14px] px-3.5 py-2 w-[126px] outline-none border ${
                          viol ? "border-danger bg-danger-soft text-danger" : "border-transparent bg-cream focus:border-ink"
                        }`}
                      />
                    </td>
                    <td className="py-3 border-t border-line text-right">
                      {viol ? (
                        <span className="text-[12px] text-danger">вне границ</span>
                      ) : (
                        <span className="font-light text-[23px] tabular-nums">{fmtRate(rate)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Нарушения границ — с процентом отклонения, как в эталоне */}
        {computed.violations.map((v) => (
          <div key={v.key} className="flex items-center gap-2.5 mt-3.5 bg-danger-soft rounded-[16px] px-4 py-3 text-[12.5px] text-danger">
            <span className="w-[19px] h-[19px] rounded-[6px] bg-danger text-white text-[12px] flex items-center justify-center shrink-0">!</span>
            {v.from} → {v.to} отличается от последней публикации на{" "}
            {Math.abs(v.deviationPct).toFixed(1)}% при границе ±{v.bandPct}%. Исправьте значение — публикация заблокирована.
          </div>
        ))}

        {/* Ошибки расчёта (нет значения / нет базовой цены) — не блокируют, но видны */}
        {computed.errors.length > 0 && (
          <div className="mt-3 text-[11.5px] text-faint">
            не посчитано строк: {computed.errors.length} — пустые значения и блоки из PR-B2
          </div>
        )}

        {/* Сводка + публикация */}
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
              onClick={() => { setDraft({}); setResult(null); }}
              disabled={Object.keys(draft).length === 0}
              className="rounded-full border border-line-2 text-[#6B675C] text-[13px] px-[18px] py-2.5 disabled:opacity-40"
            >
              Отменить
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={blocked || busy || summary.count === 0}
              title={blocked ? "Есть значения вне границ" : undefined}
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

        {/* Ответ RPC — списком, без интерпретации */}
        {result && (
          <div className={`mt-3.5 rounded-[16px] px-4 py-3 text-[12.5px] ${result.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
            {result.ok
              ? `Опубликовано v. ${result.version} · ${result.prices_count} цен. В каналы не ушло — тестовый режим.`
              : `${result.error}${result.stale ? `: ${result.stale.map((s) => `${s.provider} (${s.age_min} мин)`).join(", ")}` : ""}`}
          </div>
        )}
        {err && <div className="mt-3 text-[12.5px] text-danger">{err}</div>}
      </div>
    </div>
  );
}
