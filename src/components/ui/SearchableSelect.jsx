// src/components/ui/SearchableSelect.jsx
// Compact searchable single-select combobox over `options: [{ id, name }]`.
// Renders as a button (showing the selected option's name, or `placeholder`);
// clicking opens an absolute-positioned panel with a search input and a
// filtered list. Outside-click / Escape closes; Enter on the search input
// picks the first visible match. Matches the app's slate-50 / rounded-[8px]
// form-control look so it can drop into existing tables next to other inputs.
//
// API
//   value        — selected id (string) or null/""
//   onChange     — (id|null) => void
//   options      — Array<{ id: string, name: string, searchText?: string }>
//                  `searchText` (when present) is matched in addition to `name`,
//                  e.g. so an account row can be found by code or subtype.
//   placeholder  — text shown when nothing selected
//   error        — boolean: red border when true
//   disabled     — boolean
//   emptyText    — shown inside the dropdown when filter has no matches
//
// Out of scope (v1): keyboard arrows, multi-select, "create new" entry, grouped sections.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

function normalize(s) {
  return (s || "").toString().toLowerCase().trim();
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "—",
  error = false,
  disabled = false,
  emptyText = "Ничего не найдено",
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(
    () => (value ? (options || []).find((o) => o.id === value) || null : null),
    [value, options]
  );

  const filtered = useMemo(() => {
    const nq = normalize(q);
    if (!nq) return options || [];
    return (options || []).filter((o) => normalize(o.name).includes(nq) || (o.searchText && normalize(o.searchText).includes(nq)));
  }, [q, options]);

  // Outside click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Reset query and focus input each time we open.
  useEffect(() => {
    if (open) {
      setQ("");
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const pick = (id) => { onChange(id || null); setOpen(false); };
  const onEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0) pick(filtered[0].id);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0 w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`flex items-center gap-1 min-w-0 w-full bg-surface-soft border rounded-[8px] px-2 py-1 text-[12px] outline-none text-left
          ${error ? "border-danger/40" : "border-border-soft"} ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-white"}`}
      >
        <span className={`flex-1 min-w-0 truncate ${selected ? "" : "text-muted-soft"}`}>
          {selected ? selected.name : placeholder}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-soft shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 bg-white border border-border-soft rounded-[8px] shadow-lg min-w-[220px]">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-soft">
            <Search className="w-3 h-3 text-muted-soft shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onEnter}
              placeholder="Поиск…"
              className="flex-1 min-w-0 bg-transparent text-[12px] outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-[12px] text-muted-soft">{emptyText}</li>
            ) : (
              filtered.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => pick(o.id)}
                    className={`w-full text-left px-2 py-1.5 text-[12px] hover:bg-surface-soft ${o.id === value ? "font-semibold text-ink" : "text-ink-soft"}`}
                  >
                    {o.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
