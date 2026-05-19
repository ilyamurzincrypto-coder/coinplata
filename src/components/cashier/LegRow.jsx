// src/components/cashier/LegRow.jsx
// Одна строка leg, 52px фиксированная высота (расширяется до 64px при
// показе bottom-row badges/warnings).
//
// Колонки (left → right):
//   [Side pill] [Currency] [Amount] [Rate (OUT)] [Source/Dest] [Account] [⌫]
//
// Под каждой ячейкой Amount/Account → BalanceBadge с context'ом
// (баланс клиента в этой валюте / баланс счёта).
// При overdraft → red border + красный badge.
// Spread indicator справа от RateCell для OUT legs.

import React, { forwardRef, useMemo } from "react";
import { Trash2, AlertCircle } from "lucide-react";
import LegSidePill from "./LegSidePill.jsx";
import CurrencyPicker from "./CurrencyPicker.jsx";
import CurrencyTextInput from "./CurrencyTextInput.jsx";
import AccountInlineSelect from "./AccountInlineSelect.jsx";
import RateCell from "./RateCell.jsx";
import AddressInline from "./AddressInline.jsx";
import BalanceBadge from "./BalanceBadge.jsx";
import SpreadIndicator from "./SpreadIndicator.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useAccounts } from "../../store/accounts.jsx";

const SOURCE_OPTIONS_IN = [
  { value: "fresh", label: "fresh" },
  { value: "from_balance", label: "from balance" },
];
const DEST_OPTIONS_OUT = [
  { value: "physical", label: "physical" },
  { value: "to_balance", label: "to balance" },
];

