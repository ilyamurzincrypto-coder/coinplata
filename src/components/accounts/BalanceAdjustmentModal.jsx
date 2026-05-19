// src/components/accounts/BalanceAdjustmentModal.jsx
//
// Корректировка начального баланса счёта (миграция 0084).
//
// Принцип. НЕ меняет баланс напрямую. Записывает row в balance_adjustments
// + эмитит account_movement с source_kind='adjustment'. Балансы сами
// пересчитываются (они = sum(movements)). НЕ влияет на P&L.
//
// Доступ: только admin/accountant/owner. UI guard через useCan не включаем —
// серверный _require_role в RPC уже отсекает.
//
// UX:
//   - Current balance (read-only)
//   - Set new balance (input)
//   - Preview difference (auto)
//   - Comment (required)
//   - Confirmation подсказка с предупреждением

import React, { useState, useEffect, useMemo } from "react";
import { Scale, AlertCircle, Calculator, History } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { withToast } from "../../lib/supabaseWrite.js";
import { createBalanceAdjustment } from "../../lib/dealOperations.js";
import { loadBalanceAdjustments } from "../../lib/supabaseReaders.js";
import { useTranslation } from "../../i18n/translations.jsx";

export default function BalanceAdjustmentModal({ open, account, onClose, onAdjusted }) {
  const { t } = useTranslation();
  const { balanceOf } = useAccounts();
  const [newBalanceInput, setNewBalanceInput] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setNewBalanceInput("");
      setNote("");
      setBusy(false);
      setConfirmStep(false);
      setShowHistory(false);
    }
  }, [open, account?.id]);

  if (!account) return null;

  const currentBalance = balanceOf(account.id);
  const newBalanceNum = parseFloat(String(newBalanceInput).replace(",", "."));
  const validNewBalance = Number.isFinite(newBalanceNum);
  const diff = validNewBalance ? newBalanceNum - currentBalance : 0;
  const noChange = Math.abs(diff) < 0.00000001;
  const noteValid = note.trim().length > 0;
  const canSubmit = validNewBalance && !noChange && noteValid && !busy;

  const handleSubmit = async () => {
    if (!canSubmit || !isSupabaseConfigured) return;
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    setBusy(true);
    try {
      const res = await withToast(
        () => createBalanceAdjustment({
          accountId: account.id,
          newBalance: newBalanceNum,
          note: note.trim(),
        }),
        {
          success: `Баланс ${account.name} обновлён`,
          errorPrefix: "Adjustment failed",
        }
      );
      if (res.ok) {
        onAdjusted?.(res.result);
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleShowHistory = async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (history.length === 0) {
      setHistoryLoading(true);
      try {
        const rows = await loadBalanceAdjustments(account.id);
        setHistory(rows);
      } catch (e) {
        console.warn("[BalanceAdjustmentModal] history load failed", e);
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  const sym = curSymbol(account.currency);
  const isPositive = diff > 0;
  const isNegative = diff < 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("ba_title")}
      subtitle={`${account.name} · ${account.currency}`}
      width="md"
    >
      <div className="p-5 space-y-4">
        {/* Current balance */}
        <div className="rounded-card border border-border-soft bg-surface-soft p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
            <Scale className="w-3.5 h-3.5" />
            Текущий баланс
          </div>
          <div className="text-[22px] font-bold text-ink tabular-nums">
            {sym}{fmt(currentBalance, account.currency)}
            <span className="ml-2 text-[14px] text-muted-soft font-semibold">{account.currency}</span>
          </div>
        </div>

        {/* New balance input */}
        <div>
          <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
            Новый баланс
          </label>
          <div className="relative flex items-baseline gap-2 bg-white rounded-card border-2 border-border focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/20 px-4 py-3">
            <span className="text-muted text-[18px] font-semibold">{sym}</span>
            <input
              type="text"
              inputMode="decimal"
              value={newBalanceInput}
              onChange={(e) => {
                setNewBalanceInput(e.target.value.replace(/[^\d.,\-]/g, "").replace(",", "."));
                setConfirmStep(false);
              }}
              placeholder="0.00"
              autoFocus
              className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted-soft tabular-nums text-[20px] font-bold tracking-tight min-w-0"
            />
            <span className="text-muted-soft text-[12px] font-bold tracking-wider">{account.currency}</span>
          </div>
        </div>

        {/* Diff preview */}
        {validNewBalance && !noChange && (
          <div
            className={`rounded-card border p-3 flex items-center gap-2 ${
              isPositive
                ? "border-success/20 bg-success-soft text-success"
                : "border-danger/20 bg-danger-soft text-danger"
            }`}
          >
            <Calculator className="w-4 h-4 shrink-0" />
            <div className="text-[12px] flex-1">
              <span className="font-bold">
                {isPositive ? "+" : ""}{fmt(diff, account.currency)} {account.currency}
              </span>
              <span className="opacity-70 ml-2">
                ({isPositive ? "увеличение" : "уменьшение"} баланса)
              </span>
            </div>
          </div>
        )}
        {validNewBalance && noChange && (
          <div className="rounded-card border border-warning/20 bg-warning-soft text-warning p-3 flex items-center gap-2 text-[12px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Новый баланс равен текущему — корректировать нечего.
          </div>
        )}

        {/* Note */}
        <div>
          <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
            Комментарий <span className="text-danger">*</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setConfirmStep(false);
            }}
            rows={2}
            placeholder="Например: инвентаризация на 29.04.26, разница из-за ручного завоза налички"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2.5 text-[13px] outline-none resize-none"
          />
          <div className="text-[10.5px] text-muted mt-1">
            Обязательно — попадёт в audit trail и историю.
          </div>
        </div>

        {/* Confirmation warning */}
        {confirmStep && (
          <div className="rounded-card border-2 border-warning/30 bg-warning-soft p-3 text-[12px] text-warning">
            <div className="flex items-center gap-1.5 font-bold mb-1">
              <AlertCircle className="w-4 h-4" />
              Подтвердите корректировку
            </div>
            <p className="opacity-80">
              Это создаст запись в audit trail с движением {isPositive ? "+" : ""}{fmt(diff, account.currency)} {account.currency}.
              Корректировка <b>не повлияет на P&L</b>, но будет видна в истории движений как «adjustment».
            </p>
          </div>
        )}

        {/* History toggle */}
        <button
          type="button"
          onClick={handleShowHistory}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-soft hover:text-ink transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          {showHistory ? "Скрыть историю" : "История корректировок"}
        </button>
        {showHistory && (
          <div className="rounded-card border border-border-soft bg-white max-h-48 overflow-auto">
            {historyLoading ? (
              <div className="p-4 text-center text-[12px] text-muted-soft">Загрузка…</div>
            ) : history.length === 0 ? (
              <div className="p-4 text-center text-[12px] text-muted-soft">Корректировок ещё не было</div>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border-soft text-left text-[10px] font-bold text-muted tracking-wider uppercase">
                    <th className="px-3 py-2">Дата</th>
                    <th className="px-3 py-2 text-right">Было</th>
                    <th className="px-3 py-2 text-right">Стало</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2">Кто</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const d = new Date(h.createdAt);
                    return (
                      <tr key={h.id} className="border-b border-border-soft last:border-0">
                        <td className="px-3 py-1.5 tabular-nums text-ink-soft">
                          {d.toLocaleDateString("en-GB")} {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                          {fmt(h.oldBalance, h.currency)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-ink-soft font-semibold">
                          {fmt(h.newBalance, h.currency)}
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${
                          h.difference > 0 ? "text-success" : "text-danger"
                        }`}>
                          {h.difference > 0 ? "+" : ""}{fmt(h.difference, h.currency)}
                        </td>
                        <td className="px-3 py-1.5 text-ink-soft">
                          {h.createdByName || "—"}
                          {h.note && (
                            <div className="text-[10px] text-muted-soft truncate max-w-[180px]" title={h.note}>
                              {h.note}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-[13px] font-semibold hover:bg-surface-sunk transition-colors disabled:opacity-60"
        >
          Отмена
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-card text-[13px] font-semibold transition-colors ${
            canSubmit
              ? confirmStep
                ? "bg-warning text-white hover:bg-warning"
                : "bg-ink text-white hover:bg-ink"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
        >
          {busy ? "Сохранение…" : confirmStep ? "Подтвердить" : "Скорректировать"}
        </button>
      </div>
    </Modal>
  );
}
