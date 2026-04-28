// src/components/PartnerSelect.jsx
// Селектор контрагентов (партнёров) для OTC сделок. Аналог CounterpartySelect:
// поиск по имени/телеграму, dropdown, "Add new" inline-создание.
//
// value/onChange — имя контрагента (string). Компонент сам резолвит partner row
// при выборе и хранит id для записи. Если name не найден в БД, показывает
// "Создать нового".

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, Plus, Send, Check, UserPlus, X } from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { usePartners } from "../store/partners.jsx";

export default function PartnerSelect({ value, onChange, placeholder }) {
  const { activePartners, addPartner } = usePartners();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [showAdd, setShowAdd] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) setQuery(value || "");
  }, [value, open]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase().replace(/^@/, "");
    if (!q) return activePartners.slice(0, 8);
    return activePartners
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.telegram || "").toLowerCase().replace(/^@/, "").includes(q) ||
          (p.phone || "").toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [activePartners, debouncedQuery]);

  const hasQuery = debouncedQuery.trim().length > 0;
  const exactMatch = results.find((p) => p.name.toLowerCase() === debouncedQuery.trim().toLowerCase());
  const showCreateOption = hasQuery && !exactMatch;

  const pick = (p) => {
    onChange(p.name);
    setQuery(p.name);
    setOpen(false);
  };

  const handleAddSubmit = async (data) => {
    try {
      const created = await addPartner(data);
      if (created) {
        onChange(created.name);
        setQuery(created.name);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[PartnerSelect] add failed", e);
      alert("Не удалось создать партнёра: " + (e?.message || e));
    }
    setShowAdd(false);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-stretch gap-1.5">
        <div
          className={`flex-1 flex items-center bg-white border rounded-[8px] transition-colors ${
            open ? "border-indigo-400 ring-2 ring-indigo-500/20" : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5" />
          <input
            type="text"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              onChange(e.target.value);
            }}
            placeholder={placeholder || "Имя партнёра / @telegram / телефон"}
            className="flex-1 bg-transparent outline-none text-[12.5px] px-2 py-1.5 placeholder:text-slate-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                onChange("");
              }}
              className="p-0.5 rounded hover:bg-slate-100 text-slate-400 mr-1"
              title="Clear"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 px-2 rounded-[8px] bg-indigo-600 text-white text-[10.5px] font-bold hover:bg-indigo-700 transition-colors shrink-0"
          title="Добавить нового партнёра"
        >
          <UserPlus className="w-3 h-3" />
          New
        </button>
      </div>

      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-slate-200 rounded-[10px] shadow-xl shadow-slate-900/10 py-1 max-h-64 overflow-auto">
          {activePartners.length === 0 && (
            <div className="px-3 py-4 text-center">
              <div className="text-[12px] font-semibold text-slate-700 mb-1.5">
                Нет партнёров
              </div>
              <div className="text-[10.5px] text-slate-500 mb-2">
                Создайте первого, чтобы он появился в списке.
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700"
              >
                <UserPlus className="w-3 h-3" />
                Добавить партнёра
              </button>
            </div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className="w-full text-left px-2.5 py-1.5 hover:bg-slate-50 flex items-center gap-2"
            >
              <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-700 shrink-0">
                {p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-slate-900 truncate">
                  {p.name}
                </div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                  {p.telegram && (
                    <span className="inline-flex items-center gap-0.5 text-sky-600">
                      <Send className="w-2.5 h-2.5" />
                      {p.telegram}
                    </span>
                  )}
                  {p.phone && <span>{p.phone}</span>}
                </div>
              </div>
              {value === p.name && <Check className="w-3 h-3 text-indigo-600" />}
            </button>
          ))}
          {showCreateOption && (
            <div className="border-t border-slate-100 mt-1 pt-1 px-1">
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="w-full text-left px-2 py-1.5 rounded-[6px] hover:bg-indigo-50 flex items-center gap-2 text-indigo-700"
              >
                <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                  <Plus className="w-3 h-3 text-white" />
                </div>
                <span className="text-[12px] font-semibold">
                  Создать «{debouncedQuery.trim()}»
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      <AddPartnerModal
        open={showAdd}
        initialName={query.trim() && !exactMatch ? query.trim() : ""}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAddSubmit}
      />
    </div>
  );
}

function AddPartnerModal({ open, onClose, onSubmit, initialName }) {
  const [name, setName] = useState(initialName || "");
  const [telegram, setTelegram] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName || "");
      setTelegram("");
      setPhone("");
      setNote("");
    }
  }, [open, initialName]);

  const submit = () => {
    if (!name.trim()) return;
    const tg = telegram.trim();
    onSubmit({
      name: name.trim(),
      telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
      phone: phone.trim(),
      note: note.trim(),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Новый партнёр" width="md">
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Имя / Название
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Иван Петров / Crypto OTC LLC"
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            <Send className="w-3 h-3 inline mr-1" /> Telegram
          </label>
          <input
            type="text"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Телефон
          </label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7..."
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Заметка
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Описание / каналы / условия..."
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200"
        >
          Отмена
        </button>
        <button
          onClick={submit}
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold ${
            name.trim() ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}
