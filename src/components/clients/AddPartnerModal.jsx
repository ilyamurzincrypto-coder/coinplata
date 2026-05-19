// src/components/clients/AddPartnerModal.jsx
//
// Thin modal для добавления партнёра прямо из Контрагенты → Список
// (чтобы не гнать юзера в Settings → Партнёры за каждым партнёром).
// Для CRUD-операций с partner_accounts всё ещё нужен Settings (там
// табличный flow с раскрытием счетов и settlement-actions).

import React, { useState, useEffect } from "react";
import Modal from "../ui/Modal.jsx";
import { usePartners } from "../../store/partners.jsx";

export default function AddPartnerModal({ open, onClose, onSuccess }) {
  const { addPartner } = usePartners();
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setTelegram("");
      setPhone("");
      setNote("");
    }
  }, [open]);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) return;
    const tg = telegram.trim();
    setBusy(true);
    try {
      const created = await addPartner({
        name: name.trim(),
        telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
        phone: phone.trim(),
        note: note.trim(),
      });
      onSuccess?.(created);
      onClose?.();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert("Ошибка: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Добавить партнёра" width="md">
      <div className="p-5 space-y-3">
        <Field label="Имя / Название">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Sheriff Exchange"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-card px-3 py-2.5 text-body outline-none"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Telegram (опционально)">
            <input
              type="text"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="@username"
              className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-card px-3 py-2.5 text-body outline-none"
            />
          </Field>
          <Field label="Телефон (опционально)">
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7..."
              className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-card px-3 py-2.5 text-body outline-none"
            />
          </Field>
        </div>
        <Field label="Заметка (опционально)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Описание / каналы / условия…"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-card px-3 py-2.5 text-body outline-none"
          />
        </Field>
        <p className="text-caption text-muted bg-surface-soft border border-border-soft rounded-button px-3 py-2">
          Чтобы добавить счета партнёру (валюты, сети, кошельки) — Настройки →
          Партнёры → раскрыть → «Счёт».
        </p>
      </div>
      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk"
        >
          Отмена
        </button>
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="px-4 py-2 rounded-card text-body-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-[0_4px_14px_-4px_rgba(99,102,241,0.5)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {busy ? "Добавляю…" : "Добавить партнёра"}
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-tiny font-semibold text-muted mb-1.5 tracking-wide uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}
