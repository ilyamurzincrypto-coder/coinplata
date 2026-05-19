// src/components/deal-form/DealAdvanced.jsx
//
// Свёрнутая панель «Дополнительные параметры». Раскрывается по клику.
// Содержит поля для редких сценариев:
//   • Комментарий (free text)
//   • Tx hash (если IN — крипто, хэш транзакции от клиента)
//   • Брокеридж (commissionUsd)
//   • Своя комиссия (customFeeUsd)
//   • Планируемая дата (plannedLocal — datetime-local)
//   • Backdate (backdateAt — date только)

import React, { useState } from "react";
import { Settings, ChevronDown, ChevronUp } from "lucide-react";

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-tiny text-muted font-semibold uppercase tracking-wide">
        {label}
      </span>
      {children}
      {hint && <span className="text-tiny text-muted-soft">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full h-9 px-3 rounded-input bg-surface-sunk text-ink placeholder:text-muted-soft text-body-sm border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:shadow-input-focus focus:outline-none transition-all duration-150 ease-apple";

export default function DealAdvanced({
  comment,
  onCommentChange,
  inTxHash,
  onInTxHashChange,
  commissionUsd,
  onCommissionUsdChange,
  customFeeUsd,
  onCustomFeeUsdChange,
  plannedLocal,
  onPlannedLocalChange,
  backdateAt,
  onBackdateAtChange,
}) {
  const [open, setOpen] = useState(false);

  const hasAnyValue =
    (comment && comment.trim()) ||
    (inTxHash && inTxHash.trim()) ||
    commissionUsd ||
    customFeeUsd ||
    plannedLocal ||
    backdateAt;

  return (
    <div className="px-6 py-2.5 border-b border-border-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full inline-flex items-center justify-between gap-2 py-1.5 text-muted hover:text-ink transition-colors"
      >
        <span className="inline-flex items-center gap-2">
          <Settings className="w-3.5 h-3.5" strokeWidth={2} />
          <span className="text-caption font-semibold">Дополнительные параметры</span>
          {hasAnyValue && !open && (
            <span className="text-micro uppercase tracking-wider font-bold text-success bg-accent-soft px-1.5 py-px rounded">
              заполнено
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5" strokeWidth={2.2} />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" strokeWidth={2.2} />
        )}
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="Комментарий">
            <input
              type="text"
              value={comment || ""}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="Свободный текст"
              className={inputCls}
            />
          </Field>

          <Field label="Tx hash (IN)" hint="хэш транзакции от клиента">
            <input
              type="text"
              value={inTxHash || ""}
              onChange={(e) => onInTxHashChange(e.target.value)}
              placeholder="0x… / TRC20 / ERC20 hash"
              className={`${inputCls} font-mono`}
            />
          </Field>

          <Field label="Брокеридж, $" hint="фикс. сумма комиссии для контрагента">
            <input
              type="text"
              inputMode="decimal"
              value={commissionUsd ?? ""}
              onChange={(e) => onCommissionUsdChange(e.target.value)}
              placeholder="0.00"
              className={`${inputCls} font-mono`}
            />
          </Field>

          <Field label="Своя комиссия, $" hint="override min-fee офиса">
            <input
              type="text"
              inputMode="decimal"
              value={customFeeUsd ?? ""}
              onChange={(e) => onCustomFeeUsdChange(e.target.value)}
              placeholder="0.00"
              className={`${inputCls} font-mono`}
            />
          </Field>

          <Field label="Планируемая дата" hint="когда ожидается следующий шаг">
            <input
              type="datetime-local"
              value={plannedLocal || ""}
              onChange={(e) => onPlannedLocalChange(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Backdate" hint="ретроактивная дата сделки">
            <input
              type="date"
              value={backdateAt || ""}
              onChange={(e) => onBackdateAtChange(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
