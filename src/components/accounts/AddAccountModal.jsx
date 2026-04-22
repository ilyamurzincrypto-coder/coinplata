// src/components/accounts/AddAccountModal.jsx
// Форма: office (fixed) → currency → channel → name → optional address (для crypto).
// channelId — обязателен. Тип account.type производный от channel.kind:
//   cash → "cash", bank → "bank", sepa/swift → "bank", network → "crypto".
// address, network, isDeposit, isWithdrawal прописываются для crypto.

import React, { useState, useEffect, useMemo } from "react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useRates } from "../../store/rates.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { channelShortLabel } from "../../utils/accountChannel.js";

function deriveType(channelKind) {
  if (channelKind === "network") return "crypto";
  if (channelKind === "sepa" || channelKind === "swift") return "bank";
  return channelKind || "cash";
}

export default function AddAccountModal({ open, officeId, officeName, prefill, onClose }) {
  const { t } = useTranslation();
  const { addAccount } = useAccounts();
  const { currencies } = useCurrencies();
  const { channels } = useRates();
  const { addEntry: logAudit } = useAudit();

  const [currency, setCurrency] = useState("USD");
  const [channelId, setChannelId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isDeposit, setIsDeposit] = useState(true);
  const [isWithdrawal, setIsWithdrawal] = useState(true);
  const [error, setError] = useState("");

  // Reset при открытии + применить prefill (из "Add" рядом с каналом).
  useEffect(() => {
    if (!open) return;
    const c = prefill?.currency || currencies[0]?.code || "USD";
    setCurrency(c);
    setName("");
    setAddress("");
    setBankRef("");
    setOpeningBalance("");
    setIsDeposit(true);
    setIsWithdrawal(true);
    setError("");
    // channelId apply после currency (в отдельном эффекте, когда список каналов синхронизируется)
    if (prefill?.channelId) {
      setChannelId(prefill.channelId);
    } else {
      setChannelId(""); // выберем сами ниже
    }
  }, [open, prefill, currencies]);

  const selectedCurrency = currencies.find((c) => c.code === currency);
  const currencyChannels = useMemo(
    () => channels.filter((c) => c.currencyCode === currency),
    [channels, currency]
  );

  // При смене валюты — если выбранный channel больше не принадлежит валюте, переключаемся на default/первый.
  useEffect(() => {
    if (channelId && currencyChannels.some((c) => c.id === channelId)) return;
    const def = currencyChannels.find((c) => c.isDefaultForCurrency) || currencyChannels[0];
    setChannelId(def?.id || "");
  }, [currency, currencyChannels, channelId]);

  const selectedChannel = channels.find((c) => c.id === channelId) || null;
  const isCryptoChannel = selectedChannel?.kind === "network";
  const isBankChannel =
    selectedChannel?.kind === "bank" ||
    selectedChannel?.kind === "sepa" ||
    selectedChannel?.kind === "swift";

  const canSubmit = name.trim().length > 0 && currency && channelId && officeId;

  const handleSubmit = () => {
    if (!canSubmit) {
      setError("Name, currency and channel are required");
      return;
    }
    if (isCryptoChannel && isDeposit && !address.trim()) {
      setError("Address is required for a deposit crypto account");
      return;
    }
    const balance = parseFloat(openingBalance) || 0;
    const type = deriveType(selectedChannel.kind);
    const payload = {
      officeId,
      name: name.trim(),
      currency,
      channelId,
      type,
      balance,
      active: true,
    };
    if (isCryptoChannel) {
      payload.address = address.trim();
      payload.network = (selectedChannel.network || "").toUpperCase();
      payload.isDeposit = isDeposit;
      payload.isWithdrawal = isWithdrawal;
      payload.lastCheckedBlock = 0;
      payload.lastCheckedAt = null;
    }
    if (isBankChannel && bankRef.trim()) {
      payload.bankRef = bankRef.trim();
    }

    addAccount(payload);

    const summaryExtras = [
      `${currency}`,
      channelShortLabel(selectedChannel),
      balance ? `opening ${balance}` : null,
      isCryptoChannel && address ? `addr ${address.slice(0, 10)}…` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    logAudit({
      action: "create",
      entity: "account",
      entityId: name.trim(),
      summary: `Added account "${name.trim()}" (${summaryExtras}) in ${officeName || officeId}`,
    });
    onClose?.();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("acc_add_title") || "Add account"}
      subtitle={officeName}
      width="md"
    >
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              Currency
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
              Channel
            </label>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              disabled={currencyChannels.length === 0}
              className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold outline-none disabled:opacity-60"
            >
              {currencyChannels.length === 0 && <option>— no channels —</option>}
              {currencyChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {channelShortLabel(c)}
                  {c.isDefaultForCurrency ? " · default" : ""}
                  {c.gasFee != null ? ` (gas $${c.gasFee})` : ""}
                </option>
              ))}
            </select>
            {currencyChannels.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                Add a channel for {currency} in Dashboard → Edit rates first.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("acc_name") || "Name"}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isCryptoChannel ? "TRC20 Main" : "Cash · Safe A"}
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>

        {isCryptoChannel && (
          <>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                Wallet address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
                placeholder={selectedChannel?.network === "ERC20" ? "0x…" : "T…"}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[12px] font-mono outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Used by polling to auto-detect incoming transactions.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={isDeposit}
                onChange={setIsDeposit}
                label="Deposit (monitor incoming)"
              />
              <Toggle
                checked={isWithdrawal}
                onChange={setIsWithdrawal}
                label="Withdrawal"
              />
            </div>
          </>
        )}

        {isBankChannel && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              Bank details (optional)
            </label>
            <input
              type="text"
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              placeholder="IBAN / account number"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("acc_opening") || "Opening balance (optional)"}
          </label>
          <input
            type="text"
            value={openingBalance}
            onChange={(e) =>
              setOpeningBalance(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
            }
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

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex-1 flex items-center gap-2 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 hover:border-slate-300 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded-[4px] accent-slate-900"
      />
      <span className="text-[12px] font-medium text-slate-700">{label}</span>
    </label>
  );
}
