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
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  // Позиция popover'a через portal: считаем от триггера.
  const triggerRef = useRef(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0, side: "below" });
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

  // Пересчёт позиции popover'a при открытии и на scroll/resize.
  useLayoutEffect(() => {
    if (!editing || !triggerRef.current) return undefined;
    const recompute = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const POP_WIDTH = 280;
      const POP_HEIGHT_MIN = 240; // достаточно для базового набора полей
      const margin = 8;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      // Стандартно — под триггером, выравнивание по правому краю.
      let top = rect.bottom + 4;
      let left = rect.right - POP_WIDTH;
      let side = "below";
      // Если не влезает снизу — кидаем сверху.
      if (top + POP_HEIGHT_MIN > viewportH - margin) {
        const altTop = rect.top - POP_HEIGHT_MIN - 4;
        if (altTop > margin) {
          top = altTop;
          side = "above";
        }
      }
      // Удерживаем popover в viewport по горизонтали.
      if (left < margin) left = margin;
      if (left + POP_WIDTH > viewportW - margin) {
        left = viewportW - POP_WIDTH - margin;
      }
      setPopPos({ top, left, side });
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [editing]);

  // Close on outside click (учитываем и popover в portal, и trigger).
  useEffect(() => {
    if (!editing) return undefined;
    const onClick = (e) => {
      const inPop = popoverRef.current && popoverRef.current.contains(e.target);
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target);
      if (!inPop && !inTrigger) {
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
    <span className="font-mono tabular whitespace-nowrap">
      {fmtNum(displayed)}
      {suffix ? <span className="text-muted-soft"> {suffix}</span> : null}
    </span>
  );

  if (!editable) {
    return <span className={className}>{ro}</span>;
  }

  // Триггер всегда виден; popover в portal'е (чтобы не клипать overflow-hidden
  // родителями). При editing меняем visual триггера на "активный".
  const triggerEl = isNewDim ? (
    <button
      type="button"
      ref={triggerRef}
      onClick={startEdit}
      title={`Добавить ${dimKind === "client" ? "клиента" : "партнёра"} с начальным остатком`}
      className={`${className} inline-flex items-center gap-1 cursor-pointer rounded-badge px-2 py-1 text-tiny font-semibold transition-colors ${
        editing
          ? "text-success bg-success-soft ring-1 ring-success/30"
          : "text-success bg-accent-bg ring-1 ring-accent/20 hover:bg-success-soft"
      }`}
    >
      <Plus className="w-3 h-3" strokeWidth={2.5} />
      {dimKind === "client" ? "Клиент" : "Партнёр"}
    </button>
  ) : (
    <button
      type="button"
      ref={triggerRef}
      onClick={startEdit}
      title="Кликни чтобы вбить новый остаток"
      className={`${className} inline-flex items-center justify-end gap-1 cursor-pointer rounded-badge px-1.5 py-0.5 -mx-1 transition-colors ${
        editing
          ? "bg-warning-soft ring-1 ring-warning/40 text-warning"
          : "bg-warning-soft/60 ring-1 ring-warning/20 text-warning hover:bg-warning-soft"
      }`}
    >
      {ro}
      <Pencil className="w-3 h-3 text-warning shrink-0" strokeWidth={2.5} />
    </button>
  );

  if (!editing) {
    return triggerEl;
  }

  // Editing — popover через portal в body, position: fixed.
  const popover = (
    <div
      ref={popoverRef}
      style={{ position: "fixed", top: popPos.top, left: popPos.left, width: 280 }}
      className="z-[1000]"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="bg-surface rounded-card-lg border border-border shadow-modal p-3 text-left">
        <div className="flex items-center justify-between mb-2">
          <span className="text-micro text-muted uppercase">
            {isNewDim
              ? `Новый ${dimKind === "client" ? "клиент" : "партнёр"}`
              : "Корректировка остатка"}
          </span>
          <button
            type="button"
            onClick={cancel}
            disabled={submitting}
            className="p-0.5 rounded-badge text-muted hover:text-ink hover:bg-surface-soft transition-colors"
            title="Отмена (Esc)"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>

        {isNewDim && (
          <label className="block mb-2">
            <span className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">
              {dimKind === "client" ? "Клиент *" : "Партнёр *"}
            </span>
            <select
              value={selectedDimId}
              onChange={(e) => setSelectedDimId(e.target.value)}
              disabled={submitting}
              className="w-full h-9 text-caption px-2 rounded-input bg-surface-sunk text-ink border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:shadow-input-focus focus:outline-none transition-all"
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
          <span className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">
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
            className="w-full h-9 text-right font-mono tabular text-body font-semibold px-2 rounded-input bg-warning-soft text-warning ring-1 ring-inset ring-warning/30 focus:bg-surface focus:ring-warning focus:shadow-[0_0_0_3px_rgba(180,83,9,0.12)] focus:outline-none transition-all"
          />
        </label>

        <label className="block mb-2">
          <span className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">
            Комментарий *
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="напр. инвентаризация 14.05"
            disabled={submitting}
            className="w-full h-9 text-caption px-2 rounded-input bg-surface-sunk text-ink placeholder:text-muted-soft border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:shadow-input-focus focus:outline-none transition-all"
          />
        </label>

        <label className="block mb-2">
          <span className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">
            Дата эффекта
          </span>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            disabled={submitting}
            className="w-full h-9 text-caption font-mono tabular px-2 rounded-input bg-surface-sunk text-ink border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:shadow-input-focus focus:outline-none transition-all"
          />
        </label>

        <div className="text-tiny text-muted-soft mb-2 leading-snug">
          Корр-счёт: Opening Equity {account.currency}. Δ = новый − старый.
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={cancel}
            disabled={submitting}
            className="h-8 px-2.5 rounded-button text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-soft disabled:opacity-50 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={submitting}
            className="h-8 px-3 rounded-button text-caption font-semibold bg-ink text-white hover:bg-black shadow-cta-glow disabled:opacity-60 inline-flex items-center gap-1.5 transition-all"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {triggerEl}
      {typeof document !== "undefined" ? createPortal(popover, document.body) : null}
    </>
  );
}
