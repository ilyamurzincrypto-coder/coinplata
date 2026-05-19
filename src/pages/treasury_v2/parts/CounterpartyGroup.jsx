// src/pages/treasury_v2/parts/CounterpartyGroup.jsx
//
// Group для одного контрагента в Treasury → Пассивы (counterparty-режим).
// Зеркало строки Office в AssetsTab — те же 3 уровня:
//   Контрагент → Валюта → Source ledger.account.
//
// Цветовая логика балансов идентична AssetsTab + LiabilitiesTab legacy:
//   balance > 0 → мы должны контрагенту → text-success «+» (он держит у нас)
//   balance < 0 → контрагент должен нам → text-danger «−» (overdraft)
// (то же что в LegRow.clientBalanceInCurrency в legacy v2 DealForm)

import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronDown, Star, Check, X as XIcon, Pencil } from "lucide-react";
import { fmt, curSymbol } from "../../../utils/money.js";
import Avatar from "../../../components/ui/Avatar.jsx";
import InlineNameEdit from "../../../components/ui/InlineNameEdit.jsx";
import CounterpartyActionsMenu from "../../../components/ui/CounterpartyActionsMenu.jsx";
import { setAccountBalance, SetBalanceError } from "../../../lib/treasury/setAccountBalance.js";
import { bumpDataVersion } from "../../../lib/dataVersion.jsx";
import { emitToast } from "../../../lib/toast.jsx";

