// src/components/cashier/LegRow.jsx
// Одна строка leg, 52px фиксированная высота.
// Колонки (left → right):
//   [Side pill] [Currency] [Amount] [Rate (OUT)] [Source/Dest] [Account] [⌫]
// Для crypto OUT — AddressInline под строкой через chevron.

import React, { forwardRef, useMemo } from "react";
import { Trash2 } from "lucide-react";
import LegSidePill from "./LegSidePill.jsx";
import CurrencyPicker from "./CurrencyPicker.jsx";
import CurrencyTextInput from "./CurrencyTextInput.jsx";
import AccountInlineSelect from "./AccountInlineSelect.jsx";
import RateCell from "./RateCell.jsx";
import AddressInline from "./AddressInline.jsx";
import { useCurrencies } from "../../store/currencies.jsx";

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
  },
  _ref
) {
  const isIn = leg.side === "in";
  const isOut = leg.side === "out";
  const { dict } = useCurrencies();
  const isCrypto = useMemo(
    () => dict[leg.currency]?.type === "crypto",
    [dict, leg.currency]
  );

  // ── Source/destination dropdown ──
  const sourceOrDest = isIn ? (
    <select
      value={leg.source || "fresh"}
      onChange={(e) => onUpdate(leg.id, { source: e.target.value })}
      ref={setCellRef ? (el) => setCellRef(rowIndex, 4, el) : undefined}
      onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 4)}
      aria-label="Источник средств"
      className="bg-transparent border-0 outline-none text-[12px] text-slate-600 focus:bg-white focus:ring-1 focus:ring-slate-300 rounded-[var(--radius-cell)] px-2 py-1.5 cursor-pointer w-full"
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
      className="bg-transparent border-0 outline-none text-[12px] text-slate-600 focus:bg-white focus:ring-1 focus:ring-slate-300 rounded-[var(--radius-cell)] px-2 py-1.5 cursor-pointer w-full"
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

  return (
    <div
      className="grid items-center px-3 border-b border-slate-100 hover:bg-slate-50/40"
      style={{
        height: "var(--leg-row-height)",
        gridTemplateColumns: "70px 90px 1fr 110px 120px 1.4fr 32px",
        gap: "8px",
      }}
    >
      {/* Side */}
      <div>
        <LegSidePill side={leg.side} onToggle={() => onToggleSide(leg.id)} />
      </div>

      {/* Currency */}
      <div ref={setCellRef ? (el) => setCellRef(rowIndex, 1, el) : undefined}>
        <CurrencyPicker
          value={leg.currency}
          onChange={(v) => onUpdate(leg.id, { currency: v })}
          ariaLabel="Валюта"
          onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 1)}
        />
      </div>

      {/* Amount */}
      <div>
        <CurrencyTextInput
          value={leg.amount}
          onChange={(v) => onUpdate(leg.id, { amount: v })}
          currencyCode={leg.currency}
          ariaLabel="Сумма"
          inputRef={setCellRef ? (el) => setCellRef(rowIndex, 2, el) : undefined}
          onKeyDown={(e) => onCellKeyDown?.(e, rowIndex, 2)}
        />
      </div>

      {/* Rate — only OUT */}
      <div>
        {isOut ? (
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
        ) : (
          <span className="text-[12px] text-slate-300 px-2">—</span>
        )}
      </div>

      {/* Source / Destination */}
      <div>{sourceOrDest}</div>

      {/* Account */}
      <div>
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
          <span className="text-[12px] text-slate-400 px-2">
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
            className="text-slate-300 hover:text-rose-600 p-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Crypto OUT — address row inline */}
      {isOut && isCrypto && (
        <div className="col-span-7 -mt-2 mb-1 ml-[78px]">
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

export default LegRow;
