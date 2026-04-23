// src/components/CommandPalette.jsx
// Spotlight-style quick palette. Открывается по Cmd/Ctrl+K.
// Ищет: Clients (nickname/name/telegram), Deals (#id/counterparty/amount),
// Accounts (name/currency), Pages (навигация).
//
// Keyboard:
//   Cmd/Ctrl+K  — open/close
//   ↑/↓         — select
//   Enter       — apply
//   Esc         — close

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Users,
  ArrowLeftRight,
  Wallet,
  Navigation,
  X,
  ArrowRight,
  CornerDownLeft,
} from "lucide-react";
import { useTransactions } from "../store/transactions.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { officeName } from "../store/data.js";
import { fmt } from "../utils/money.js";
import { useTranslation } from "../i18n/translations.jsx";

export default function CommandPalette({ onNavigate, onOpenClient, onOpenDeal }) {
  const { t } = useTranslation();
  const { transactions, counterparties } = useTransactions();
  const { accounts } = useAccounts();

  const PAGE_ITEMS = useMemo(
    () => [
      { id: "nav:cashier", kind: "page", label: t("nav_cashier"), page: "cashier" },
      { id: "nav:capital", kind: "page", label: t("nav_capital"), page: "capital" },
      { id: "nav:accounts", kind: "page", label: t("nav_accounts"), page: "accounts" },
      { id: "nav:clients", kind: "page", label: t("nav_clients"), page: "clients" },
      { id: "nav:obligations", kind: "page", label: t("nav_obligations"), page: "obligations" },
      { id: "nav:referrals", kind: "page", label: t("nav_referrals"), page: "referrals" },
      { id: "nav:settings", kind: "page", label: t("nav_settings"), page: "settings" },
    ],
    [t]
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  // Global Cmd/Ctrl+K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Default state — показываем pages + recent
      return [
        { group: t("palette_group_nav"), items: PAGE_ITEMS.slice(0, 5) },
      ];
    }

    // Deals: #id или по counterparty / amount / currency
    const dealMatches = [];
    const isNumber = /^#?\d+$/.test(q);
    transactions.forEach((tx) => {
      if (tx.status === "deleted") return;
      const id = String(tx.id);
      const cp = (tx.counterparty || "").toLowerCase();
      const inCur = (tx.curIn || "").toLowerCase();
      const outCur = (tx.outputs?.[0]?.currency || tx.curOut || "").toLowerCase();
      const hit =
        (isNumber && id.includes(q.replace("#", ""))) ||
        cp.includes(q) ||
        inCur.includes(q) ||
        outCur.includes(q);
      if (hit) dealMatches.push(tx);
    });
    const deals = dealMatches.slice(0, 5).map((tx) => ({
      id: `deal:${tx.id}`,
      kind: "deal",
      label: `#${tx.id} · ${fmt(tx.amtIn, tx.curIn)} ${tx.curIn} → ${fmt(tx.outputs?.[0]?.amount ?? tx.amtOut, tx.outputs?.[0]?.currency ?? tx.curOut)} ${tx.outputs?.[0]?.currency ?? tx.curOut}`,
      sub: `${tx.counterparty || "—"} · ${officeName(tx.officeId)} · ${tx.date} ${tx.time || ""}`,
      raw: tx,
    }));

    // Clients
    const clients = counterparties
      .filter((c) => {
        const nick = (c.nickname || "").toLowerCase();
        const name = (c.name || "").toLowerCase();
        const tg = (c.telegram || "").toLowerCase();
        return nick.includes(q) || name.includes(q) || tg.includes(q);
      })
      .slice(0, 5)
      .map((c) => ({
        id: `client:${c.id || c.nickname}`,
        kind: "client",
        label: c.name || c.nickname,
        sub: [c.nickname, c.telegram].filter(Boolean).join(" · "),
        raw: c,
      }));

    // Accounts
    const accMatches = accounts
      .filter((a) => {
        const name = (a.name || "").toLowerCase();
        const cur = (a.currency || "").toLowerCase();
        return name.includes(q) || cur.includes(q);
      })
      .slice(0, 5)
      .map((a) => ({
        id: `account:${a.id}`,
        kind: "account",
        label: `${a.name} · ${a.currency}`,
        sub: officeName(a.officeId),
        raw: a,
      }));

    // Pages
    const pages = PAGE_ITEMS.filter((p) => p.label.toLowerCase().includes(q));

    const groups = [];
    if (deals.length > 0) groups.push({ group: t("palette_group_deals"), items: deals });
    if (clients.length > 0) groups.push({ group: t("palette_group_clients"), items: clients });
    if (accMatches.length > 0) groups.push({ group: t("palette_group_accounts"), items: accMatches });
    if (pages.length > 0) groups.push({ group: t("palette_group_nav"), items: pages });
    return groups;
  }, [query, transactions, counterparties, accounts, PAGE_ITEMS, t]);

  // Flatten для cursor
  const flatItems = useMemo(() => items.flatMap((g) => g.items), [items]);
  const totalCount = flatItems.length;

  // Reset cursor when query / flatItems меняются
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const handleSelect = (item) => {
    if (!item) return;
    if (item.kind === "page") {
      onNavigate?.(item.page);
    } else if (item.kind === "client") {
      if (onOpenClient) onOpenClient(item.raw);
      else onNavigate?.("clients");
    } else if (item.kind === "deal") {
      if (onOpenDeal) onOpenDeal(item.raw);
      else onNavigate?.("cashier");
    } else if (item.kind === "account") {
      onNavigate?.("accounts");
    }
    setOpen(false);
  };

  const handleKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % Math.max(1, totalCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + Math.max(1, totalCount)) % Math.max(1, totalCount));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(flatItems[cursor]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[580px] bg-white rounded-[14px] border border-slate-200 shadow-[0_20px_60px_-12px_rgba(15,23,42,0.35)] overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t("palette_search_ph")}
            className="flex-1 bg-transparent outline-none text-[15px] text-slate-900 placeholder:text-slate-400"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold tracking-wider">
            ESC
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-auto py-1">
          {items.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-[13px]">
              {t("palette_no_match")} “{query}”
            </div>
          ) : (
            items.map((g, gi) => {
              // Flat-index для highlight
              const baseIdx = items.slice(0, gi).reduce((s, x) => s + x.items.length, 0);
              return (
                <div key={g.group}>
                  <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {g.group}
                  </div>
                  {g.items.map((it, ii) => {
                    const idx = baseIdx + ii;
                    const active = idx === cursor;
                    const IconFor = {
                      page: Navigation,
                      client: Users,
                      deal: ArrowLeftRight,
                      account: Wallet,
                    }[it.kind];
                    return (
                      <button
                        key={it.id}
                        onClick={() => handleSelect(it)}
                        onMouseEnter={() => setCursor(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                          active ? "bg-slate-900 text-white" : "hover:bg-slate-50 text-slate-800"
                        }`}
                      >
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-[8px] shrink-0 ${
                            active ? "bg-white/10" : "bg-slate-100"
                          }`}
                        >
                          {IconFor && (
                            <IconFor
                              className={`w-3.5 h-3.5 ${active ? "text-white" : "text-slate-500"}`}
                            />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold truncate">{it.label}</div>
                          {it.sub && (
                            <div
                              className={`text-[11px] truncate ${
                                active ? "text-white/70" : "text-slate-500"
                              }`}
                            >
                              {it.sub}
                            </div>
                          )}
                        </div>
                        {active && <CornerDownLeft className="w-3 h-3 opacity-70" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-bold">↑↓</kbd>
              {t("palette_hint_navigate")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-bold">↵</kbd>
              {t("palette_hint_select")}
            </span>
          </div>
          <div className="text-slate-400">
            <kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-bold">⌘K</kbd> · {t("palette_hint_toggle")}
          </div>
        </div>
      </div>
    </div>
  );
}
