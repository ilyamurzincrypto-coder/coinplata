// src/pages/treasury_v2/parts/CreateLiabilityDialog.jsx
//
// «Новое обязательство» — ручная корректировка customer_liab / partner_liab
// для опенинга или сверки. Опертор выбирает контрагента + валюту + сторону
// (мы должны / должны нам) + сумму + причину → rpcCreateAdjustmentV2 с
// adjustmentKind='opening', clientId/partnerId.
//
// Account_code определяется автоматически из customer_liab/partner_liab по валюте.
// Balancing — opening_balance equity (резолвится в самой RPC если не задан).

import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { rpcCreateAdjustmentV2 } from "../../../lib/newLedger.js";
import { bumpDataVersion } from "../../../lib/dataVersion.jsx";
import { emitToast } from "../../../lib/toast.jsx";

// Доступные валюты для customer_liab/partner_liab — берём из ctx.accounts.
function liabilityAccountByCurrency(accounts, kind, currency) {
  const subtype = kind === "client" ? "customer_liab" : "partner_liab";
  return (accounts || []).find(
    (a) => a.subtype === subtype && a.currency === currency && a.active !== false
  );
}

function uniqueLiabilityCurrencies(accounts, kind) {
  const subtype = kind === "client" ? "customer_liab" : "partner_liab";
  const seen = new Set();
  (accounts || []).forEach((a) => {
    if (a.subtype === subtype && a.active !== false) seen.add(a.currency);
  });
  return Array.from(seen);
}

