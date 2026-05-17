// src/components/balances/BalanceSubLine.jsx
//
// Per-row toggle USD-эквивалент ⇄ дельты «сегодня · вчера».
// Кликается под суммой в каждой строке Balances. Состояние per-row
// сохраняется в localStorage; при отсутствии storage (private mode)
// fallback на in-memory useState — никаких ошибок.
//
// Pre-formatted строки не принимаем — работаем с числами + fmtDelta
// helper'ом внутри. Это упрощает API и устраняет парсинг знака.
//
// Если показывать USD нечего (base === native) — рендерится только
// delta без переключения. Если нет ни USD ни дельты — компонент
// возвращает null (zero-row case покрывает родитель).
import React, { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { fmt, curSymbol } from "../../utils/money.js";

const STORAGE_KEY = "coinplata:balance-sub-modes";

function loadModes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Повреждённый JSON или storage недоступен — стартуем с пустого объекта,
    // следующий toggle перепишет ключ корректно.
    return {};
  }
}

function saveModes(modes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // private-mode / quota — игнорируем, состояние работает в памяти
  }
}

function fmtDelta(value, currency) {
  const v = Number.isFinite(value) ? value : 0;
  const sym = curSymbol(currency);
  if (Math.abs(v) < 0.01) return `+${sym}0`;
  const sign = v > 0 ? "+" : "−";
  return `${sign}${sym}${fmt(Math.abs(v), currency)}`;
}

function deltaTone(v) {
  if (!Number.isFinite(v)) return "";
  if (v > 0.01) return "text-success font-semibold";
  if (v < -0.01) return "text-danger font-semibold";
  return "";
}

export default function BalanceSubLine({
  rowId,
  usdEquivalent,    // number — native amount в base валюте
  baseCcy,          // тикер базовой (USD/EUR)
  nativeCcy,        // тикер native валюты (USDT/TRY/EUR/…)
  deltaToday,       // number
  deltaYesterday,   // number (optional)
}) {
  const hasUsd = baseCcy && nativeCcy && baseCcy !== nativeCcy && Number.isFinite(usdEquivalent);
  const hasDelta = Number.isFinite(deltaToday) || Number.isFinite(deltaYesterday);
  const canToggle = hasUsd && hasDelta;

  const [mode, setMode] = useState(() => {
    if (!canToggle) return hasUsd ? "usd" : "delta";
    const modes = loadModes();
    return modes[rowId] === "delta" ? "delta" : "usd";
  });

  if (!hasUsd && !hasDelta) return null;

  const toggle = (e) => {
    e.stopPropagation();
    if (!canToggle) return;
    const next = mode === "usd" ? "delta" : "usd";
    setMode(next);
    const modes = loadModes();
    modes[rowId] = next;
    saveModes(modes);
  };

  const usdContent = (
    <span className="font-mono tabular">
      ≈ {curSymbol(baseCcy)}{fmt(usdEquivalent, baseCcy)}
    </span>
  );

  const deltaContent = (
    <span className="font-mono tabular">
      <span className={deltaTone(deltaToday)}>{fmtDelta(deltaToday, nativeCcy)}</span>
      <span className="opacity-60 font-normal ml-1">сегодня</span>
      {Number.isFinite(deltaYesterday) && (
        <>
          <span className="text-muted-soft mx-1.5">·</span>
          <span className={deltaTone(deltaYesterday)}>{fmtDelta(deltaYesterday, nativeCcy)}</span>
          <span className="opacity-60 font-normal ml-1">вчера</span>
        </>
      )}
    </span>
  );

  const content = mode === "usd" ? usdContent : deltaContent;

  // Если переключатель не нужен (есть только одно из значений) —
  // рендерим plain текст, без cursor/hover/иконки.
  if (!canToggle) {
    return <div className="text-caption text-muted">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="group relative inline-flex items-center gap-1 px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded-md text-caption text-muted hover:text-ink hover:bg-surface-sunk transition-colors duration-150 ease-apple cursor-pointer select-none"
      aria-label={mode === "usd" ? "Показать дельты «сегодня · вчера»" : "Показать USD-эквивалент"}
    >
      {content}
      <ArrowLeftRight
        size={9}
        strokeWidth={2.2}
        className="text-accent opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0"
      />
    </button>
  );
}
