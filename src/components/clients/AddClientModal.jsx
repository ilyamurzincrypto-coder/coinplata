// src/components/clients/AddClientModal.jsx
// Извлечён из ClientsPage.jsx — теперь используется в новой Контрагенты-странице.
// Логика 1:1: имя обязательно, telegram нормализуется к @-префиксу, tag/note опционально.

import React, { useState, useEffect } from "react";
import Modal from "../ui/Modal.jsx";
import { CLIENT_TAGS } from "../../store/data.js";
import { useTransactions } from "../../store/transactions.jsx";

export default function AddClientModal({ open, onClose, onSubmit }) {
  const { counterparties } = useTransactions();
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [referrerId, setReferrerId] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setTelegram("");
      setTag("");
      setNote("");
      setReferrerId("");
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
      referrerId: referrerId || null,
    });
  };

  // Реферер = существующий не-archivedAt клиент, отсортированный по nickname.
  // Self-referral в этом окне исключить нечем (новый клиент ещё не создан),
  // но это и не нужно — у только что создаваемого клиента нет id чтобы
  // ссылаться на себя.
  const referrerOptions = counterparties
    .filter((c) => !c.archivedAt && c.id)
    .sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));

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
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
        <FormField label="Telegram (optional)">
          <input
            type="text"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
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
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
        <FormField label="Кого привёл (реферер)">
          <select
            value={referrerId}
            onChange={(e) => setReferrerId(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          >
            <option value="">— нет —</option>
            {referrerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
                {c.telegram ? ` · ${c.telegram}` : ""}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-surface-sunk text-ink-soft text-[13px] font-semibold hover:bg-surface-sunk transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            name.trim()
              ? "bg-ink text-white hover:bg-ink"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
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
      <label className="block text-[11px] font-semibold text-muted mb-1.5 tracking-wide uppercase">
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
          ? "bg-ink text-white border-ink"
          : "bg-white text-ink-soft border-border-soft hover:border-border"
      }`}
    >
      {children}
    </button>
  );
}