function fmtCompact(value) {
  const v = Math.abs(Number(value) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`.replace(/\.0M$/, "M");
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`.replace(/\.0k$/, "k");
  return `${Math.round(v)}`;
}

export default function CounterpartyGroup({ cp, formatBase, baseCurrency, defaultExpanded = false, onRename, onArchive, onDelete, canEdit = false, accounts = [] }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isCredit = cp.totalInBase > 0;     // мы должны контрагенту
  const isDebit  = cp.totalInBase < 0;     // контрагент должен нам
  const toneCls = isDebit ? "text-danger" : isCredit ? "text-success" : "text-ink";
  const signStr = isDebit ? "−" : isCredit ? "+" : "";

  return (
    <div className="border-t border-border-soft first:border-t-0">
      {/* Level 1 — counterparty header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="w-full grid grid-cols-[16px_32px_1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-surface-soft transition-colors text-left bg-surface-soft/40 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
          : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
        <Avatar name={cp.name} size={28} />
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 truncate">
            {canEdit && onRename ? (
              <InlineNameEdit
                value={cp.name}
                onSave={(next) => onRename(cp, next)}
                className="text-body-sm font-semibold text-ink truncate min-w-0"
                inputClassName="text-body-sm font-semibold"
                placeholder={cp.kind === "client" ? "имя клиента" : "имя партнёра"}
              />
            ) : (
              <span className="text-body-sm font-semibold text-ink truncate">{cp.name}</span>
            )}
            {cp.isReferral && (
              <span className="inline-flex items-center gap-0.5 text-tiny text-warning font-semibold shrink-0">
                <Star className="w-2.5 h-2.5 fill-current" strokeWidth={0} />
                Реферал
              </span>
            )}
            {cp.kind === "partner" && (
              <span className="inline-flex items-center h-4 px-1.5 rounded font-mono text-micro font-bold bg-info-soft text-info uppercase tracking-wider shrink-0">
                OTC
              </span>
            )}
          </div>
          {cp.telegram && (
            <span className="text-tiny text-muted font-mono truncate">{cp.telegram}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="text-right shrink-0 flex flex-col items-end leading-tight">
            <span className={`text-body-sm font-mono tabular font-bold whitespace-nowrap ${toneCls}`}>
              {signStr}{formatBase ? formatBase(Math.abs(cp.totalInBase), baseCurrency) : `$${fmtCompact(cp.totalInBase)}`}
            </span>
            <span className="text-tiny text-muted-soft">
              {cp.byCurrency.length} {cp.byCurrency.length === 1 ? "валюта" : "валют"}
            </span>
          </div>
          {canEdit && (onArchive || onDelete) && (
            <CounterpartyActionsMenu
              kind={cp.kind}
              onArchive={onArchive ? () => onArchive(cp) : undefined}
              onDelete={onDelete ? () => onDelete(cp) : undefined}
            />
          )}
        </div>
      </div>

      {/* Level 2 — currencies */}
      {expanded && cp.byCurrency.map((cur) => (
        <CurrencyRow
          key={cur.currency}
          cur={cur}
          formatBase={formatBase}
          baseCurrency={baseCurrency}
          cp={cp}
          canEdit={canEdit}
          accounts={accounts}
        />
      ))}
    </div>
  );
}

function CurrencyRow({ cur, formatBase, baseCurrency, cp, canEdit, accounts }) {
  const [expanded, setExpanded] = useState(false);
  const isCredit = cur.balance > 0;
  const isDebit  = cur.balance < 0;
  const toneCls = isDebit ? "text-danger" : isCredit ? "text-success" : "text-ink";
  const signStr = isDebit ? "−" : isCredit ? "+" : "";
  const isBase = cur.currency === baseCurrency;
  // Primary target для inline-edit: первый source_account (обычно
  // customer_liab или partner_liab). Если несколько subtype'ов — правка
  // ляжет на этот primary, остальные ноги не трогаем.
  const primarySource = cur.sourceAccounts?.[0] || null;
  const primaryAcc = primarySource
    ? (accounts || []).find((a) => a.id === primarySource.accountId)
    : null;
  const canEditBalance = canEdit && !!primaryAcc;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="w-full grid grid-cols-[16px_1fr_auto] items-center gap-2 pl-12 pr-4 py-2 hover:bg-surface-soft transition-colors text-left border-t border-border-soft cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />}
        <span className="text-caption font-semibold text-ink-soft tracking-wider">
          {cur.currency}
        </span>
        <div className="text-right shrink-0 flex items-baseline gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {canEditBalance ? (
            <CurrencyBalanceEditor
              currency={cur.currency}
              currentBalance={cur.balance}
              displayMul={1}
              toneCls={toneCls}
              signStr={signStr}
              primaryAcc={primaryAcc}
              accounts={accounts}
              clientId={cp?.kind === "client" ? cp.id : null}
              partnerId={cp?.kind === "partner" ? cp.id : null}
            />
          ) : (
            <span className={`text-body-sm font-mono tabular font-semibold ${toneCls}`}>
              {signStr}{curSymbol(cur.currency)}{fmt(Math.abs(cur.balance), cur.currency)}
            </span>
          )}
          {!isBase && formatBase && (
            <span className="text-tiny text-muted-soft font-mono tabular">
              (≈ {formatBase(Math.abs(cur.balanceInBase), baseCurrency)})
            </span>
          )}
        </div>
      </div>

      {/* Level 3 — source ledger accounts */}
      {expanded && cur.sourceAccounts.map((acc, i) => (
        <div
          key={`${acc.accountId}-${i}`}
          className="grid grid-cols-[1fr_auto] items-baseline gap-2 pl-20 pr-4 py-1.5 border-t border-border-soft bg-surface-soft/30"
        >
          <div className="text-tiny text-muted inline-flex items-baseline gap-1.5 truncate">
            <span className="font-mono text-muted-soft">{acc.code}</span>
            <span className="text-muted-soft">·</span>
            <span className="truncate">{acc.name}</span>
          </div>
          <span className={`text-tiny font-mono tabular whitespace-nowrap ${acc.balance < 0 ? "text-danger" : "text-success"}`}>
            {acc.balance < 0 ? "−" : "+"}{curSymbol(cur.currency)}{fmt(Math.abs(acc.balance), cur.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Inline-edit балансa клиента/партнёра в конкретной валюте.
// На submit: setAccountBalance() → ledger.create_manual_entry с парой
// Dr/Cr против Opening Equity {currency}. Правка ложится на primary
// source-account (первый в cur.sourceAccounts[]); прочие subtype-ноги
// (если есть) не трогаются.
function CurrencyBalanceEditor({
  currency,
  currentBalance,
  displayMul,
  toneCls,
  signStr,
  primaryAcc,
  accounts,
  clientId,
  partnerId,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const displayed = Math.abs(currentBalance);

  const startEdit = () => {
    setDraft(displayed.toFixed(2));
    setReason("");
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft("");
    setReason("");
  };

  async function commit(e) {
    e?.stopPropagation();
    const parsed = parseFloat(String(draft).replace(",", "."));
    if (!Number.isFinite(parsed)) {
      emitToast("error", "Введи число");
      return;
    }
    if (!reason.trim()) {
      emitToast("error", "Заполни причину (обязательно)");
      return;
    }
    try {
      setSubmitting(true);
      // currentBalance уже в displayMul-нормали, как displayed signed
      // (для liability cur.balance может быть отрицательным — overdraft).
      // setAccountBalance берёт newDisplayed и сам считает internalDelta.
      const oldSigned = currentBalance;
      const newSigned = parsed * (currentBalance < 0 ? -1 : 1);
      const res = await setAccountBalance({
        target: {
          code: primaryAcc.code,
          currency: primaryAcc.currency,
          type: primaryAcc.type,
          subtype: primaryAcc.subtype,
        },
        oldDisplayed: oldSigned,
        newDisplayed: newSigned,
        displayMul,
        accounts,
        clientId,
        partnerId,
        reason: reason.trim(),
      });
      bumpDataVersion();
      if (res?.noop) emitToast("info", "Без изменений");
      else emitToast("success", `Остаток обновлён · ${currency}`);
      setEditing(false);
      setDraft("");
      setReason("");
    } catch (err) {
      const msg = err instanceof SetBalanceError ? err.message : err?.message || "Не удалось обновить";
      emitToast("error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); startEdit(); }}
        title="Редактировать остаток"
        className={`group/balance inline-flex items-center gap-1 cursor-pointer rounded-badge px-1.5 py-0.5 -mx-1 hover:bg-surface-soft transition-colors ${toneCls}`}
      >
        <span className="text-body-sm font-mono tabular font-semibold whitespace-nowrap">
          {signStr}{curSymbol(currency)}{fmt(displayed, currency)}
        </span>
        <Pencil className="w-3 h-3 text-muted-soft opacity-0 group-hover/balance:opacity-100 transition-opacity shrink-0" strokeWidth={2.2} />
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="inline-flex items-center gap-1">
        <span className="text-tiny text-muted-soft font-mono">{currency}</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) commit(e);
            else if (e.key === "Escape") cancel();
          }}
          disabled={submitting}
          className="w-32 h-7 px-2 text-right rounded-input bg-surface text-ink text-caption font-mono tabular font-semibold border-0 ring-1 ring-inset ring-accent focus:outline-none transition-all"
        />
        <button
          type="button"
          onClick={commit}
          disabled={submitting}
          className="p-0.5 rounded-badge text-success hover:bg-success-soft transition-colors disabled:opacity-40"
          title="Сохранить"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={submitting}
          className="p-0.5 rounded-badge text-muted hover:bg-surface-soft transition-colors disabled:opacity-40"
          title="Отмена (Esc)"
        >
          <XIcon className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit(e);
          else if (e.key === "Escape") cancel();
        }}
        disabled={submitting}
        placeholder="причина *"
        className="w-full h-6 px-1.5 text-right rounded-input bg-surface-sunk text-ink text-tiny border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
      />
    </div>
  );
}
