// src/components/PartnerAccountSelect.jsx
// Двухступенчатый селектор: сначала партнёр, затем его счёт.
// Используется в ExchangeForm для IN-стороны и каждого OUT-leg в режимах
// B/C/D OTC сделок.
//
// Фильтрация:
//   - currency: показывает только счета с currency_code = currency.
//   - active=true: деактивированные счета скрываются.
//
// value/onChange — partner_account_id (UUID).

import React, { useState, useEffect, useMemo, useRef } from "react";
import { ChevronDown, Handshake, Wallet, Banknote, Building2, Coins, Search, X, Plus } from "lucide-react";
import { usePartners } from "../store/partners.jsx";
import { usePartnerAccounts } from "../store/partnerAccounts.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import PartnerAccountFormModal from "./settings/PartnerAccountFormModal.jsx";

const TYPE_ICONS = { cash: Banknote, bank: Building2, crypto: Coins };

export default function PartnerAccountSelect({
  value,                  // partner_account_id (uuid) | ""
  onChange,               // (partnerAccountId) => void
  currency,               // обязательный фильтр по валюте счёта
  partnerId = null,       // если задан — ограничиваем выбор счетами этого партнёра
  placeholder = "Счёт партнёра",
}) {
  const { activePartners } = usePartners();
  const { activeByCurrency, balanceOf, accounts, addPartnerAccount } = usePartnerAccounts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [addAccOpen, setAddAccOpen] = useState(false);
  const rootRef = useRef(null);

  // Доступные счета по валюте; если partnerId задан — ещё и по партнёру.
  const availableAccs = useMemo(() => {
    if (!currency) return [];
    let list = activeByCurrency(currency);
    if (partnerId) list = list.filter((a) => a.partnerId === partnerId);
    return list;
  }, [activeByCurrency, currency, partnerId]);

  const partnerHint = useMemo(
    () => (partnerId ? activePartners.find((p) => p.id === partnerId) || null : null),
    [partnerId, activePartners]
  );

  const handleQuickAddSubmit = async (data) => {
    if (!partnerId) return;
    try {
      const created = await addPartnerAccount({ partnerId, ...data });
      setAddAccOpen(false);
      if (created?.id) onChange?.(created.id);
      setOpen(false);
    } catch (err) {
      // eslint-disable-next-line no-alert, no-console
      alert("Не удалось создать счёт: " + (err?.message || err));
    }
  };

  // Группируем по партнёру
  const grouped = useMemo(() => {
    const m = new Map();
    availableAccs.forEach((a) => {
      const partner = activePartners.find((p) => p.id === a.partnerId);
      if (!partner) return;
      if (!m.has(partner.id)) {
        m.set(partner.id, { partner, accounts: [] });
      }
      m.get(partner.id).accounts.push(a);
    });
    let groups = [...m.values()];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      groups = groups
        .map((g) => ({
          ...g,
          accounts: g.accounts.filter(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              g.partner.name.toLowerCase().includes(q)
          ),
        }))
        .filter((g) => g.accounts.length > 0);
    }
    return groups;
  }, [availableAccs, activePartners, query]);

  // Selected account для отображения
  const selectedAcc = useMemo(
    () => (value ? accounts.find((a) => a.id === value) : null),
    [value, accounts]
  );
  const selectedPartner = useMemo(
    () => (selectedAcc ? activePartners.find((p) => p.id === selectedAcc.partnerId) : null),
    [selectedAcc, activePartners]
  );

  // Закрытие по клику вне
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Если value стало невалидным (например currency сменился) — очистить
  useEffect(() => {
    if (value && selectedAcc && currency && selectedAcc.currency !== currency) {
      onChange?.("");
    }
  }, [value, selectedAcc, currency, onChange]);

  const pick = (accId) => {
    onChange?.(accId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-card border transition-colors ${
          selectedAcc
            ? "bg-white border-indigo-300 hover:border-indigo-400"
            : "bg-surface-soft border-border-soft hover:border-border"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-accent shrink-0">
            <Handshake className="w-3.5 h-3.5" />
          </div>
          <div className="text-left min-w-0 flex-1">
            {selectedAcc && selectedPartner ? (
              <>
                <div className="text-caption font-bold text-ink truncate">
                  {selectedPartner.name} · {selectedAcc.name}
                </div>
                <div className="text-tiny text-muted tabular-nums">
                  {curSymbol(selectedAcc.currency)}
                  {fmt(balanceOf(selectedAcc.id), selectedAcc.currency)}{" "}
                  <span className="opacity-60">{selectedAcc.currency}</span>
                  {selectedAcc.networkId && (
                    <span className="ml-1 text-muted-soft">· {selectedAcc.networkId}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-caption text-muted-soft">
                {currency ? `${placeholder} · ${currency}` : placeholder}
              </div>
            )}
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-muted-soft shrink-0" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-border-soft rounded-card shadow-xl shadow-soft max-h-72 overflow-auto">
          {/* Search */}
          <div className="p-2 border-b border-border-soft">
            <div className="flex items-center gap-1.5 bg-surface-soft border border-border-soft rounded-button px-2 py-1.5">
              <Search className="w-3 h-3 text-muted-soft shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск партнёра / счёта"
                className="flex-1 bg-transparent outline-none text-caption text-ink placeholder:text-muted-soft min-w-0"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="p-0.5 rounded hover:bg-surface-sunk text-muted shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {grouped.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Wallet className="w-5 h-5 mx-auto text-muted-soft mb-1.5" />
              <div className="text-caption text-muted font-medium">
                {availableAccs.length === 0
                  ? partnerHint
                    ? `У ${partnerHint.name} нет счёта в ${currency || ""}`
                    : `Нет счетов партнёров в ${currency || "этой валюте"}`
                  : "Ничего не найдено"}
              </div>
              {partnerHint ? (
                <button
                  type="button"
                  onClick={() => setAddAccOpen(true)}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card bg-violet-600 text-white text-caption font-semibold hover:bg-violet-700 transition-colors shadow-[0_4px_14px_-4px_rgba(139,92,246,0.5)]"
                >
                  <Plus className="w-3 h-3" />
                  Создать счёт {currency ? `· ${currency}` : ""}
                </button>
              ) : (
                <div className="text-tiny text-muted-soft mt-1">
                  Создайте счёт в Settings → Партнёры → раскрой партнёра → +Счёт
                </div>
              )}
            </div>
          ) : (
            <div className="py-1">
              {grouped.map((g) => (
                <div key={g.partner.id}>
                  <div className="px-3 py-1.5 text-micro font-bold text-muted-soft tracking-[0.12em] uppercase bg-surface-soft/60 border-y border-border-soft">
                    {g.partner.name}
                  </div>
                  {g.accounts.map((a) => {
                    const Icon = TYPE_ICONS[a.type] || Wallet;
                    const isSelected = a.id === value;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => pick(a.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-accent-bg/40 transition-colors ${
                          isSelected ? "bg-accent-bg/60" : ""
                        }`}
                      >
                        <div className="w-6 h-6 rounded-full bg-surface-sunk flex items-center justify-center text-muted shrink-0">
                          <Icon className="w-3 h-3" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="text-caption font-semibold text-ink truncate">
                            {a.name}
                            {a.networkId && (
                              <span className="ml-1 text-tiny text-muted-soft">· {a.networkId}</span>
                            )}
                          </div>
                          <div className="text-tiny text-muted tabular-nums">
                            {curSymbol(a.currency)}
                            {fmt(balanceOf(a.id), a.currency)}{" "}
                            <span className="opacity-60">{a.currency}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {/* Quick-add button в шапке списка (если partnerId задан и
              счета уже есть — кассир может всё равно добавить ещё один) */}
          {partnerHint && grouped.length > 0 && (
            <div className="px-2 py-2 border-t border-border-soft">
              <button
                type="button"
                onClick={() => setAddAccOpen(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-button bg-accent-bg text-accent text-caption font-semibold hover:bg-violet-100 transition-colors border border-violet-200"
              >
                <Plus className="w-3 h-3" />
                Добавить ещё счёт {currency ? `· ${currency}` : ""}
              </button>
            </div>
          )}
        </div>
      )}

      <PartnerAccountFormModal
        open={addAccOpen}
        onClose={() => setAddAccOpen(false)}
        onSubmit={handleQuickAddSubmit}
        partnerName={partnerHint?.name || ""}
        initial={currency ? { currency } : undefined}
      />
    </div>
  );
}
