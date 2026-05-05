// src/components/clients/AddClientModal.jsx
// Извлечён из ClientsPage.jsx — теперь используется в новой Контрагенты-странице.
// Логика 1:1: имя обязательно, telegram нормализуется к @-префиксу, tag/note опционально.

import React, { useState, useEffect } from "react";
import Modal from "../ui/Modal.jsx";
import { CLIENT_TAGS } from "../../store/data.js";

export default function AddClientModal({ open, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setTelegram("");
      setTag("");
      setNote("");
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    const tg = telegram.trim();
    onSubmit({
      nickname: name.trim(),
      name: name.trim(),
      telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
      tag,
      note: note.trim(),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add client" width="md">
      <div className="p-5 space-y-3">
        <FormField label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Jane Doe"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
        <FormField label="Telegram (optional)">
          <input
            type="text"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
        <FormField label="Tag">
          <div className="flex flex-wrap gap-1.5">
            <TagBtn active={!tag} onClick={() => setTag("")}>None</TagBtn>
            {CLIENT_TAGS.map((tg) => (
              <TagBtn key={tg} active={tag === tg} onClick={() => setTag(tg)}>{tg}</TagBtn>
            ))}
          </div>
        </FormField>
        <FormField label="Note (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            name.trim()
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

function TagBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold border transition-colors ${
        active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
