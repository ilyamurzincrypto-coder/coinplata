// src/components/clients/AddClientModal.jsx
// Извлечён из ClientsPage.jsx — теперь используется в новой Контрагенты-странице.
// Логика 1:1: имя обязательно, telegram нормализуется к @-префиксу, tag/note опционально.

import React, { useState, useEffect, useMemo } from "react";
import Modal from "../ui/Modal.jsx";
import { CLIENT_TAGS } from "../../store/data.js";
import { useTransactions } from "../../store/transactions.jsx";
import CashboxWizard from "../../pages/treasury_v2/parts/CashboxWizard.jsx";

export default function AddClientModal({ open, onClose, onSubmit, ledgerCtx }) {
  const { counterparties } = useTransactions();
  // Двухступенчатый гейт (1.5.f): валюта открываема клиенту, только если есть позиция в
  // Капитале И хотя бы один наш актив (касса/банк/кошелёк) в валюте (лоро без покрытия нельзя).
  const positionCurrencies = useMemo(() => {
    const s = new Set();
    for (const a of ledgerCtx?.accounts || []) if (a.type === "equity" && a.subtype === "position" && a.currency) s.add(a.currency);
    return [...s].sort();
  }, [ledgerCtx]);
  const assetCurrencies = useMemo(() => {
    const s = new Set();
    for (const a of ledgerCtx?.accounts || []) if (a.type === "asset" && a.active !== false && a.currency) s.add(a.currency);
    return s;
  }, [ledgerCtx]);
  const [cashboxCcy, setCashboxCcy] = useState(null);
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [referrerId, setReferrerId] = useState("");
  // 1.5.f: открываемые клиенту валюты (только с позицией в Капитале) + guard от дабл-клика.
  const [selectedCcy, setSelectedCcy] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setTelegram("");
      setTag("");
      setNote("");
      setReferrerId("");
      setSelectedCcy(new Set());
      setBusy(false);
      setCashboxCcy(null);
    }
  }, [open]);

  const toggleCcy = (c) =>
    setSelectedCcy((prev) => {
      const n = new Set(prev);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  const handleSubmit = async () => {
    if (!name.trim() || busy) return; // guard: дабл-клик не плодит дубль
    setBusy(true);
    const tg = telegram.trim();
    try {
      await onSubmit({
        nickname: name.trim(),
        name: name.trim(),
        telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
        tag,
        note: note.trim(),
        referrerId: referrerId || null,
        currencies: [...selectedCcy],
      });
    } finally {
      setBusy(false);
    }
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
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
          />
        </FormField>
        <FormField label="Telegram (optional)">
          <input
            type="text"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
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
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
          />
        </FormField>
        <FormField label="Открыть счета в валютах">
          {positionCurrencies.length === 0 ? (
            <p className="text-tiny text-muted">
              Пока нет валют с балансовым счётом в Капитале — счета можно открыть позже (Добавить валюту в разделе Капитал).
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {positionCurrencies.map((c) => {
                const ready = assetCurrencies.has(c); // позиция + актив (двухступенчатый гейт)
                const on = selectedCcy.has(c);
                return (
                  <div key={c} className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => ready && toggleCcy(c)}
                      title={ready ? "" : `Нет кассы/счёта в ${c}`}
                      className={`px-2.5 py-1 rounded-button text-tiny font-semibold border transition-colors min-w-[76px] text-center ${
                        !ready
                          ? "bg-surface-sunk text-muted-soft border-border-soft cursor-not-allowed"
                          : on
                          ? "bg-ink text-white border-ink"
                          : "bg-white text-ink-soft border-border-soft hover:border-border"
                      }`}
                    >
                      {c}
                    </button>
                    {!ready && (
                      <span className="text-tiny text-amber-700">
                        Нет кассы/счёта в {c} —{" "}
                        <button type="button" onClick={() => setCashboxCcy(c)} className="text-accent font-semibold hover:underline">
                          откройте
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </FormField>
        <FormField label="Кого привёл (реферер)">
          <select
            value={referrerId}
            onChange={(e) => setReferrerId(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2.5 text-body outline-none"
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
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || busy}
          className={`px-4 py-2 rounded-card text-body-sm font-semibold transition-colors ${
            name.trim() && !busy
              ? "bg-ink text-white hover:bg-ink"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
        >
          {busy ? "Сохраняю…" : "Save"}
        </button>
      </div>
      {cashboxCcy && ledgerCtx && (
        <CashboxWizard open ctx={ledgerCtx} onClose={() => setCashboxCcy(null)} />
      )}
    </Modal>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-tiny font-semibold text-muted mb-1.5 tracking-wide uppercase">
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
      className={`px-2.5 py-1 rounded-button text-tiny font-semibold border transition-colors ${
        active
          ? "bg-ink text-white border-ink"
          : "bg-white text-ink-soft border-border-soft hover:border-border"
      }`}
    >
      {children}
    </button>
  );
}
