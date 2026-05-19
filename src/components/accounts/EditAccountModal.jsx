// src/components/accounts/EditAccountModal.jsx
// Редактирование операционного счёта: имя, адрес (для крипты), сеть (TRC20/ERC20/BEP20,
// только крипта), активность (деактивировать / восстановить). Офис и валюту менять
// нельзя — это структурные поля, изменение оторвало бы ledger-привязку.
// Submit → updateAccount({ id, name, address, networkId, active }) → перезагрузка
// страницы через bumpDataVersion. Структура зеркалит BalanceAdjustmentModal.
import React, { useEffect, useState } from "react";
import { Pencil, AlertCircle } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { updateAccount, withToast } from "../../lib/supabaseWrite.js";
import { useTranslation } from "../../i18n/translations.jsx";

const NETWORKS = ["TRC20", "ERC20", "BEP20"];

function isCryptoAccount(account) {
  return account?.type === "crypto" || account?.type === "network" || !!account?.network;
}

export default function EditAccountModal({ open, account, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [networkId, setNetworkId] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !account) return;
    setName(account.name || "");
    setAddress(account.address || "");
    setNetworkId((account.network || "").toUpperCase());
    setActive(account.active !== false);
    setBusy(false);
  }, [open, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!account) return null;

  const crypto = isCryptoAccount(account);
  const nameValid = name.trim().length > 0;
  const canSubmit = nameValid && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!isSupabaseConfigured) { onClose?.(); return; }
    setBusy(true);
    try {
      const res = await withToast(
        () =>
          updateAccount({
            id: account.id,
            name: name.trim(),
            address: crypto ? address.trim() : undefined,
            networkId: crypto ? (networkId || null) : undefined,
            active,
          }),
        { success: t("acc_edit_done"), errorPrefix: t("acc_edit_failed") }
      );
      if (res.ok) {
        onSaved?.();
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("acc_edit_title")}
      subtitle={`${account.name} · ${account.currency}`}
      width="md"
    >
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
            {t("acc_edit_name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>

        {crypto && (
          <>
            <div>
              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
                {t("acc_edit_address")}
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
                placeholder={networkId === "ERC20" || networkId === "BEP20" ? "0x…" : "T…"}
                className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-[10px] px-3 py-2.5 text-[12px] font-mono outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
                {t("acc_edit_network")}
              </label>
              <select
                value={networkId}
                onChange={(e) => setNetworkId(e.target.value)}
                className="w-full bg-surface-soft border border-border-soft hover:border-border focus:bg-white focus:border-accent rounded-[10px] px-3 py-2.5 text-[13px] font-semibold outline-none"
              >
                <option value="">—</option>
                {NETWORKS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </>
        )}

        <label className="flex items-center gap-2 cursor-pointer select-none bg-surface-soft border border-border-soft rounded-[10px] px-3 py-2.5 hover:border-border transition-colors">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="w-4 h-4 rounded-[4px] accent-slate-900"
          />
          <span className="text-[13px] font-medium text-ink-soft">
            {active ? t("acc_edit_active") : t("acc_edit_inactive")}
          </span>
        </label>

        {!active && (
          <div className="rounded-[10px] border border-amber-200 bg-warning-soft text-amber-800 p-3 flex items-center gap-2 text-[12px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {t("acc_edit_inactive_hint")}
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-[10px] bg-surface-sunk text-ink-soft text-[13px] font-semibold hover:bg-surface-sunk transition-colors disabled:opacity-60"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit ? "bg-ink text-white hover:bg-ink" : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
        >
          {busy ? t("acc_edit_saving") : t("save")}
        </button>
      </div>
    </Modal>
  );
}
