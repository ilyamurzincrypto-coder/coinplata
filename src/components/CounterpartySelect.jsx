// src/components/CounterpartySelect.jsx
// Продвинутый селектор контрагентов:
//   — поиск по nickname, name и telegram
//   — dropdown показывает name + telegram
//   — кнопка "Add new" открывает мини-модалку
// Используется в ExchangeForm вместо plain input+datalist.

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, Plus, Send, User as UserIcon, Check, UserPlus } from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { CLIENT_TAGS } from "../store/data.js";

const TAG_STYLE = {
  VIP: "bg-amber-50 text-amber-800 ring-amber-200",
  Regular: "bg-slate-100 text-slate-700 ring-slate-200",
  New: "bg-sky-50 text-sky-700 ring-sky-200",
  Risky: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function ClientTag({ tag, size = "sm" }) {
  if (!tag) return null;
  const cls = TAG_STYLE[tag] || TAG_STYLE.Regular;
  const sizeCls = size === "xs" ? "text-[9px] px-1 py-0" : "text-[10px] px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-center rounded font-bold tracking-wider uppercase ring-1 ${cls} ${sizeCls}`}>
      {tag}
    </span>
  );
}

export default function CounterpartySelect({ value, onChange }) {
  const { t } = useTranslation();
  const { counterparties, addCounterparty } = useTransactions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [showAdd, setShowAdd] = useState(false);
  const rootRef = useRef(null);

  // Keep local query in sync with external value
  useEffect(() => {
    if (!open) setQuery(value || "");
  }, [value, open]);

  // Debounce ввода — 300ms. Предотвращает фильтрацию на каждую букву.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Пустой запрос → [] (пустой список). Ввод → фильтрация с limit 10.
  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase().replace(/^@/, "");
    if (!q) return [];
    return counterparties
      .filter(
        (c) =>
          c.nickname.toLowerCase().includes(q) ||
          (c.name || "").toLowerCase().includes(q) ||
          (c.telegram || "").toLowerCase().replace(/^@/, "").includes(q)
      )
      .slice(0, 10);
  }, [counterparties, debouncedQuery]);

  const hasQuery = debouncedQuery.trim().length > 0;
  const noMatches = hasQuery && results.length === 0;

  const pick = (cp) => {
    onChange(cp.nickname);
    setQuery(cp.nickname);
    setOpen(false);
  };

  const handleAddSubmit = (data) => {
    const created = addCounterparty(data);
    if (created) {
      onChange(created.nickname);
      setQuery(created.nickname);
    }
    setShowAdd(false);
    setOpen(false);
  };

  const selected = counterparties.find((c) => c.nickname === value);

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-stretch gap-1.5">
        <div
          className={`flex-1 flex items-center bg-slate-50 border rounded-[10px] transition-colors ${
            open ? "border-slate-400 ring-2 ring-slate-900/10 bg-white" : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <Search className="w-3.5 h-3.5 text-slate-400 ml-3" />
          <input
            type="text"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              onChange(e.target.value);
            }}
            placeholder={t("search_counterparty") || "Search client by name or @telegram"}
            className="flex-1 bg-transparent outline-none text-[13px] px-2 py-2 placeholder:text-slate-400"
          />
          {selected?.tag && !open && <div className="mr-2"><ClientTag tag={selected.tag} size="xs" /></div>}
          {selected?.telegram && !open && (
            <span className="text-[11px] text-slate-500 mr-2 truncate max-w-[80px]">{selected.telegram}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 px-2.5 rounded-[10px] bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 transition-colors"
          title={t("add_new") || "Add client"}
        >
          <UserPlus className="w-3 h-3" />
          Add
        </button>
      </div>

      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-slate-200 rounded-[10px] shadow-xl shadow-slate-900/10 py-1 max-h-64 overflow-auto">
          {!hasQuery && (
            <div className="px-3 py-6 text-center text-[12px] text-slate-400">
              Start typing to search clients
            </div>
          )}
          {noMatches && (
            <div className="px-3 py-6 text-center">
              <div className="text-[13px] font-semibold text-slate-700 mb-1">
                Client not found
              </div>
              <div className="text-[11px] text-slate-500 mb-3">
                No client matches "{debouncedQuery}"
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] bg-slate-900 text-white text-[12px] font-semibold hover:bg-slate-800 transition-colors"
              >
                <UserPlus className="w-3 h-3" />
                Add "{debouncedQuery}"
              </button>
            </div>
          )}
          {results.map((cp) => (
            <button
              key={cp.id}
              type="button"
              onClick={() => pick(cp)}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 group"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-700 flex-shrink-0">
                {(cp.name || cp.nickname).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-slate-900 truncate flex items-center gap-1.5">
                  <span className="truncate">{cp.name || cp.nickname}</span>
                  <ClientTag tag={cp.tag} size="xs" />
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-2">
                  {cp.nickname !== cp.name && cp.name && (
                    <span className="truncate">{cp.nickname}</span>
                  )}
                  {cp.telegram && (
                    <span className="inline-flex items-center gap-0.5 text-sky-600">
                      <Send className="w-2.5 h-2.5" />
                      {cp.telegram}
                    </span>
                  )}
                </div>
              </div>
              {value === cp.nickname && <Check className="w-3.5 h-3.5 text-slate-900" />}
            </button>
          ))}
          {/* Add client CTA — всегда снизу с divider'ом, только если НЕ активно no-matches (там отдельная кнопка). */}
          {!noMatches && (
            <div className="border-t border-slate-100 mt-1 pt-1 px-1">
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="w-full text-left px-2 py-2 rounded-[8px] hover:bg-slate-50 flex items-center gap-2 text-slate-700"
              >
                <div className="w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center">
                  <Plus className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-[13px] font-semibold">{t("add_new") || "Add client"}</span>
              </button>
            </div>
          )}
        </div>
      )}

      <AddCounterpartyModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAddSubmit}
        initialName={query && !selected ? query : ""}
      />
    </div>
  );
}

function AddCounterpartyModal({ open, onClose, onSubmit, initialName }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName || "");
  const [telegram, setTelegram] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName || "");
      setTelegram("");
      setTag("");
      setNote("");
    }
  }, [open, initialName]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    const nickname = name.trim();
    const tg = telegram.trim();
    onSubmit({
      nickname,
      name: nickname,
      telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
      tag: tag || "",
      note: note.trim(),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={t("new_counterparty") || "Add client"} width="md">
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            <UserIcon className="w-3 h-3 inline mr-1" /> {t("name_label") || "Name"}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Murat Yildiz"
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            <Send className="w-3 h-3 inline mr-1" /> {t("telegram_label") || "Telegram"}
          </label>
          <input
            type="text"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Tag
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTag("")}
              className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold border transition-colors ${
                !tag ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              }`}
            >
              None
            </button>
            {CLIENT_TAGS.map((tg) => (
              <button
                key={tg}
                type="button"
                onClick={() => setTag(tg)}
                className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold border transition-colors ${
                  tag === tg ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                }`}
              >
                {tg}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="OTC desk, prefers SEPA…"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none transition-colors"
          />
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            name.trim() ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("save") || "Save"}
        </button>
      </div>
    </Modal>
  );
}
