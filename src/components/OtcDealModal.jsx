// src/components/OtcDealModal.jsx
// Быстрая OTC сделка между двумя нашими счетами: «Отдаём X из A → Получаем Y на B».
// Контрагент — text nickname. Поддерживает backdate.
//
// 2026-04-29: мигрирована на новый rpcCreateDeal (0081). Семантика:
//   from-account → OUT (leg.account_id), to-account → IN (in_account_id)
// kind='otc' для видимости в Capital фильтрах.
// Margin/fee рассчитываются из реальных курсов (для fair-rate ≈ 0).

import React, { useState, useEffect, useMemo } from "react";
import { ArrowDown, AlertCircle, Calendar, Users } from "lucide-react";
import Modal from "./ui/Modal.jsx";
import GroupedAccountSelect from "./GroupedAccountSelect.jsx";
import PartnerSelect from "./PartnerSelect.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { useRates } from "../store/rates.jsx";
import { fmt, curSymbol, multiplyAmount } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcSetDealCreatedAt, withToast } from "../lib/supabaseWrite.js";
import { createDeal } from "../lib/dealOperations.js";

export default function OtcDealModal({ open, currentOffice, onClose, onCreated, initialFromAccountId }) {
  const { accounts, balanceOf } = useAccounts();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { getRate } = useRates();

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(""); // datetime-local string
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFromId(initialFromAccountId || "");
      setToId("");
      setFromAmount("");
      setToAmount("");
      setCounterparty("");
      setNote("");
      setOccurredAt("");
    }
  }, [open, initialFromAccountId]);

  const from = activeAccounts.find((a) => a.id === fromId);
  const to = activeAccounts.find((a) => a.id === toId);
  const sameAccount = fromId && toId && fromId === toId;
  const fromBalance = from ? balanceOf(from.id) : 0;
  const fromAmt = parseFloat(String(fromAmount).replace(",", ".")) || 0;
  const toAmt = parseFloat(String(toAmount).replace(",", ".")) || 0;
  const insufficient = from && fromAmt > fromBalance;
  // Курс вычисляется автоматически из сумм (юзер не вводит rate отдельно).
  // Для same-currency = 1. Для cross-currency = toAmt / fromAmt.
  const computedRate = useMemo(() => {
    if (!from || !to) return 0;
    if (from.currency === to.currency) return 1;
    if (fromAmt > 0 && toAmt > 0) return toAmt / fromAmt;
    return 0;
  }, [from, to, fromAmt, toAmt]);

  // Auto-fill toAmount по market rate (подсказка) если пусто
  useEffect(() => {
    if (fromAmt > 0 && !toAmount && from && to && from.currency !== to.currency) {
      const r = getRate(from.currency, to.currency);
      if (r && Number.isFinite(r) && r > 0) {
        setToAmount(String(multiplyAmount(fromAmt, r, 2)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAmt, from, to]);

  const canSubmit =
    from &&
    to &&
    !sameAccount &&
    fromAmt > 0 &&
    toAmt > 0 &&
    computedRate > 0 &&
    counterparty.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || busy || !isSupabaseConfigured) return;
    setBusy(true);
    try {
      const occurredIso = occurredAt
        ? new Date(occurredAt).toISOString()
        : null;
      // Семантика new rpcCreateDeal:
      //   to-account = IN  (deal.in_account_id, deal.amount_in)
      //   from-account = OUT leg (leg.account_id, leg.amount)
      //   leg.rate = fromAmt / toAmt  (per-unit-of-IN в leg-currency)
      const legRate = toAmt > 0 ? fromAmt / toAmt : 0;
      const res = await withToast(
        () =>
          createDeal({
            officeId: from.officeId,
            managerId: currentUser.id,
            clientId: null,
            clientNickname: counterparty.trim(),
            currencyIn: to.currency,
            amountIn: toAmt,
            inAccountId: to.id,
            referral: false,
            comment: note.trim() || `OTC · ${counterparty.trim()}`,
            status: "completed",
            outputs: [{
              currency: from.currency,
              amount: fromAmt,
              rate: legRate,
              accountId: from.id,
              outKind: "ours_now",
            }],
            inKind: "ours_now",
            kind: "otc",
            applyMinFee: false, // OTC swap — без min-fee enforcement
          }),
        {
          success: occurredIso
            ? `OTC сделка оформлена задним числом`
            : "OTC сделка создана",
          errorPrefix: "OTC failed",
        }
      );
      if (res.ok) {
        // Backdate: сетим created_at если указан occurredAt
        if (occurredIso && res.result) {
          try {
            await rpcSetDealCreatedAt({ dealId: res.result, createdAt: occurredIso });
          } catch (e) {
            console.warn("[OtcDealModal] set_deal_created_at failed", e);
          }
        }
        logAudit({
          action: "create",
          entity: "transaction",
          entityId: String(res.result || ""),
          summary: `OTC ${counterparty.trim()}: ${fmt(fromAmt, from.currency)} ${from.currency} → ${fmt(toAmt, to.currency)} ${to.currency} @ ${computedRate.toFixed(6)}${occurredIso ? ` (бэкдейт ${occurredAt})` : ""}`,
        });
        onCreated?.(res.result);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Сделка с контрагентом"
      subtitle="OTC обмен с партнёром — без fee/profit. Можно задним числом."
      width="lg"
    >
      <div className="p-5 space-y-3">
        {/* Counterparty — селектор партнёров с поиском и созданием */}
        <div>
          <label className="flex items-center gap-1.5 text-tiny font-bold text-muted mb-1.5 tracking-wide uppercase">
            <Users className="w-3.5 h-3.5" />
            Контрагент / Партнёр
          </label>
          <PartnerSelect value={counterparty} onChange={setCounterparty} />
        </div>

        {/* From */}
        <div>
          <label className="block text-tiny font-bold text-danger mb-1.5 tracking-wide uppercase">
            Отдаём
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts}
            value={fromId}
            onChange={setFromId}
            placeholder="Выбрать счёт списания"
          />
          {from && (
            <div className="mt-1.5 text-tiny text-muted tabular-nums">
              {officeName(from.officeId)} · Баланс:{" "}
              <span className="font-bold text-ink-soft">
                {curSymbol(from.currency)}
                {fmt(fromBalance, from.currency)} {from.currency}
              </span>
            </div>
          )}
          {from && (
            <div className="mt-2 relative flex items-baseline gap-2 bg-danger-soft/60 rounded-card border-2 border-danger/20 px-4 py-3">
              <span className="text-danger text-[18px] font-semibold">
                {curSymbol(from.currency)}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                onChange={(e) =>
                  setFromAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted-soft tabular-nums text-[20px] font-bold tracking-tight min-w-0"
              />
              <span className="text-danger text-caption font-bold tracking-wider">
                {from.currency}
              </span>
            </div>
          )}
          {insufficient && (
            <div className="mt-1.5 text-tiny font-medium text-warning bg-warning-soft border border-amber-100 rounded-md px-2 py-1 inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Недостаточно средств на счёте
            </div>
          )}
        </div>

        {/* Arrow */}
        <div className="flex justify-center py-1">
          <div className="w-8 h-8 rounded-full bg-surface-sunk flex items-center justify-center">
            <ArrowDown className="w-3.5 h-3.5 text-muted" />
          </div>
        </div>

        {/* To */}
        <div>
          <label className="block text-tiny font-bold text-success mb-1.5 tracking-wide uppercase">
            Получаем
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts.filter((a) => a.id !== fromId)}
            value={toId}
            onChange={setToId}
            placeholder="Выбрать счёт зачисления"
          />
          {to && (
            <div className="mt-2 relative flex items-baseline gap-2 bg-success-soft/60 rounded-card border-2 border-success/20 px-4 py-3">
              <span className="text-success text-[18px] font-semibold">
                {curSymbol(to.currency)}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={toAmount}
                onChange={(e) =>
                  setToAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted-soft tabular-nums text-[20px] font-bold tracking-tight min-w-0"
              />
              <span className="text-success text-caption font-bold tracking-wider">
                {to.currency}
              </span>
            </div>
          )}
        </div>

        {/* Эффективный курс (computed, read-only) */}
        {from && to && fromAmt > 0 && toAmt > 0 && from.currency !== to.currency && (
          <div className="bg-surface-soft border border-border-soft rounded-card px-3 py-2 flex items-center justify-between">
            <span className="text-tiny font-bold text-muted uppercase tracking-wider">
              Эффективный курс
            </span>
            <span className="text-caption font-bold tabular-nums text-ink">
              1 {from.currency} = {computedRate.toFixed(6)} {to.currency}
            </span>
          </div>
        )}

        {/* Backdate */}
        <div>
          <label className="flex items-center gap-1.5 text-tiny font-bold text-muted mb-1.5 tracking-wide uppercase">
            <Calendar className="w-3.5 h-3.5" />
            Дата (опционально — оставь пусто для текущей)
          </label>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2.5 text-body-sm outline-none"
          />
          <p className="text-tiny text-muted mt-1">
            Сделка задним числом — useful для дозаписи прошедших OTC обменов.
          </p>
        </div>

        {/* Note */}
        <div>
          <label className="block text-tiny font-bold text-muted mb-1.5 tracking-wide uppercase">
            Заметка
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="—"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2.5 text-body-sm outline-none"
          />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk transition-colors disabled:opacity-60"
        >
          Отмена
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className={`px-4 py-2 rounded-card text-body-sm font-semibold transition-colors ${
            canSubmit && !busy
              ? "bg-ink text-white hover:bg-ink"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
        >
          {busy ? "Создание…" : occurredAt ? "Создать (бэкдейт)" : "Создать сделку"}
        </button>
      </div>
    </Modal>
  );
}
