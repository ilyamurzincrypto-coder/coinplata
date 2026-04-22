// src/components/AccountSelect.jsx
// Searchable dropdown для выбора счёта. Заменяет pill-кнопки в ExchangeForm.
// Принимает отфильтрованный список accounts (обычно по office + currency) и текущий accountId.
// Фильтрация НЕ делается внутри — вызывающий код сам решает что показывать.

import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Search, Check, X, Wallet } from "lucide-react";

// Иконки типов счетов (дублирует ACCOUNT_TYPE_ICONS из store/data, но для изоляции)
const TYPE_ICONS = {
  bank: "🏦",
  cash: "💵",
  crypto: "🪙",
  exchange: "📈",
};

export default function AccountSelect({
  accounts,
  value,
  onChange,
  placeholder = "Select account…",
  allowClear = true,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);

  const selected = accounts.find((a) => a.id === value) || null;

  // Закрытие по клику вне
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Автофокус на поиск при открытии
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.currency.toLowerCase().includes(q) ||
        (a.type || "").toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const handlePick = (id) => {
    onChange(id);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full bg-slate-50 border rounded-[10px] px-3 py-2.5 text-left flex items-center gap-2 transition-colors ${
          open
            ? "border-slate-400 bg-white ring-2 ring-slate-900/10"
            : "border-slate-200 hover:border-slate-300"
        }`}
      >
        {selected ? (
          <>
            <span className="text-[15px]">{TYPE_ICONS[selected.type] || "•"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-slate-900 truncate">{selected.name}</div>
              <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                {selected.currency} · {selected.type}
              </div>
            </div>
          </>
        ) : (
          <>
            <Wallet className="w-3.5 h-3.5 text-slate-400" />
            <span className="flex-1 text-[13px] text-slate-400">{placeholder}</span>
          </>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Clear button (outside trigger to not conflict click) */}
      {selected && allowClear && !open && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
          }}
          className="absolute top-1/2 right-8 -translate-y-1/2 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
          title="Clear"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-40 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-[12px] shadow-xl shadow-slate-900/10 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate-100 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, currency…"
              className="w-full pl-7 pr-2 py-1.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-300 rounded-[8px] text-[12px] outline-none placeholder:text-slate-400"
            />
          </div>

          {/* List */}
          <div className="max-h-56 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-[12px] text-slate-400">
                No accounts match
              </div>
            )}
            {filtered.map((a) => {
              const isActive = a.id === value;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handlePick(a.id)}
                  className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${
                    isActive ? "bg-slate-900 text-white" : "hover:bg-slate-50 text-slate-900"
                  }`}
                >
                  <span className="text-[14px]">{TYPE_ICONS[a.type] || "•"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">{a.name}</div>
                    <div
                      className={`text-[10px] font-medium uppercase tracking-wider ${
                        isActive ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      {a.currency} · {a.type}
                    </div>
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
