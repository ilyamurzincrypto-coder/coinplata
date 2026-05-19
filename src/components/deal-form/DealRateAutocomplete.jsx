// src/components/deal-form/DealRateAutocomplete.jsx
//
// Dropdown подсказок курсов внутри чёрной rate-капсулы.
// Источники:
//   • Текущий выбранный офис (Office override если есть)
//   • Все остальные активные офисы
//   • Global rate (без overrides)
// Отображение: значение mono + офис + age-pill (fresh/mid/stale).
// Курсы инвертируются через displayRate если raw < 1 (читаемый формат).

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRates } from "../../store/rates.jsx";
import { useOffices } from "../../store/offices.jsx";
import { freshnessOf, shortAge } from "../../utils/rateFreshness.jsx";
import { displayRate, formatRate } from "../../lib/rates.js";

// ── Helpers ────────────────────────────────────────────────────────────
function ageTone(ageMs) {
  if (!Number.isFinite(ageMs)) return { cls: "bg-surface-sunk text-muted", label: "—" };
  const days = ageMs / (24 * 60 * 60 * 1000);
  if (days <= 1) return { cls: "bg-success-soft text-success", label: shortAge(ageMs) };
  if (days <= 3) return { cls: "bg-warning-soft text-warning", label: shortAge(ageMs) };
  return { cls: "bg-danger-soft text-danger", label: shortAge(ageMs) };
}

export default function DealRateAutocomplete({
  value,
  onChange,           // (string) → запись в state курса
  onSelect,           // (suggestionObj) → callback при выборе
  from,
  to,
  inputClassName = "",
  inputProps = {},
  dark = true,        // true → стиль для чёрной капсулы, false — для светлой
}) {
  const { getRate: getRateRaw, pairs: ratePairs, channels: rateChannels } = useRates();
  const { activeOffices } = useOffices();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  // Поиск updatedAt для пары — копия логики из RatesSidebar
  const pairUpdatedAt = useCallback((officeId) => {
    if (!Array.isArray(ratePairs) || !Array.isArray(rateChannels)) return null;
    const matches = ratePairs.filter((p) => {
      const fromCh = rateChannels.find((c) => c.id === p.fromChannelId);
      const toCh = rateChannels.find((c) => c.id === p.toChannelId);
      const fc = fromCh?.currencyCode;
      const tc = toCh?.currencyCode;
      // Office override → берём по officeId; Global → берём global default pairs
      return (
        p.isDefault &&
        ((fc === from && tc === to) || (fc === to && tc === from))
      );
    });
    if (matches.length === 0) return null;
    let latest = null;
    matches.forEach((m) => {
      if (!m.updatedAt) return;
      const t = new Date(m.updatedAt).getTime();
      if (Number.isFinite(t) && (!latest || t > latest)) latest = t;
    });
    return latest ? new Date(latest) : null;
  }, [ratePairs, rateChannels, from, to]);

  // Собираем источники: Global + каждый офис.
  const suggestions = useMemo(() => {
    if (!from || !to || from === to) return [];
    const list = [];
    // Global
    const globalRaw = getRateRaw(from, to, null);
    if (Number.isFinite(globalRaw) && globalRaw > 0) {
      const d = displayRate(globalRaw, from, to);
      list.push({
        key: "__global__",
        officeName: "Global",
        rawRate: globalRaw,
        display: d,
        updatedAt: pairUpdatedAt(null),
      });
    }
    // Каждый активный офис
    (activeOffices || []).forEach((off) => {
      const r = getRateRaw(from, to, off.id);
      if (!Number.isFinite(r) || r <= 0) return;
      // Не дублируем если совпадает с Global (нет override)
      if (Number.isFinite(globalRaw) && Math.abs(r - globalRaw) < 1e-9) return;
      const d = displayRate(r, from, to);
      list.push({
        key: off.id,
        officeName: off.name || "Office",
        rawRate: r,
        display: d,
        updatedAt: pairUpdatedAt(off.id),
      });
    });
    return list;
  }, [from, to, getRateRaw, activeOffices, pairUpdatedAt]);

  useEffect(() => { setHi(0); }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = useCallback((s) => {
    const valueToSet = formatRate(s.display.rate);
    onChange(valueToSet);
    onSelect?.(s);
    setOpen(false);
    inputRef.current?.blur();
  }, [onChange, onSelect]);

  const onKeyDown = useCallback((e) => {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && suggestions[hi]) {
      e.preventDefault();
      pick(suggestions[hi]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }, [open, suggestions, hi, pick]);

  return (
    <div ref={wrapRef} className="relative inline-flex flex-col">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="0.0000"
        autoComplete="off"
        className={inputClassName}
        {...inputProps}
      />
      {open && (
        <div className={`absolute top-full left-0 mt-2 rounded-card border shadow-soft-deep z-50 overflow-hidden min-w-[300px] ${
          dark ? "bg-surface text-ink border-border" : "bg-surface border-border"
        }`}>
          {suggestions.length > 0 ? (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-bold text-muted-soft">
                Курсы из офисов
              </div>
              {suggestions.map((s, i) => {
                const tone = ageTone(freshnessOf(s.updatedAt).ageMs);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(s)}
                    className={`w-full grid grid-cols-[80px_1fr_auto] items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      i === hi ? "bg-surface-soft" : "hover:bg-surface-soft"
                    }`}
                  >
                    <span className="font-mono tabular text-body-sm font-bold text-ink">
                      {formatRate(s.display.rate)}
                    </span>
                    <span className="text-caption text-ink-soft truncate">
                      {s.officeName}
                    </span>
                    <span className={`inline-flex items-center h-4 px-1.5 rounded font-mono text-[9px] font-bold ${tone.cls}`}>
                      {tone.label}
                    </span>
                  </button>
                );
              })}
              <div className="px-3 py-1.5 bg-surface-soft text-tiny text-muted flex items-center gap-3 border-t border-border-soft">
                <span><kbd className="px-1 rounded bg-surface border border-border font-mono text-[10px]">↑↓</kbd> выбрать</span>
                <span><kbd className="px-1 rounded bg-surface border border-border font-mono text-[10px]">↵</kbd> применить</span>
                <span><kbd className="px-1 rounded bg-surface border border-border font-mono text-[10px]">Esc</kbd> закрыть</span>
              </div>
            </>
          ) : (
            <div className="px-3 py-4 text-center text-caption text-muted">
              Нет курсов для пары {from} → {to}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
