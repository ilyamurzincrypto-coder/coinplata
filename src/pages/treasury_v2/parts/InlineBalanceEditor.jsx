// Inline-редактирование итогового остатка счёта в Казначействе. Боевой
// режим: при клике на янтарную плашку открывается компактный поповер с
// полями:
//   • Новый остаток (число, в формате отображения с учётом displayMul)
//   • Комментарий (обязательно — audit trail)
//   • Дата эффекта (по умолчанию сегодня)
//   • Тип: «Корректировка» (default → Retained Earnings) или
//          «Начальный остаток» (→ Opening Equity)
//
// Save → ledger.create_adjustment → source_kind='adjustment' в Журнале.
// Гард: видим только при accounting:edit. Сам Opening Equity inline не
// правится (там Журнал → ручная проводка).
import React, { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { useCan } from "../../../store/permissions.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { setAccountBalance, SetBalanceError } from "../../../lib/treasury/setAccountBalance.js";

function fmtNum(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseInput(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/\s+/g, "").replace(",", ".");
  if (s === "" || s === "-" || s === ".") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function todayInputValue() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function InlineBalanceEditor({
  account, // { code, currency, type, subtype, balance, ... }
  displayMul = 1,
  accounts, // ctx.accounts — нужен в setAccountBalance чтобы найти Opening Equity
  className = "",
  suffix = "",
  clientId = null,
  partnerId = null,
  balanceOverride = null,
  // mode="newDim" — режим добавления НОВОГО субконто (контрагент ещё не
  // записан на этом счёте). В попровере появляется пикер клиента/партнёра
  // первым полем. balance стартует с 0. Триггер — "+ Контрагент" кнопка.
  mode = "edit",
  dimKind = null, // 'client' | 'partner'
  dimOptions = [], // [{id, name}]
}) {
  const isNewDim = mode === "newDim";
  const can = useCan();
  const canEdit = can("accounting", "edit");
  const rawBalance =
    balanceOverride != null ? Number(balanceOverride) : Number(account?.balance || 0);
  const displayed = rawBalance * displayMul;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [dateStr, setDateStr] = useState(todayInputValue);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDimId, setSelectedDimId] = useState("");
  const popoverRef = useRef(null);
  const inputRef = useRef(null);

  const isOpeningEquity =
    account?.type === "equity" && (account?.subtype || "") === "opening_balance";
  const editable = canEdit && !isOpeningEquity;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Close on outside click
  useEffect(() => {
    if (!editing) return undefined;
    const onClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        // Не закрываем если идёт сабмит, чтобы не сорвать запрос
        if (!submitting) cancel();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [editing, submitting]);

  function startEdit(e) {
    e?.stopPropagation();
    if (!editable || submitting) return;
    setDraft(isNewDim ? "0" : displayed.toFixed(2));
    setReason("");
    setDateStr(todayInputValue());
    setSelectedDimId("");
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft("");
    setReason("");
    setSelectedDimId("");
  }

  async function commit() {
    const parsed = parseInput(draft);
    if (!Number.isFinite(parsed)) {
      emitToast("error", "Введи число");
      return;
    }
    if (!reason.trim()) {
      emitToast("error", "Заполни комментарий (обязательно для аудита)");
      return;
    }
    if (isNewDim && !selectedDimId) {
      emitToast("error", `Выбери ${dimKind === "client" ? "клиента" : "партнёра"}`);
      return;
    }
    try {
      setSubmitting(true);
      const effDate = dateStr
        ? new Date(`${dateStr}T12:00:00.000Z`).toISOString()
        : new Date().toISOString();
      // В newDim режиме dim берётся из пикера и забивает clientId/partnerId.
      const effClientId = isNewDim
        ? (dimKind === "client" ? selectedDimId : null)
        : clientId;
      const effPartnerId = isNewDim
        ? (dimKind === "partner" ? selectedDimId : null)
        : partnerId;
      const res = await setAccountBalance({
        target: {
          code: account.code,
          currency: account.currency,
          type: account.type,
          subtype: account.subtype,
        },
        oldDisplayed: isNewDim ? 0 : displayed,
        newDisplayed: parsed,
        displayMul,
        accounts,
        clientId: effClientId,
        partnerId: effPartnerId,
        effectiveDate: effDate,
        reason: reason.trim(),
      });
      if (res.noop) {
        emitToast("info", "Без изменений");
      } else {
        emitToast("success", `Остаток обновлён · ${account.code}`);
      }
      setEditing(false);
      setDraft("");
      setReason("");
    } catch (err) {
      const msg =
        err instanceof SetBalanceError
          ? err.message
          : err?.message || "Не удалось обновить остаток";
      emitToast("error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  const ro = (
    <span className="tabular-nums">
      {fmtNum(displayed)}
      {suffix ? <span className="text-slate-400"> {suffix}</span> : null}
    </span>
  );

  if (!editing) {
    if (!editable) {
      return <span className={className}>{ro}</span>;
    }
    // Триггер в newDim режиме: "+ Контрагент" вместо плашки с числом.
    if (isNewDim) {
      return (
        <button
          type="button"
          onClick={startEdit}
          title={`Добавить ${dimKind === "client" ? "клиента" : "партнёра"} с начальным остатком`}
          className={`${className} inline-flex items-center gap-1 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50/70 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors`}
        >
          <Plus className="w-3 h-3" strokeWidth={2.5} />
          {dimKind === "client" ? "Клиент" : "Партнёр"}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={startEdit}
        title="Кликни чтобы вбить новый остаток"
        className={`${className} inline-flex items-center justify-end gap-1 cursor-pointer rounded px-1.5 py-0.5 -mx-1 bg-amber-50/60 ring-1 ring-amber-200/70 text-amber-900 hover:bg-amber-100 hover:ring-amber-300 transition-colors`}
      >
        {ro}
        <Pencil className="w-3 h-3 text-amber-500 shrink-0" strokeWidth={2.5} />
      </button>
    );
  }

  // Editing — поповер с формой. Останавливаем bubble клика, чтобы не
  // схлопывать родительский раскрытый счёт.
  return (
    <span
      ref={popoverRef}
      className={`${className} inline-block relative`}
      onClick={(e) => e.stopPropagation()}
    >
      {isNewDim ? (
        <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 ring-1 ring-emerald-300">
          <Plus className="w-3 h-3" strokeWidth={2.5} />
          {dimKind === "client" ? "Клиент" : "Партнёр"}
        </span>
      ) : (
        <span className="inline-flex items-center justify-end gap-1 rounded px-1.5 py-0.5 -mx-1 bg-amber-100 ring-1 ring-amber-300">
          <span className="tabular-nums text-amber-900">{fmtNum(displayed)}</span>
          {suffix ? <span className="text-amber-700/70"> {suffix}</span> : null}
          <Pencil className="w-3 h-3 text-amber-600 shrink-0" strokeWidth={2.5} />
        </span>
      )}
      <div
        className={`absolute ${isNewDim ? "left-0" : "right-0"} top-full mt-1 z-50 w-[280px] bg-white rounded-[12px] border border-slate-200 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.25)] p-3 text-left`}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {isNewDim
              ? `Новый ${dimKind === "client" ? "клиент" : "партнёр"}`
              : "Корректировка остатка"}
          </span>
          <button
            type="button"
            onClick={cancel}
            disabled={submitting}
            className="p-0.5 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
            title="Отмена (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {isNewDim && (
          <label className="block mb-2">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
              {dimKind === "client" ? "Клиент *" : "Партнёр *"}
            </span>
            <select
              value={selectedDimId}
              onChange={(e) => setSelectedDimId(e.target.value)}
              disabled={submitting}
              className="w-full text-[12px] px-2 py-1.5 border border-slate-200 rounded-[8px] bg-slate-50 outline-none focus:bg-white focus:border-slate-400"
            >
              <option value="">— выбери —</option>
              {dimOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block mb-2">
          <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
            {isNewDim
              ? `Начальный остаток (${account.currency})`
              : `Новый остаток (${account.currency})`}
          </span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={submitting}
            className="w-full text-right tabular-nums text-[14px] font-semibold px-2 py-1.5 border border-amber-300 rounded-[8px] bg-amber-50 outline-none focus:bg-white focus:ring-2 focus:ring-amber-200"
          />
        </label>

        <label className="block mb-2">
          <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
            Комментарий *
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="напр. инвентаризация 14.05"
            disabled={submitting}
            className="w-full text-[12px] px-2 py-1.5 border border-slate-200 rounded-[8px] bg-slate-50 outline-none focus:bg-white focus:border-slate-400"
          />
        </label>

        <label className="block mb-2">
          <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
            Дата эффекта
          </span>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            disabled={submitting}
            className="w-full text-[12px] tabular-nums px-2 py-1.5 border border-slate-200 rounded-[8px] bg-slate-50 outline-none focus:bg-white focus:border-slate-400"
          />
        </label>

        <div className="text-[10.5px] text-slate-400 mb-2 leading-snug">
          Корр-счёт: Opening Equity {account.currency}. Δ = новый − старый.
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={cancel}
            disabled={submitting}
            className="px-2.5 py-1 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={submitting}
            className="px-3 py-1 rounded-[8px] text-[12px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Сохранить
          </button>
        </div>
      </div>
    </span>
  );
}
