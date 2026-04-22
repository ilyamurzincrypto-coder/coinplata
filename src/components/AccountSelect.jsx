// src/components/AccountSelect.jsx
// Searchable dropdown для выбора счёта с разделением по офисам.
// Если передан currentOfficeId и есть счета другого офиса — список рендерится
// в две секции: "Current office (<name>)" сверху, "Other offices" снизу
// (внутри — группировка по офисам).
//
// Это поддержка interoffice transfers: выбор счёта другого офиса НЕ является
// обычным deposit — см. логику ExchangeForm и TransactionsTable.

import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Search, Check, X, Wallet, Building2, ArrowLeftRight } from "lucide-react";
import { useOffices } from "../store/offices.jsx";

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
  currentOfficeId = null,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);
  const { offices } = useOffices();

  const officeName = (id) => offices.find((o) => o.id === id)?.name || id;

  const selected = accounts.find((a) => a.id === value) || null;
  const isInteroffice = !!(selected && currentOfficeId && selected.officeId !== currentOfficeId);

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
        (a.type || "").toLowerCase().includes(q) ||
        officeName(a.officeId).toLowerCase().includes(q)
    );
  }, [accounts, search, offices]);

  // Секции: current (если currentOfficeId задан) + other offices grouped.
  const sections = useMemo(() => {
    if (!currentOfficeId) {
      // Одна секция без заголовков.
      return [{ id: "__flat__", label: null, accounts: filtered }];
    }
    const current = [];
    const otherByOffice = new Map();
    filtered.forEach((a) => {
      if (a.officeId === currentOfficeId) {
        current.push(a);
      } else {
        if (!otherByOffice.has(a.officeId)) otherByOffice.set(a.officeId, []);
        otherByOffice.get(a.officeId).push(a);
      }
    });
    const out = [];
    if (current.length > 0) {
      out.push({
        id: "__current__",
        label: `Current office · ${officeName(currentOfficeId)}`,
        accounts: current,
      });
    }
    if (otherByOffice.size > 0) {
      const remote = [];
      for (const [officeId, list] of otherByOffice.entries()) {
        remote.push({ officeId, officeName: officeName(officeId), accounts: list });
      }
      out.push({ id: "__others__", label: "Other offices · interoffice transfer", groups: remote });
    }
    return out;
  }, [filtered, currentOfficeId, offices]);

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
              <div className="text-[13px] font-semibold text-slate-900 truncate flex items-center gap-1.5">
                {selected.name}
                {isInteroffice && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-800 ring-1 ring-amber-200">
                    <ArrowLeftRight className="w-2 h-2" />
                    INTEROFFICE
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                {selected.currency} · {selected.type}
                {isInteroffice && ` · ${officeName(selected.officeId)}`}
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

      {/* Interoffice hint below trigger */}
      {isInteroffice && !open && (
        <div className="mt-1 text-[10px] font-medium text-amber-800 bg-amber-50/80 border border-amber-200 rounded-md px-2 py-0.5 inline-flex items-center gap-1">
          <ArrowLeftRight className="w-2.5 h-2.5" />
          Interoffice transfer · balance comes from {officeName(selected.officeId)}
        </div>
      )}

      {/* Dropdown */}
      {/** renders further down */}
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
          <div className="max-h-72 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-[12px] text-slate-400">
                No accounts match
              </div>
            )}
            {sections.map((section) => (
              <div key={section.id}>
                {section.label && (
                  <div className="px-3 pt-2 pb-1 text-[9px] font-bold text-slate-500 tracking-widest uppercase bg-slate-50/60 border-y border-slate-100 flex items-center gap-1">
                    {section.id === "__others__" ? (
                      <ArrowLeftRight className="w-2.5 h-2.5 text-amber-600" />
                    ) : (
                      <Building2 className="w-2.5 h-2.5 text-slate-400" />
                    )}
                    {section.label}
                  </div>
                )}
                {section.accounts &&
                  section.accounts.map((a) => (
                    <AccountOption
                      key={a.id}
                      account={a}
                      isActive={a.id === value}
                      onPick={handlePick}
                    />
                  ))}
                {section.groups &&
                  section.groups.map((g) => (
                    <div key={g.officeId}>
                      <div className="pl-5 pr-3 pt-1 pb-0.5 text-[10px] font-semibold text-slate-600 flex items-center gap-1">
                        <Building2 className="w-2.5 h-2.5 text-slate-400" />
                        {g.officeName}
                      </div>
                      {g.accounts.map((a) => (
                        <AccountOption
                          key={a.id}
                          account={a}
                          isActive={a.id === value}
                          onPick={handlePick}
                          indent
                        />
                      ))}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountOption({ account: a, isActive, onPick, indent }) {
  return (
    <button
      type="button"
      onClick={() => onPick(a.id)}
      className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${indent ? "pl-6" : ""} ${
        isActive ? "bg-slate-900 text-white" : "hover:bg-slate-50 text-slate-900"
      }`}
    >
      <span className="text-[14px]">{TYPE_ICONS[a.type] || "•"}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate">{a.name}</div>
        <div className={`text-[10px] font-medium uppercase tracking-wider ${isActive ? "text-slate-300" : "text-slate-500"}`}>
          {a.currency} · {a.type}
        </div>
      </div>
      {isActive && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
    </button>
  );
}
