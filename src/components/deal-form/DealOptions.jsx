// src/components/deal-form/DealOptions.jsx
//
// Pills-чекбоксы для опций сделки. Каждая опция — кнопка-pill с круглым
// чекбоксом слева. Активная — bg-accent-bg border-accent text-success.
//
// • Реферал (auto, если у клиента tag="referral")
// • Без мин. комиссии (применять/не min cap офиса) — это инверсия applyMinFee
// • Отложенная выдача (deferredOut) — дублирует timing="us_later"

import React from "react";
import { Check } from "lucide-react";

function OptionPill({ active, onClick, children, autoLabel = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 h-8 pl-1 pr-3 rounded-pill border transition-colors ${
        active
          ? "bg-accent-bg border-accent text-success"
          : "bg-surface border-border text-ink-soft hover:bg-surface-soft"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
          active ? "bg-accent text-white" : "bg-surface-sunk"
        }`}
      >
        {active && <Check className="w-3 h-3" strokeWidth={3} />}
      </span>
      <span className="text-caption font-semibold">{children}</span>
      {autoLabel && (
        <span className="text-micro uppercase tracking-wider font-bold text-success bg-accent-soft px-1 py-px rounded">
          авто
        </span>
      )}
    </button>
  );
}

export default function DealOptions({
  referral,
  onReferralChange,
  referralAuto = false,
  applyMinFee,
  onApplyMinFeeChange,
  deferredOut,
  onDeferredOutChange,
}) {
  return (
    <div className="px-6 py-3 border-b border-border-soft">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-micro text-muted uppercase mr-1">Опции</span>
        <OptionPill
          active={referral}
          onClick={() => onReferralChange(!referral)}
          autoLabel={referralAuto && referral}
        >
          Реферал
        </OptionPill>
        <OptionPill
          active={!applyMinFee}
          onClick={() => onApplyMinFeeChange(!(!applyMinFee))}
        >
          Без мин. комиссии
        </OptionPill>
        <OptionPill
          active={deferredOut}
          onClick={() => onDeferredOutChange(!deferredOut)}
        >
          Отложенная выдача
        </OptionPill>
      </div>
    </div>
  );
}
