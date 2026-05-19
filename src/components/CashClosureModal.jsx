// src/components/CashClosureModal.jsx
//
// Закрытие кассы — speed-optimized 3-step UX.
//
// Step 1 — Input:
//   - Popular currencies из office.popular_currencies (default TRY/USD/RUB)
//     отображаются сразу. Каждое поле: actual amount + ghost system value
//     (тап на ghost = скопировать в поле).
//   - «+ Добавить валюту» открывает bottom-sheet с поиском по всем
//     активным валютам.
//   - Auto-focus на первом пустом поле. Tab/Enter — следующее поле.
//
// Step 2 — Summary:
//   - Per-currency: факт / система / разница
//   - Если разница > порога — amber + required комментарий
//   - Кнопка «Закрыть кассу»: hold-to-confirm 800ms (защита от случайного клика)
//
// Step 3 — Success:
//   - 5-минутный countdown «Отменить» → rpcCancelCashClosure
//   - Бухгалтер увидит и подтвердит
//
// Все микрокопирайт — спокойный, поддерживающий тон. Без ❌/⚠️/Critical.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Scale, AlertCircle, CheckCircle2, Calendar, MessageSquare, Plus,
  Search, X, Lock, RotateCcw, ArrowRight, ChevronLeft,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  rpcCreateCashClosure,
  rpcCancelCashClosure,
  withToast,
} from "../lib/supabaseWrite.js";
import { useTranslation } from "../i18n/translations.jsx";

// ─── Constants ─────────────────────────────────────────────────────────

const DEFAULT_POPULAR = ["TRY", "USD", "RUB"];
const DEVIATION_PCT = 0.01;       // 1% — порог amber
const DEVIATION_MIN_ABS = 100;    // или абсолютная сумма в minor unit
const UNDO_WINDOW_SEC = 300;      // 5 минут
const HOLD_DURATION_MS = 800;     // hold-to-confirm

const numberOrZero = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// ─── Main component ────────────────────────────────────────────────────

