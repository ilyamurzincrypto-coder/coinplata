// src/components/deal-form/DealClientAutocomplete.jsx
//
// Поиск контрагента в форме сделки. Список из useTransactions().counterparties,
// поиск substring case-insensitive по nickname/name/telegram. Подсветка
// совпадения через <mark>. Keyboard: ↑↓ Enter Esc.
//
// counterparty shape: { id, nickname, name, telegram, tag, note }
// (см. src/store/transactions.jsx).

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Search, Plus, X } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";

// ── Helpers ────────────────────────────────────────────────────────────
function initialsOf(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || s[0].toUpperCase();
}

// Стабильный цвет аватара по имени (hash → palette index)
const AVATAR_GRADIENTS = [
  "from-rose-400 to-orange-500",
  "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-600",
  "from-cyan-400 to-blue-600",
  "from-violet-400 to-indigo-600",
  "from-fuchsia-400 to-purple-600",
  "from-pink-400 to-rose-600",
  "from-lime-400 to-emerald-600",
];
function avatarGradient(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

// Подсветка совпадения в строке
function HighlightedText({ text, query }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-warning-soft px-0.5 text-ink font-bold rounded-[2px]">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

export default function DealClientAutocomplete({
  value,
  onChange,
  onSelectClient,
  placeholder = "Имя клиента или контрагента",
  autoFocus = false,
}) {
  const { counterparties, addCounterparty } = useTransactions();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  // Фильтрация
  const results = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    if (!q) return counterparties.slice(0, 20);
    return counterparties
      .filter((c) => {
        const fields = [c.nickname, c.name, c.telegram, c.tag].filter(Boolean).map((s) => s.toLowerCase());
        return fields.some((f) => f.includes(q));
      })
      .slice(0, 20);
  }, [counterparties, value]);

  // Reset highlight при изменении results
  useEffect(() => { setHi(0); }, [value]);

  // Click-outside close
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selectClient = useCallback((c) => {
    onChange(c.nickname);
    onSelectClient?.(c);
    setOpen(false);
    inputRef.current?.blur();
  }, [onChange, onSelectClient]);

  const createNew = useCallback(() => {
    const q = (value || "").trim();
    if (!q) return;
    const created = addCounterparty(q);
    if (created) selectClient(created);
  }, [value, addCounterparty, selectClient]);

  const onKeyDown = useCallback((e) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, results.length));  // last = "Create new"
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hi < results.length) selectClient(results[hi]);
      else createNew();
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }, [open, results, hi, selectClient, createNew]);

  const showCreate = value && value.trim() && !results.some((c) => c.nickname.toLowerCase() === value.trim().toLowerCase());

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-md">
      <div className="flex items-center gap-2 h-10 px-3.5 rounded-input bg-surface-sunk ring-1 ring-inset ring-transparent focus-within:bg-surface focus-within:ring-accent focus-within:shadow-input-focus transition-all duration-150 ease-apple">
        <Search className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2.2} />
        <input
          ref={inputRef}
          type="text"
          value={value || ""}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent text-body text-ink placeholder:text-muted-soft outline-none border-0"
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(""); inputRef.current?.focus(); }}
            className="p-0.5 rounded text-muted hover:text-ink hover:bg-surface-soft transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {open && (results.length > 0 || showCreate) && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface rounded-card border border-border shadow-soft-deep z-50 overflow-hidden max-h-[420px] overflow-y-auto">
          {results.length > 0 && (
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-bold text-muted-soft">
              {value ? "Совпадения" : "Последние"}
            </div>
          )}
          {results.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setHi(i)}
              onClick={() => selectClient(c)}
              className={`w-full grid grid-cols-[32px_1fr_auto] items-center gap-3 px-3.5 py-2.5 transition-colors text-left ${
                i === hi ? "bg-surface-soft" : "hover:bg-surface-soft"
              }`}
            >
              <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradient(c.nickname || c.id)} text-white text-[11px] font-bold flex items-center justify-center shrink-0`}>
                {initialsOf(c.nickname || c.name)}
              </div>
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-ink truncate flex items-center gap-2">
                  <HighlightedText text={c.nickname || c.name || "—"} query={value} />
                  {c.telegram && (
                    <span className="text-caption text-muted font-normal truncate">{c.telegram}</span>
                  )}
                </div>
                {c.tag && (
                  <div className="text-tiny text-muted truncate">
                    <HighlightedText text={c.tag} query={value} />
                  </div>
                )}
              </div>
              <span className="text-tiny text-muted-soft font-mono shrink-0">
                {c.id?.slice(-4)}
              </span>
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseEnter={() => setHi(results.length)}
              onClick={createNew}
              className={`w-full grid grid-cols-[32px_1fr] items-center gap-3 px-3.5 py-3 border-t border-border-soft transition-colors text-left ${
                hi === results.length ? "bg-accent-bg" : "hover:bg-accent-bg"
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-accent-soft text-success flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-ink truncate">
                  Создать клиента «{value.trim()}»
                </div>
                <div className="text-tiny text-muted">
                  если не нашли в списке
                </div>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