const LegRow = forwardRef(function LegRow(
  {
    leg,
    onUpdate,
    onRemove,
    onToggleSide,
    onCellKeyDown,
    setCellRef,
    rowIndex,
    officeId,
    marketRate,
    canRemove = true,
    clientBalanceInCurrency,  // number | null — баланс клиента в leg.currency (we_owe = positive)
    errors = [],              // Error[] from validateTx for this leg
  },
  _ref
) {
  const isIn = leg.side === "in";
  const isOut = leg.side === "out";
  const { dict } = useCurrencies();
  const { balanceOf } = useAccounts();
  const isCrypto = useMemo(
    () => dict[leg.currency]?.type === "crypto",
    [dict, leg.currency]
  );

  // ── Validation: overdraft / kassa empty ──
  const amountNum = Number(leg.amount);
  const accountBalance = leg.accountId ? balanceOf(leg.accountId) : null;

  // IN.from_balance + amountNum > clientBalance → overdraft (info, не блок)
  const inOverdraft =
    isIn &&
    leg.source === "from_balance" &&
    Number.isFinite(amountNum) && amountNum > 0 &&
    Number.isFinite(clientBalanceInCurrency) &&
    amountNum > clientBalanceInCurrency;
  const inOverdraftAmount = inOverdraft
    ? amountNum - clientBalanceInCurrency
    : null;

  // OUT.physical + amountNum > accountBalance → kassa empty (info)
  const outShortage =
    isOut &&
    leg.destination === "physical" &&
    accountBalance != null &&
    Number.isFinite(amountNum) && amountNum > 0 &&
    amountNum > accountBalance;
  const outShortageAmount = outShortage
    ? amountNum - accountBalance
    : null;

  // ── Per-field error helpers (from validateTx) ──
  const fieldErr = (field) => errors.find((e) => e.field === field);
  const fieldClass = (base, field) => {
    const err = fieldErr(field);
    return err ? `${base} ring-2 ring-rose-400 border-rose-400` : base;
  };
  const accountErr = fieldErr("accountId");
  const amountErr = fieldErr("amount");
  const currencyErr = fieldErr("currency");
  const deferredErr = fieldErr("deferred");

  // ── Source/destination dropdown ──
  const sourceOrDest = isIn ? (
    <select
      value={leg.source || "fresh"}
      onChange={(e) => onUpdate(leg.id, { source: e.target.value })}
      ref={setCellRef ? (el) => setCellRef(rowIndex, 4, el) : undefined}
      onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 4)}
      aria-label="Источник средств"
      className="bg-transparent border-0 outline-none text-caption text-ink-soft focus:bg-white focus:ring-1 focus:ring-accent/20 rounded-[var(--radius-cell)] px-2 py-1.5 cursor-pointer w-full"
    >
      {SOURCE_OPTIONS_IN.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ) : (
    <select
      value={leg.destination || "physical"}
      onChange={(e) => onUpdate(leg.id, { destination: e.target.value })}
      ref={setCellRef ? (el) => setCellRef(rowIndex, 4, el) : undefined}
      onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 4)}
      aria-label="Назначение"
      title={deferredErr?.message}
      className={
        "bg-transparent border-0 outline-none text-caption text-ink-soft focus:bg-white focus:ring-1 focus:ring-accent/20 rounded-[var(--radius-cell)] px-2 py-1.5 cursor-pointer w-full" +
        (deferredErr ? " ring-2 ring-rose-400" : "")
      }
    >
      {DEST_OPTIONS_OUT.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );

  // Account нужен:
  //   IN.fresh → да; IN.from_balance → нет (на стороне Customer Liab)
  //   OUT.physical → да; OUT.to_balance → нет
  const showAccount =
    (isIn && leg.source === "fresh") ||
    (isOut && leg.destination === "physical");

  const amountBorderClass = amountErr
    ? "ring-2 ring-rose-400 border-rose-400 rounded-[var(--radius-cell)]"
    : (inOverdraft || outShortage)
    ? "ring-1 ring-rose-300 bg-danger-soft/40 rounded-[var(--radius-cell)]"
    : "";

  return (
    <div
      data-leg-id={leg.id}
      data-leg-side={leg.side}
      className="border-b border-border-soft hover:bg-surface-soft/40"
    >
      <div
        className="grid items-center px-3"
        style={{
          height: "var(--leg-row-height)",
          gridTemplateColumns: "70px 90px 1fr 130px 120px 1.4fr 32px",
          gap: "8px",
        }}
      >
        {/* Side */}
        <div>
          <LegSidePill side={leg.side} onToggle={() => onToggleSide(leg.id)} />
        </div>

        {/* Currency */}
        <div
          ref={setCellRef ? (el) => setCellRef(rowIndex, 1, el) : undefined}
          className={currencyErr ? "ring-2 ring-rose-400 rounded-[var(--radius-cell)]" : undefined}
          title={currencyErr?.message}
        >
          <CurrencyPicker
            value={leg.currency}
            onChange={(v) => onUpdate(leg.id, { currency: v })}
            ariaLabel="Валюта"
            onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 1)}
          />
        </div>

        {/* Amount */}
        <div className={amountBorderClass} title={amountErr?.message}>
          <CurrencyTextInput
            value={leg.amount}
            onChange={(v) => onUpdate(leg.id, { amount: v })}
            currencyCode={leg.currency}
            ariaLabel="Сумма"
            inputRef={setCellRef ? (el) => setCellRef(rowIndex, 2, el) : undefined}
            onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 2)}
          />
        </div>

        {/* Rate — only OUT, with spread badge */}
        <div className="flex items-center gap-1">
          {isOut ? (
            <>
              <div className="flex-1">
                <RateCell
                  value={leg.rate}
                  onChange={(v) => onUpdate(leg.id, { rate: v })}
                  onMarkManual={(reset) =>
                    onUpdate(leg.id, { rateManual: reset === false ? false : true })
                  }
                  manual={leg.rateManual}
                  marketRate={marketRate}
                  ariaLabel="Курс"
                  inputRef={setCellRef ? (el) => setCellRef(rowIndex, 3, el) : undefined}
                  onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 3)}
                />
              </div>
              <SpreadIndicator currentRate={leg.rate} marketRate={marketRate} />
            </>
          ) : (
            <span className="text-caption text-muted-soft px-2">—</span>
          )}
        </div>

        {/* Source / Destination */}
        <div>{sourceOrDest}</div>

        {/* Account */}
        <div
          className={accountErr ? "ring-2 ring-rose-400 rounded-[var(--radius-cell)]" : undefined}
          title={accountErr?.message}
        >
          {showAccount ? (
            <AccountInlineSelect
              value={leg.accountId}
              onChange={(v) => onUpdate(leg.id, { accountId: v })}
              currency={leg.currency}
              officeId={officeId}
              ariaLabel="Счёт"
              inputRef={setCellRef ? (el) => setCellRef(rowIndex, 5, el) : undefined}
              onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 5)}
            />
          ) : (
            <span className="text-caption text-muted-soft px-2">
              {isIn ? "— клиент с баланса —" : "— клиенту на баланс —"}
            </span>
          )}
        </div>

        {/* Remove */}
        <div className="flex justify-end">
          {canRemove && (
            <button
              type="button"
              onClick={() => onRemove(leg.id)}
              title="Удалить"
              className="text-muted-soft hover:text-danger p-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom row: balance badges + warnings + crypto address */}
      {(showBottomRow(isIn, leg, isCrypto, inOverdraft, outShortage, accountBalance, clientBalanceInCurrency)) && (
        <div
          className="px-3 pb-1.5 grid items-center"
          style={{
            gridTemplateColumns: "70px 90px 1fr 130px 120px 1.4fr 32px",
            gap: "8px",
          }}
        >
          <div></div>
          <div></div>

          {/* Amount-cell — client balance OR overdraft warning */}
          <div className="flex items-center gap-1.5">
            {isIn && leg.source === "from_balance" && Number.isFinite(clientBalanceInCurrency) && (
              <BalanceBadge
                amount={clientBalanceInCurrency}
                currency={leg.currency}
                label="клиент"
                overdraft={inOverdraft}
                shortage={inOverdraftAmount}
              />
            )}
            {inOverdraft && (
              <span className="inline-flex items-center gap-0.5 text-tiny text-danger font-semibold">
                <AlertCircle className="w-3 h-3" />
                overdraft {inOverdraftAmount?.toFixed(2)} {leg.currency}
              </span>
            )}
          </div>

          <div></div>
          <div></div>

          {/* Account-cell — account balance OR shortage warning */}
          <div className="flex items-center gap-1.5">
            {showAccount && accountBalance != null && (
              <BalanceBadge
                amount={accountBalance}
                currency={leg.currency}
                label="счёт"
                overdraft={outShortage}
                shortage={outShortageAmount}
              />
            )}
            {outShortage && (
              <span className="inline-flex items-center gap-0.5 text-tiny text-danger font-semibold">
                <AlertCircle className="w-3 h-3" />
                нехватка {outShortageAmount?.toFixed(2)} {leg.currency}
              </span>
            )}
          </div>

          <div></div>
        </div>
      )}

      {/* Crypto OUT — address row inline */}
      {isOut && isCrypto && (
        <div className="pl-[78px] pr-3 pb-1.5">
          <AddressInline
            address={leg.address}
            network={leg.network}
            onAddressChange={(v) => onUpdate(leg.id, { address: v })}
            onNetworkChange={(v) => onUpdate(leg.id, { network: v })}
          />
        </div>
      )}
    </div>
  );
});

function showBottomRow(isIn, leg, isCrypto, inOverdraft, outShortage, accountBalance, clientBalance) {
  if (isIn && leg.source === "from_balance" && Number.isFinite(clientBalance)) return true;
  if (inOverdraft || outShortage) return true;
  if (leg.accountId && accountBalance != null) return true;
  return false;
}

export default LegRow;