export default function CashClosureModal({ open, currentOffice, onClose, onCreated }) {
  const { t } = useTranslation();
  const { accounts, balanceOf } = useAccounts();
  const { offices } = useOffices();
  const { currentUser } = useAuth();
  const { codes: allCurrencyCodes } = useCurrencies();
  const officeId = typeof currentOffice === "string" ? currentOffice : currentOffice?.id;
  const office = offices.find((o) => o.id === officeId);
  const popularCurrencies = office?.popularCurrencies || DEFAULT_POPULAR;

  const [step, setStep] = useState("input"); // input | summary | success
  const [closureDate, setClosureDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [comment, setComment] = useState("");
  // currencies — упорядоченный массив кодов валют, отображаемых в форме.
  // Состоит из popular + добавленных пользователем.
  const [currencies, setCurrencies] = useState([]);
  const [actualMap, setActualMap] = useState({});  // { currency: amountStr }
  const [noteMap, setNoteMap] = useState({});       // { currency: noteStr }
  const [busy, setBusy] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [createdId, setCreatedId] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);

  // System totals per-currency (агрегат по нашим active accounts офиса)
  const systemByCurrency = useMemo(() => {
    const m = new Map();
    accounts
      .filter((a) => a.active && a.officeId === officeId)
      .forEach((a) => {
        m.set(a.currency, (m.get(a.currency) || 0) + (balanceOf(a.id) || 0));
      });
    return m;
  }, [accounts, officeId, balanceOf]);

  // Set of available currency codes (filter for picker)
  const allCurrencySet = useMemo(() => new Set(allCurrencyCodes || []), [allCurrencyCodes]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("input");
      setClosureDate(new Date().toISOString().slice(0, 10));
      setComment("");
      // Стартовый набор валют: popular + те, где есть ненулевой системный баланс
      const set = new Set(popularCurrencies);
      systemByCurrency.forEach((v, k) => {
        if (Math.abs(v) > 0.00000001) set.add(k);
      });
      setCurrencies([...set]);
      setActualMap({});
      setNoteMap({});
      setBusy(false);
      setShowCurrencyPicker(false);
      setCreatedId(null);
      setCreatedAt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ─── Auto-focus refs ────────────────────────────────────────────
  const inputRefs = useRef({});
  const continueRef = useRef(null);
  useEffect(() => {
    if (step === "input" && currencies.length > 0) {
      // Фокус на первое пустое поле
      const firstEmpty = currencies.find((c) => !actualMap[c]);
      if (firstEmpty && inputRefs.current[firstEmpty]) {
        inputRefs.current[firstEmpty].focus();
      } else if (currencies[0] && inputRefs.current[currencies[0]]) {
        inputRefs.current[currencies[0]].focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ─── Per-currency rows (computed) ────────────────────────────────
  const rows = useMemo(() => {
    return currencies.map((cur) => {
      const systemTotal = systemByCurrency.get(cur) || 0;
      const actualStr = actualMap[cur];
      const hasInput = actualStr !== undefined && actualStr !== "" && actualStr !== "-";
      const actual = hasInput ? numberOrZero(actualStr) : null;
      const diff = actual != null ? actual - systemTotal : 0;
      const absDiff = Math.abs(diff);
      const threshold = Math.max(Math.abs(systemTotal) * DEVIATION_PCT, DEVIATION_MIN_ABS);
      const deviation = absDiff > threshold;
      return { currency: cur, systemTotal, actual, hasInput, diff, deviation };
    });
  }, [currencies, systemByCurrency, actualMap]);

  const allFilled = rows.every((r) => r.hasInput);
  const anyEmpty = rows.some((r) => !r.hasInput);
  const allZero = rows.every((r) => r.actual === 0);
  const hasDeviationWithoutComment = rows.some(
    (r) => r.deviation && (!noteMap[r.currency] || !noteMap[r.currency].trim())
  );

  // ─── Step 1 → Step 2 ────────────────────────────────────────────
  const goToSummary = () => {
    if (anyEmpty) {
      // soft validation — фокус на первое пустое
      const empty = rows.find((r) => !r.hasInput);
      if (empty && inputRefs.current[empty.currency]) {
        inputRefs.current[empty.currency].focus();
        inputRefs.current[empty.currency].select();
      }
      return;
    }
    setStep("summary");
  };

  // ─── Step 2 — submit ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (busy || !isSupabaseConfigured) return;
    if (hasDeviationWithoutComment) return;

    setBusy(true);
    try {
      const details = rows.map((r) => ({
        currency: r.currency,
        systemTotal: r.systemTotal,
        actualTotal: r.actual,
        note: noteMap[r.currency] || null,
      }));
      const res = await withToast(
        () => rpcCreateCashClosure({
          officeId,
          closureDate,
          details,
          comment,
        }),
        { success: "Касса закрыта", errorPrefix: "Не отправилось" }
      );
      if (res.ok) {
        setCreatedId(res.result);
        setCreatedAt(Date.now());
        onCreated?.(res.result);
        setStep("success");
      }
    } finally {
      setBusy(false);
    }
  };

  // ─── Currency picker handlers ────────────────────────────────────
  const addCurrency = (code) => {
    if (!currencies.includes(code)) {
      setCurrencies((arr) => [...arr, code]);
      // фокус на новое поле через requestAnimationFrame (после рендера)
      requestAnimationFrame(() => {
        const el = inputRefs.current[code];
        if (el) el.focus();
      });
    }
    setShowCurrencyPicker(false);
  };
  const removeCurrency = (code) => {
    if (popularCurrencies.includes(code)) return; // popular нельзя удалить
    setCurrencies((arr) => arr.filter((c) => c !== code));
    setActualMap((m) => {
      const next = { ...m };
      delete next[code];
      return next;
    });
    setNoteMap((m) => {
      const next = { ...m };
      delete next[code];
      return next;
    });
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={step === "success" ? onClose : (busy ? undefined : onClose)}
      title={
        step === "input"   ? t("cc_step_input") :
        step === "summary" ? t("cc_step_summary") :
        t("cc_step_success")
      }
      subtitle={
        step === "input" ? `${officeName(officeId) || "—"} · ${formatDateRu(closureDate)}` :
        step === "summary" ? t("cc_modal_title") :
        ""
      }
      width="2xl"
    >
      {step === "input" && (
        <InputStep
          office={office}
          currentUser={currentUser}
          rows={rows}
          actualMap={actualMap} setActualMap={setActualMap}
          inputRefs={inputRefs}
          continueRef={continueRef}
          popularCurrencies={popularCurrencies}
          onAddCurrency={() => setShowCurrencyPicker(true)}
          onRemoveCurrency={removeCurrency}
          comment={comment} setComment={setComment}
          closureDate={closureDate} setClosureDate={setClosureDate}
          onContinue={goToSummary}
          allFilled={allFilled}
          allZero={allZero}
        />
      )}

      {step === "summary" && (
        <SummaryStep
          rows={rows}
          noteMap={noteMap} setNoteMap={setNoteMap}
          comment={comment}
          closureDate={closureDate}
          office={office}
          currentUser={currentUser}
          onBack={() => setStep("input")}
          onConfirm={handleSubmit}
          hasDeviationWithoutComment={hasDeviationWithoutComment}
          busy={busy}
        />
      )}

      {step === "success" && (
        <SuccessStep
          createdId={createdId}
          createdAt={createdAt}
          onUndo={async () => {
            await withToast(() => rpcCancelCashClosure(createdId), {
              success: "Закрытие отменено — можешь закрыть заново",
              errorPrefix: "Не удалось отменить",
            });
            onClose?.();
          }}
          onClose={onClose}
        />
      )}

      <CurrencyPickerSheet
        open={showCurrencyPicker}
        onClose={() => setShowCurrencyPicker(false)}
        allCodes={[...allCurrencySet]}
        excluded={currencies}
        onPick={addCurrency}
      />
    </Modal>
  );
}

// ─── Office banner ─────────────────────────────────────────────────────
//
// Жирный блок-плашка сверху модалки. Чтобы менеджер не закрыл не ту кассу.
// Office не редактируется здесь — берётся из навбара (currentOffice prop).

function OfficeBanner({ office, currentUser, closureDate, variant = "input" }) {
  const officeNm = office?.name || "—";
  const managerNm = currentUser?.full_name || currentUser?.email || "—";
  return (
    <div className="rounded-card border-2 border-indigo-300 bg-accent-bg px-4 py-3">
      <div className="text-tiny font-bold uppercase tracking-wider text-accent mb-0.5">
        🔒 {variant === "summary" ? "Закрываем кассу" : "Закрытие кассы"}
      </div>
      <div className="text-[18px] font-extrabold text-indigo-900 tracking-tight leading-tight">
        {officeNm}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-tiny text-indigo-800/80">
        <span>
          <span className="opacity-60">Менеджер:</span>{" "}
          <span className="font-bold">{managerNm}</span>
        </span>
        <span>
          <span className="opacity-60">Дата:</span>{" "}
          <span className="font-bold">{formatDateRu(closureDate)}</span>
        </span>
      </div>
    </div>
  );
}

// ─── Step 1: Input ──────────────────────────────────────────────────────

function InputStep({
  office, currentUser,
  rows, actualMap, setActualMap, inputRefs, continueRef,
  popularCurrencies, onAddCurrency, onRemoveCurrency,
  comment, setComment, closureDate, setClosureDate,
  onContinue, allFilled, allZero,
}) {
  const handleKey = (e, idx) => {
    if (e.key === "Enter" || e.key === "Tab") {
      const next = rows[idx + 1];
      if (next && inputRefs.current[next.currency]) {
        e.preventDefault();
        inputRefs.current[next.currency].focus();
        inputRefs.current[next.currency].select();
      } else if (continueRef.current) {
        e.preventDefault();
        continueRef.current.focus();
      }
    }
  };

  return (
    <>
      <div className="p-5 space-y-3">
        {/* Office banner — prominent, отделяет какую кассу закрываем */}
        <OfficeBanner office={office} currentUser={currentUser} closureDate={closureDate} />

        {/* Date */}
        <div>
          <label className="block text-tiny font-bold text-muted uppercase tracking-wider mb-1">
            <Calendar className="w-3 h-3 inline mr-1" />
            Дата закрытия
          </label>
          <input
            type="date"
            value={closureDate}
            onChange={(e) => setClosureDate(e.target.value)}
            className="bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2 text-body-sm outline-none"
          />
        </div>

        {/* Currency rows */}
        <div className="space-y-2">
          {rows.map((r, idx) => (
            <CurrencyInputRow
              key={r.currency}
              row={r}
              value={actualMap[r.currency] ?? ""}
              onChange={(val) => setActualMap((m) => ({ ...m, [r.currency]: val }))}
              onCopySystem={() => setActualMap((m) => ({
                ...m,
                [r.currency]: String(r.systemTotal),
              }))}
              onKeyDown={(e) => handleKey(e, idx)}
              inputRef={(el) => { inputRefs.current[r.currency] = el; }}
              canRemove={!popularCurrencies.includes(r.currency)}
              onRemove={() => onRemoveCurrency(r.currency)}
            />
          ))}
        </div>

        {/* Add currency */}
        <button
          type="button"
          onClick={onAddCurrency}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-card border-2 border-dashed border-border text-ink-soft text-caption font-semibold hover:border-accent/40 hover:bg-surface-soft transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Добавить валюту
        </button>

        {/* Comment */}
        <div>
          <label className="block text-tiny font-bold text-muted uppercase tracking-wider mb-1">
            <MessageSquare className="w-3 h-3 inline mr-1" />
            Комментарий (опционально)
          </label>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: смена Мурата"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-card px-3 py-2 text-body-sm outline-none"
          />
        </div>

        {/* Soft warnings */}
        {allFilled && allZero && (
          <div className="rounded-card border border-warning/20 bg-warning-soft p-3 text-caption text-warning flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Все нули — точно всё пусто?
          </div>
        )}
      </div>

      <div className="px-5 py-3.5 border-t border-border-soft sticky bottom-0 bg-white flex items-center justify-end gap-2">
        <button
          ref={continueRef}
          onClick={onContinue}
          disabled={!allFilled}
          className={`px-5 py-2.5 rounded-card text-body-sm font-bold transition-colors inline-flex items-center gap-1.5 ${
            allFilled
              ? "bg-ink text-white hover:bg-ink"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
          title={!allFilled ? "Заполни все поля (можно 0)" : ""}
        >
          Продолжить
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
}

function CurrencyInputRow({ row, value, onChange, onCopySystem, onKeyDown, inputRef, canRemove, onRemove }) {
  const sym = curSymbol(row.currency);
  const showDeviation = row.hasInput && row.deviation;
  return (
    <div className={`rounded-card border-2 p-3 transition-colors ${
      showDeviation ? "border-warning/20 bg-warning-soft/40" : "border-border-soft bg-white focus-within:border-accent/40"
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-caption font-bold text-ink">{row.currency}</span>
          <span className="text-[18px] font-semibold text-muted-soft">{sym}</span>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-0.5 rounded text-muted-soft hover:text-danger hover:bg-danger-soft transition-colors"
            title="Убрать валюту"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,\-]/g, "").replace(",", "."))}
        onKeyDown={onKeyDown}
        placeholder="0"
        className="w-full bg-transparent outline-none text-ink placeholder:text-muted-soft tabular-nums text-[24px] font-bold tracking-tight"
      />
      <button
        type="button"
        onClick={onCopySystem}
        className="text-tiny text-muted hover:text-ink underline-offset-2 hover:underline tabular-nums mt-0.5 transition-colors"
        title="Скопировать системный остаток в поле"
      >
        Система: {sym}{fmt(row.systemTotal, row.currency)}
        {showDeviation && (
          <span className="ml-1.5 font-bold text-warning">
            · разница {row.diff > 0 ? "+" : ""}{fmt(row.diff, row.currency)}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── Step 2: Summary ───────────────────────────────────────────────────

function SummaryStep({
  rows, noteMap, setNoteMap, comment, closureDate, office, currentUser,
  onBack, onConfirm, hasDeviationWithoutComment, busy,
}) {
  const canConfirm = !hasDeviationWithoutComment && !busy;

  return (
    <>
      <div className="p-5 space-y-3">
        {/* Office banner — то же что в InputStep, но текст «Closing cash for ...» */}
        <OfficeBanner
          office={office}
          currentUser={currentUser}
          closureDate={closureDate}
          variant="summary"
        />
        {comment && (
          <div className="rounded-card bg-surface-soft border border-border-soft px-3 py-2 text-caption text-ink-soft italic">
            «{comment}»
          </div>
        )}

        {/* Per-row breakdown */}
        <div className="space-y-2">
          {rows.map((r) => {
            const sym = curSymbol(r.currency);
            const note = noteMap[r.currency] || "";
            const noteOk = !r.deviation || note.trim().length > 0;
            return (
              <div
                key={r.currency}
                className={`rounded-card border-2 p-3 ${
                  r.deviation
                    ? noteOk
                      ? "border-warning/20 bg-warning-soft/40"
                      : "border-warning/30 bg-warning-soft"
                    : "border-border-soft bg-white"
                }`}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-body-sm font-bold text-ink">{r.currency}</span>
                  {!r.deviation && r.hasInput && (
                    <span className="inline-flex items-center gap-0.5 text-tiny font-bold text-success">
                      <CheckCircle2 className="w-3 h-3" />
                      Сходится
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mb-1">
                  <SummaryCell label="Факт" value={`${sym}${fmt(r.actual, r.currency)}`} bold />
                  <SummaryCell label="Система" value={`${sym}${fmt(r.systemTotal, r.currency)}`} muted />
                  <SummaryCell
                    label="Разница"
                    value={`${r.diff > 0 ? "+" : ""}${sym}${fmt(r.diff, r.currency)}`}
                    tone={r.deviation ? "amber" : r.diff === 0 ? "muted" : "subtle"}
                    bold
                  />
                </div>
                {r.deviation && (
                  <div className="mt-2">
                    <label className="block text-tiny font-bold text-warning mb-1">
                      Разница больше обычного — опиши, что произошло
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNoteMap((m) => ({ ...m, [r.currency]: e.target.value }))}
                      placeholder="Например: клиент забрал ещё 100 USD без сделки"
                      className="w-full bg-white border border-warning/30 focus:border-amber-500 focus:ring-2 focus:ring-amber-300/30 rounded-button px-2.5 py-1.5 text-caption outline-none"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hasDeviationWithoutComment && (
          <div className="rounded-card bg-warning-soft border border-warning/20 px-3 py-2 text-caption text-warning">
            Прежде чем закрыть — заполни комментарии к расхождениям выше.
          </div>
        )}
      </div>

      <div className="px-5 py-3.5 border-t border-border-soft sticky bottom-0 bg-white flex items-center justify-between gap-2">
        <button
          onClick={onBack}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk disabled:opacity-60"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Назад
        </button>
        <HoldToConfirmButton
          onConfirm={onConfirm}
          disabled={!canConfirm}
          busy={busy}
          label="Закрыть кассу"
        />
      </div>
    </>
  );
}

function SummaryCell({ label, value, bold, muted, tone }) {
  const valueCls = tone === "amber"
    ? "text-warning"
    : tone === "subtle"
      ? "text-ink-soft"
      : muted
        ? "text-muted"
        : "text-ink";
  return (
    <div>
      <div className="text-micro font-bold text-muted tracking-wider uppercase mb-0.5">{label}</div>
      <div className={`text-body-sm tabular-nums ${bold ? "font-bold" : "font-semibold"} ${valueCls}`}>
        {value}
      </div>
    </div>
  );
}

// ─── Hold-to-confirm button ─────────────────────────────────────────────

function HoldToConfirmButton({ onConfirm, disabled, busy, label }) {
  const [progress, setProgress] = useState(0); // 0..1
  const startedAt = useRef(null);
  const rafRef = useRef(null);
  const triggeredRef = useRef(false);

  const tick = () => {
    if (startedAt.current == null) return;
    const elapsed = Date.now() - startedAt.current;
    const p = Math.min(1, elapsed / HOLD_DURATION_MS);
    setProgress(p);
    if (p >= 1 && !triggeredRef.current) {
      triggeredRef.current = true;
      onConfirm?.();
      stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };
  const start = () => {
    if (disabled || busy || triggeredRef.current) return;
    triggeredRef.current = false;
    startedAt.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startedAt.current = null;
    if (!triggeredRef.current) setProgress(0);
  };

  useEffect(() => () => stop(), []);

  // Reset triggered flag if disabled toggles back
  useEffect(() => {
    if (!busy) triggeredRef.current = false;
  }, [busy]);

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      onTouchCancel={stop}
      className={`relative overflow-hidden inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-card text-body-sm font-bold transition-colors min-w-[180px] select-none ${
        disabled || busy
          ? "bg-surface-sunk text-muted-soft cursor-not-allowed"
          : "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800"
      }`}
    >
      {/* Progress fill */}
      {!disabled && !busy && progress > 0 && (
        <div
          className="absolute inset-0 bg-emerald-800/40 origin-left transition-none"
          style={{ transform: `scaleX(${progress})` }}
        />
      )}
      <Lock className="w-3.5 h-3.5 relative z-10" />
      <span className="relative z-10">
        {busy ? "Закрываем…" : progress > 0 ? "Удерживай…" : label}
      </span>
    </button>
  );
}

// ─── Step 3: Success with undo countdown ────────────────────────────────

function SuccessStep({ createdId, createdAt, onUndo, onClose }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const elapsed = createdAt ? Math.floor((now - createdAt) / 1000) : 0;
  const remaining = Math.max(0, UNDO_WINDOW_SEC - elapsed);
  const canUndo = remaining > 0;

  const mm = String(Math.floor(remaining / 60)).padStart(1, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="p-8 text-center space-y-5">
      <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
        <CheckCircle2 className="w-8 h-8 text-success" strokeWidth={2.5} />
      </div>
      <div>
        <div className="text-[18px] font-bold text-ink">Касса закрыта</div>
        <div className="text-caption text-muted mt-1">
          Бухгалтер увидит и подтвердит
        </div>
      </div>

      {canUndo ? (
        <button
          onClick={onUndo}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-card border-2 border-border-soft text-ink-soft text-caption font-bold hover:border-accent/40 hover:bg-surface-soft transition-colors tabular-nums"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Отменить ({mm}:{ss})
        </button>
      ) : (
        <div className="text-caption text-muted-soft">
          Время на отмену истекло. Если есть ошибка — попроси бухгалтера отклонить.
        </div>
      )}

      <button
        onClick={onClose}
        className="px-4 py-2 rounded-card bg-ink text-white text-caption font-semibold hover:bg-ink"
      >
        Готово
      </button>
    </div>
  );
}

// ─── Currency picker bottom sheet ───────────────────────────────────────

function CurrencyPickerSheet({ open, onClose, allCodes, excluded, onPick }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allCodes
      .filter((c) => !excluded.includes(c))
      .filter((c) => !q || c.toLowerCase().includes(q))
      .sort();
  }, [allCodes, excluded, query]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-[16px] shadow-2xl w-full max-w-md max-h-[60vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-soft flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-soft" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="EUR, GBP, USDT…"
            className="flex-1 bg-transparent outline-none text-body text-ink placeholder:text-muted-soft tabular-nums tracking-wider font-mono"
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-soft hover:bg-surface-sunk hover:text-ink-soft"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-caption text-muted-soft">
              {query ? `Ничего не нашлось по «${query}»` : "Все валюты уже добавлены"}
            </div>
          ) : (
            <div className="py-1">
              {filtered.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => onPick(code)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-surface-soft transition-colors"
                >
                  <span className="text-body font-bold text-muted-soft w-12">{curSymbol(code)}</span>
                  <span className="text-body-sm font-bold text-ink tracking-wider">{code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

function formatDateRu(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}
