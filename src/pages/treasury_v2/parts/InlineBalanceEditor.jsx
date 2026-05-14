// Inline-редактирование итогового остатка счёта прямо в Казначействе
// (AssetsTab leaf / AccountRow для Equity & Liabilities). Клик по балансу →
// маленький input с текущим значением → Enter/Blur коммитит проводку
// против Opening Equity {currency}. Esc — отмена.
//
// Если у юзера нет accounting:edit — рендерится как обычная текстовая
// надпись (без рамки/курсора), визуально неотличимая от старого read-only
// варианта. Сервер ledger.create_manual_entry тоже требует owner/accountant.
import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useCan } from "../../../store/permissions.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { setAccountBalance, SetBalanceError } from "../../../lib/treasury/setAccountBalance.js";

// Форматирует число для отображения как "1 234.56" (фикс 2 знака, локаль).
function fmtNum(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Парсим ввод (поддерживаем запятую, минус, пробелы как разделители тысяч).
function parseInput(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/\s+/g, "").replace(",", ".");
  if (s === "" || s === "-" || s === ".") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export default function InlineBalanceEditor({
  account, // { code, currency, type, subtype, balance, ... }
  displayMul = 1, // +1 asset / -1 liability
  accounts, // ctx.accounts (chart of accounts) — нужно чтобы найти 3100
  className = "",
  // suffix: что показать после числа в read-only режиме (например "USD")
  suffix = "",
  // Субконто-измерение: если редактируем баланс конкретного клиента/партнёра
  // на dimensioned счёте, передаём сюда. target-линия получит этот dim,
  // а Opening Equity (counter) — нет.
  clientId = null,
  partnerId = null,
  // Кастомный баланс для отображения/расчёта дельты (вместо account.balance).
  // Нужен для субконто-строк: parent account.balance — это сумма по всем
  // клиентам, а нам нужен баланс именно этого dim.
  balanceOverride = null,
}) {
  const can = useCan();
  const canEdit = can("accounting", "edit");
  const rawBalance =
    balanceOverride != null ? Number(balanceOverride) : Number(account?.balance || 0);
  const displayed = rawBalance * displayMul;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Editing запрещаем для Opening Equity 3100 — корр счёт совпадает.
  const isOpeningEquity =
    account?.type === "equity" && (account?.subtype || "") === "opening_balance";
  const editable = canEdit && !isOpeningEquity;

  function startEdit(e) {
    e?.stopPropagation();
    if (!editable || submitting) return;
    setDraft(displayed.toFixed(2));
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft("");
  }

  async function commit() {
    const parsed = parseInput(draft);
    if (!Number.isFinite(parsed)) {
      emitToast("error", "Введи число");
      return;
    }
    try {
      setSubmitting(true);
      const res = await setAccountBalance({
        target: {
          code: account.code,
          currency: account.currency,
          type: account.type,
          subtype: account.subtype,
        },
        oldDisplayed: displayed,
        newDisplayed: parsed,
        displayMul,
        accounts,
        clientId,
        partnerId,
      });
      if (res.noop) {
        emitToast("info", "Без изменений");
      } else {
        emitToast("success", `Остаток обновлён · ${account.code}`);
      }
      setEditing(false);
      setDraft("");
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
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  if (!editing) {
    const ro = (
      <span className="tabular-nums">
        {fmtNum(displayed)}
        {suffix ? <span className="text-slate-400"> {suffix}</span> : null}
      </span>
    );
    if (!editable) {
      return <span className={className}>{ro}</span>;
    }
    return (
      <button
        type="button"
        onClick={startEdit}
        title={isOpeningEquity ? undefined : "Кликни чтобы вбить новый остаток"}
        className={`${className} cursor-text rounded px-1 -mx-1 hover:bg-amber-50 hover:ring-1 hover:ring-amber-200 transition-colors`}
      >
        {ro}
      </button>
    );
  }

  return (
    <span
      className={`${className} inline-flex items-center justify-end gap-1`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Если ничего не ввели или фокус ушёл — фиксируем; если значение
          // не парсится, выводим тост через commit()
          if (!submitting) commit();
        }}
        disabled={submitting}
        className="w-24 text-right tabular-nums text-[12px] px-1.5 py-0.5 border border-amber-400 rounded bg-white outline-none focus:ring-2 focus:ring-amber-200"
      />
      {suffix ? <span className="text-slate-400 text-[11px]">{suffix}</span> : null}
      {submitting && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
    </span>
  );
}
