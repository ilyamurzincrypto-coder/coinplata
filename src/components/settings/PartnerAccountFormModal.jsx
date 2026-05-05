// src/components/settings/PartnerAccountFormModal.jsx
// Модалка add/edit для счёта партнёра. Apple-style консистентно с
// остальным дизайном Settings → Партнёры.
//
// Поля: имя, валюта (select), тип (cash/bank/crypto), network_id для crypto,
// address (опц.), opening_balance, note.

import React, { useState, useEffect } from "react";
import { Banknote, Building2, Coins } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { useCurrencies } from "../../store/currencies.jsx";

const TYPE_OPTIONS = [
  { id: "cash", label: "Наличные", icon: Banknote },
  { id: "bank", label: "Банк", icon: Building2 },
  { id: "crypto", label: "Крипто", icon: Coins },
];

const CRYPTO_NETWORKS = ["TRC20", "ERC20", "BEP20", "SOL", "TON", "BTC", "POLYGON"];

export default function PartnerAccountFormModal({
  open,
  onClose,
  onSubmit,
  initial,
  partnerName,
}) {
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [type, setType] = useState("cash");
  const [networkId, setNetworkId] = useState("");
  const [address, setAddress] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setCurrency(initial?.currency || "USD");
      setType(initial?.type || "cash");
      setNetworkId(initial?.networkId || "");
      setAddress(initial?.address || "");
      setOpeningBalance(initial?.openingBalance != null ? String(initial.openingBalance) : "");
      setNote(initial?.note || "");
    }
  }, [open, initial]);

  // Если пользователь меняет валюту на crypto, автоподстановка типа.
  useEffect(() => {
    if (currency && currencyDict[currency]?.type === "crypto" && type !== "crypto") {
      setType("crypto");
    }
  }, [currency, currencyDict, type]);

  const isCrypto = type === "crypto";
  const cleanName = name.trim();
  // Парсим вручную чтобы парсер не съел знак минус (партнёрский счёт
  // может быть отрицательным = «партнёр должен нам с прошлого периода»).
  const obRaw = parseFloat(String(openingBalance).replace(",", "."));
  const ob = Number.isFinite(obRaw) ? obRaw : 0;

  const canSubmit = cleanName.length > 0 && currency && (!isCrypto || networkId);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      name: cleanName,
      currency,
      type,
      networkId: isCrypto ? networkId : null,
      address: isCrypto ? address.trim() : null,
      openingBalance: ob,
      note: note.trim() || null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Редактировать счёт партнёра" : "Новый счёт партнёра"}
      subtitle={partnerName ? `Партнёр: ${partnerName}` : undefined}
      width="md"
    >
      <div className="p-5 space-y-3">
        {/* Имя */}
        <div>
          <label className="block text-[10.5px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
            Имя счёта
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="USDT TRC20 / RUB Москва / EUR Sberbank…"
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>

        {/* Валюта + тип в один ряд */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10.5px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
              Валюта
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold outline-none cursor-pointer"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c} ({currencyDict[c]?.type || "fiat"})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10.5px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
              Тип счёта
            </label>
            <div className="grid grid-cols-3 gap-1">
              {TYPE_OPTIONS.map((t) => {
                const Icon = t.icon;
                const active = type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={`flex flex-col items-center justify-center py-2 rounded-[8px] border-2 transition-colors ${
                      active
                        ? "bg-indigo-50 border-indigo-400 text-indigo-900"
                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 mb-0.5" />
                    <span className="text-[10px] font-bold">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Network для crypto */}
        {isCrypto && (
          <div>
            <label className="block text-[10.5px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
              Сеть
            </label>
            <select
              value={networkId}
              onChange={(e) => setNetworkId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold outline-none cursor-pointer"
            >
              <option value="">— выберите сеть —</option>
              {CRYPTO_NETWORKS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}

        {/* Address для crypto (опц.) */}
        {isCrypto && (
          <div>
            <label className="block text-[10.5px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
              Адрес (опционально)
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x... / T..."
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[12.5px] font-mono outline-none"
            />
          </div>
        )}

        {/* Opening balance */}
        <div>
          <label className="block text-[10.5px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
            Стартовый баланс
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={openingBalance}
            onChange={(e) =>
              setOpeningBalance(
                // Допускаем минус (партнёрский счёт может быть отрицательным).
                e.target.value.replace(/[^\d.,-]/g, "").replace(",", ".")
              )
            }
            placeholder="0 (можно отрицательный)"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] font-bold tabular-nums outline-none"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            Текущий остаток на счёте партнёра. Может быть отрицательным —
            знак минус означает «партнёр в долгу со старого периода». Не
            влияет на наш баланс.
          </p>
        </div>

        {/* Note */}
        <div>
          <label className="block text-[10.5px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
            Заметка
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="—"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-white border border-slate-200 text-slate-700 text-[13px] font-semibold hover:bg-slate-50"
        >
          Отмена
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-bold transition-colors ${
            canSubmit
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}
