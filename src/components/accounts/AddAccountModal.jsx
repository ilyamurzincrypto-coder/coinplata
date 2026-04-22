// src/components/accounts/AddAccountModal.jsx
// Минимальная модалка создания счёта. Source of truth для валют — useCurrencies().
// Тип счёта зависит от типа валюты:
//   fiat  → cash | bank
//   crypto → crypto (без под-выбора сети — для простоты; network можно указать в имени)

import React, { useState, useEffect } from "react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

export default function AddAccountModal({ open, officeId, officeName, onClose }) {
  const { t } = useTranslation();
  const { addAccount } = useAccounts();
  const { currencies } = useCurrencies();
  const { addEntry: logAudit } = useAudit();

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [type, setType] = useState("cash");
  const [openingBalance, setOpeningBalance] = useState("");
  const [error, setError] = useState("");

  const selectedCurrency = currencies.find((c) => c.code === currency);
  const isCrypto = selectedCurrency?.type === "crypto";

  // Reset при открытии
  useEffect(() => {
    if (open) {
      setName("");
      setCurrency(currencies[0]?.code || "USD");
      setType("cash");
      setOpeningBalance("");
      setError("");
    }
  }, [open, currencies]);

  // Авто-коррекция типа когда меняется валюта
  useEffect(() => {
    if (isCrypto && type !== "crypto") setType("crypto");
    if (!isCrypto && type === "crypto") setType("cash");
  }, [isCrypto]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = name.trim().length > 0 && currency && officeId;

  const handleSubmit = () => {
    if (!canSubmit) {
      setError("Name and currency required");
      return;
    }
    const balance = parseFloat(openingBalance) || 0;
    addAccount({
      officeId,
      name: name.trim(),
      currency,
      type,
      balance,
      active: true,
    });
    logAudit({
      action: "create",
      entity: "account",
      entityId: name.trim(),
      summary: `Added account "${name.trim()}" (${currency} · ${type}) in ${officeName || officeId}${balance ? ` with opening ${balance}` : ""}`,
    });
    onClose?.();
  };

  const typeOptions = isCrypto
    ? [{ id: "crypto", label: "Crypto" }]
    : [
        { id: "cash", label: "Cash" },
        { id: "bank", label: "Bank" },
        { id: "exchange", label: "Exchange" },
      ];

  return (
    <Modal open={open} onClose={onClose} title={t("acc_add_title") || "Add account"} subtitle={officeName} width="md">
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("acc_name") || "Name"}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isCrypto ? "USDT Main TRC20" : "Cash TRY"}
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("currency") || "Currency"}
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold outline-none"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("acc_type") || "Type"}
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={isCrypto}
              className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold outline-none disabled:opacity-60"
            >
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("acc_opening") || "Opening balance (optional)"}
          </label>
          <input
            type="text"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            placeholder="0"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] tabular-nums outline-none"
          />
        </div>

        {error && (
          <div className="text-[12px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
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
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("save") || "Save"}
        </button>
      </div>
    </Modal>
  );
}