export default function CreateLiabilityDialog({ open, onClose, ctx, clients, partners }) {
  const [kind, setKind] = useState("client");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [currency, setCurrency] = useState("USD");
  // direction: 'we_owe' = мы должны (Кт liab, amount<0) | 'they_owe' = они должны (Дт liab, amount>0)
  const [direction, setDirection] = useState("we_owe");
  // adjustmentKind: 'opening' — стартовый остаток (балансирующий = Opening Equity);
  // 'reconciliation' — сверка/корректировка задним числом (балансирующий = Retained Earnings).
  const [adjustmentKind, setAdjustmentKind] = useState("opening");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const counterpartyList = useMemo(() => {
    if (kind === "client") {
      return [...(clients || [])].sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));
    }
    return [...(partners || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [kind, clients, partners]);

  const availableCurrencies = useMemo(
    () => uniqueLiabilityCurrencies(ctx?.accounts || [], kind),
    [ctx?.accounts, kind]
  );

  // Если выбранная валюта недоступна для нового kind — переключаем на первую.
  React.useEffect(() => {
    if (availableCurrencies.length && !availableCurrencies.includes(currency)) {
      setCurrency(availableCurrencies[0]);
    }
  }, [availableCurrencies, currency]);

  const canSubmit =
    !!counterpartyId &&
    !!currency &&
    parseFloat(amount) > 0 &&
    reason.trim().length > 0 &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    const liab = liabilityAccountByCurrency(ctx?.accounts || [], kind, currency);
    if (!liab) {
      emitToast("error", `Нет счёта ${kind === "client" ? "customer" : "partner"}_liab для ${currency}`);
      return;
    }
    const magnitude = Math.abs(parseFloat(amount));
    // we_owe → liability на стороне предприятия = Кт liab = p_amount<0 (delta уменьшает Дт-нормаль)
    // they_owe → клиент должен нам = Дт liab = p_amount>0
    const signed = direction === "they_owe" ? magnitude : -magnitude;

    try {
      setSubmitting(true);
      await rpcCreateAdjustmentV2({
        accountCode: liab.code,
        amount: signed,
        currencyCode: currency,
        reason: reason.trim(),
        adjustmentKind,
        clientId: kind === "client" ? counterpartyId : null,
        partnerId: kind === "partner" ? counterpartyId : null,
      });
      bumpDataVersion();
      emitToast("success", adjustmentKind === "opening" ? "Опенинг записан" : "Корректировка записана");
      onClose();
      // reset
      setCounterpartyId("");
      setAmount("");
      setReason("");
      setAdjustmentKind("opening");
    } catch (err) {
      emitToast("error", err?.message || "Не удалось создать обязательство");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-card-lg shadow-modal w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-h3 text-ink font-semibold">Новое обязательство</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-badge text-muted hover:text-ink hover:bg-surface-soft transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Kind toggle */}
          <div className="inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill">
            <button
              type="button"
              onClick={() => { setKind("client"); setCounterpartyId(""); }}
              className={`h-7 px-3 rounded-pill text-tiny font-semibold transition-all ${
                kind === "client" ? "bg-surface text-ink shadow-seg" : "text-muted hover:text-ink"
              }`}
            >
              Клиент
            </button>
            <button
              type="button"
              onClick={() => { setKind("partner"); setCounterpartyId(""); }}
              className={`h-7 px-3 rounded-pill text-tiny font-semibold transition-all ${
                kind === "partner" ? "bg-surface text-ink shadow-seg" : "text-muted hover:text-ink"
              }`}
            >
              Партнёр
            </button>
          </div>

          {/* Counterparty select */}
          <label className="block">
            <span className="block text-micro text-muted uppercase mb-1">
              {kind === "client" ? "Клиент *" : "Партнёр *"}
            </span>
            <select
              value={counterpartyId}
              onChange={(e) => setCounterpartyId(e.target.value)}
              disabled={submitting}
              className="w-full h-9 px-2 rounded-input bg-surface-sunk text-ink text-caption border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
            >
              <option value="">— выбери —</option>
              {counterpartyList.map((c) => (
                <option key={c.id} value={c.id}>
                  {kind === "client" ? (c.nickname || c.fullName || c.id.slice(0, 8)) : (c.name || c.id.slice(0, 8))}
                </option>
              ))}
            </select>
          </label>

          {/* Currency + Direction row */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-micro text-muted uppercase mb-1">Валюта *</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={submitting || availableCurrencies.length === 0}
                className="w-full h-9 px-2 rounded-input bg-surface-sunk text-ink text-caption font-mono border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
              >
                {availableCurrencies.length === 0 ? (
                  <option value="">—</option>
                ) : (
                  availableCurrencies.map((c) => <option key={c} value={c}>{c}</option>)
                )}
              </select>
            </label>
            <label className="block">
              <span className="block text-micro text-muted uppercase mb-1">Сумма *</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting}
                placeholder="0.00"
                className="w-full h-9 px-2 rounded-input bg-surface-sunk text-ink text-caption font-mono tabular border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
              />
            </label>
          </div>

          {/* Direction */}
          <div>
            <span className="block text-micro text-muted uppercase mb-1.5">Сторона</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection("we_owe")}
                className={`p-2.5 rounded-card text-left border-[1.5px] transition-all ${
                  direction === "we_owe"
                    ? "bg-surface border-ink shadow-soft"
                    : "bg-surface-soft border-transparent hover:bg-surface-sunk"
                }`}
              >
                <div className="text-caption font-semibold text-ink">Мы должны</div>
                <div className="text-tiny text-muted leading-tight mt-0.5">
                  контрагент сдал нам деньги
                </div>
              </button>
              <button
                type="button"
                onClick={() => setDirection("they_owe")}
                className={`p-2.5 rounded-card text-left border-[1.5px] transition-all ${
                  direction === "they_owe"
                    ? "bg-surface border-ink shadow-soft"
                    : "bg-surface-soft border-transparent hover:bg-surface-sunk"
                }`}
              >
                <div className="text-caption font-semibold text-ink">Нам должны</div>
                <div className="text-tiny text-muted leading-tight mt-0.5">
                  выдали без оплаты / overdraft
                </div>
              </button>
            </div>
          </div>

          {/* Adjustment kind */}
          <div>
            <span className="block text-micro text-muted uppercase mb-1.5">Тип</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdjustmentKind("opening")}
                className={`p-2.5 rounded-card text-left border-[1.5px] transition-all ${
                  adjustmentKind === "opening"
                    ? "bg-surface border-ink shadow-soft"
                    : "bg-surface-soft border-transparent hover:bg-surface-sunk"
                }`}
              >
                <div className="text-caption font-semibold text-ink">Опенинг</div>
                <div className="text-tiny text-muted leading-tight mt-0.5">
                  стартовый остаток против Opening Equity
                </div>
              </button>
              <button
                type="button"
                onClick={() => setAdjustmentKind("reconciliation")}
                className={`p-2.5 rounded-card text-left border-[1.5px] transition-all ${
                  adjustmentKind === "reconciliation"
                    ? "bg-surface border-ink shadow-soft"
                    : "bg-surface-soft border-transparent hover:bg-surface-sunk"
                }`}
              >
                <div className="text-caption font-semibold text-ink">Сверка</div>
                <div className="text-tiny text-muted leading-tight mt-0.5">
                  корректировка против Retained Earnings
                </div>
              </button>
            </div>
          </div>

          {/* Reason */}
          <label className="block">
            <span className="block text-micro text-muted uppercase mb-1">Причина *</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder={adjustmentKind === "opening" ? "например: опенинг на 2026-01-01" : "например: сверка по итогам месяца"}
              className="w-full px-2 py-1.5 rounded-input bg-surface-sunk text-ink text-caption border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all resize-none"
            />
          </label>
        </div>

        {/* Actions */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-3 rounded-button text-caption font-semibold text-ink-soft hover:bg-surface-soft transition-colors disabled:opacity-40"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-9 px-4 rounded-button text-caption font-semibold bg-ink text-white shadow-cta-glow hover:bg-black hover:-translate-y-px transition-all disabled:opacity-40 disabled:hover:translate-y-0"
          >
            {submitting ? "Сохранение…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
