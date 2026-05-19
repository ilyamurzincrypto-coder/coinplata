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
import { useTranslation } from "../i18n/translations.jsx";

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
  placeholder,
  allowClear = true,
  currentOfficeId = null,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);
  const { offices } = useOffices();
  const placeholderText = placeholder ?? t("select_account");

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
        label: t("acsel_current_office").replace("{name}", officeName(currentOfficeId)),
        accounts: current,
      });
    }
    if (otherByOffice.size > 0) {
      const remote = [];
      for (const [officeId, list] of otherByOffice.entries()) {
        remote.push({ officeId, officeName: officeName(officeId), accounts: list });
      }
      out.push({ id: "__others__", label: t("acsel_other_offices"), groups: remote });
    }
    return out;
  }, [filtered, currentOfficeId, offices, t]);

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
        className={`w-full bg-surface-soft border rounded-card px-3 py-2.5 text-left flex items-center gap-2 transition-colors ${
          open
            ? "border-accent/40 bg-white ring-2 ring-accent/20"
            : "border-border-soft hover:border-border"
        }`}
      >
        {selected ? (
          <>
            <span className="text-[15px]">{TYPE_ICONS[selected.type] || "•"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-body-sm font-semibold text-ink truncate flex items-center gap-1.5">
                {selected.name}
                {isInteroffice && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-micro font-bold bg-warning-soft text-warning ring-1 ring-amber-200">
                    <ArrowLeftRight className="w-2 h-2" />
                    {t("acsel_interoffice_badge")}
                  </span>
                )}
              </div>
              <div className="text-tiny text-muted font-medium uppercase tracking-wider">
                {selected.currency} · {selected.type}
                {isInteroffice && ` · ${officeName(selected.officeId)}`}
              </div>
            </div>
          </>
        ) : (
          <>
            <Wallet className="w-3.5 h-3.5 text-muted-soft" />
            <span className="flex-1 text-body-sm text-muted-soft">{placeholderText}</span>
          </>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-soft transition-transform ${open ? "rotate-180" : ""}`}
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
          className="absolute top-1/2 right-8 -translate-y-1/2 p-0.5 rounded hover:bg-surface-sunk text-muted-soft hover:text-ink-soft"
          title={t("acsel_clear")}
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {/* Interoffice hint below trigger */}
      {isInteroffice && !open && (
        <div className="mt-1 text-tiny font-medium text-warning bg-warning-soft/80 border border-warning/20 rounded-md px-2 py-0.5 inline-flex items-center gap-1">
          <ArrowLeftRight className="w-2.5 h-2.5" />
          {t("acsel_interoffice_hint").replace("{office}", officeName(selected.officeId))}
        </div>
      )}

      {/* Dropdown */}
      {/** renders further down */}
      {open && (
        <div className="absolute z-40 top-full left-0 right-0 mt-1 bg-white border border-border-soft rounded-card shadow-xl shadow-soft overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border-soft relative">
            <Search className="w-3.5 h-3.5 text-muted-soft absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("acsel_search_placeholder")}
              className="w-full pl-7 pr-2 py-1.5 bg-surface-soft border border-border-soft focus:bg-white focus:border-border rounded-button text-caption outline-none placeholder:text-muted-soft"
            />
          </div>

          {/* List */}
          <div className="max-h-72 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-caption text-muted-soft">
                {t("acsel_no_match")}
              </div>
            )}
            {sections.map((section) => (
              <div key={section.id}>
                {section.label && (
                  <div className="px-3 pt-2 pb-1 text-micro font-bold text-muted tracking-widest uppercase bg-surface-soft/60 border-y border-border-soft flex items-center gap-1">
                    {section.id === "__others__" ? (
                      <ArrowLeftRight className="w-2.5 h-2.5 text-warning" />
                    ) : (
                      <Building2 className="w-2.5 h-2.5 text-muted-soft" />
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
                      <div className="pl-5 pr-3 pt-1 pb-0.5 text-tiny font-semibold text-ink-soft flex items-center gap-1">
                        <Building2 className="w-2.5 h-2.5 text-muted-soft" />
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
        isActive ? "bg-ink text-white" : "hover:bg-surface-soft text-ink"
      }`}
    >
      <span className="text-body">{TYPE_ICONS[a.type] || "•"}</span>
      <div className="flex-1 min-w-0">
        <div className="text-body-sm font-semibold truncate">{a.name}</div>
        <div className={`text-tiny font-medium uppercase tracking-wider ${isActive ? "text-muted-soft" : "text-muted"}`}>
          {a.currency} · {a.type}
        </div>
      </div>
      {isActive && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
    </button>
  );
}
