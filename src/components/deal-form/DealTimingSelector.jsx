// src/components/deal-form/DealTimingSelector.jsx
//
// Когда исполнить сделку — 4 карточки grid (radio-like).
//   now           — обмен сразу (default)
//   client_later  — ждём оплату от клиента (deferredIn=true)
//   us_later      — мы выдадим позже (deferredOut=true)
//   partial       — частичная оплата (partialMode=true)
//
// На NewDealForm уровне эти 4 опции мапятся в булевы state-поля
// ExchangeForm payload (deferredIn / deferredOut / partialMode).

import React from "react";
import { Check, Clock, ArrowRightToLine, PieChart } from "lucide-react";

const OPTIONS = [
  { id: "now",          title: "Сразу",        subtitle: "обмен прямо сейчас",    icon: Check },
  { id: "client_later", title: "Клиент позже", subtitle: "ждём оплату от клиента", icon: Clock },
  { id: "us_later",     title: "Мы позже",     subtitle: "мы выдадим позже",       icon: ArrowRightToLine },
  { id: "partial",      title: "Частично",     subtitle: "оплата по частям",       icon: PieChart },
];

export default function DealTimingSelector({ value = "now", onChange }) {
  return (
    <div className="px-6 py-4 border-b border-border-soft">
      <div className="text-micro text-muted uppercase mb-2.5">Когда исполнить</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {OPTIONS.map((opt) => {
          const active = value === opt.id;
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`group p-3 rounded-card text-left transition-all duration-150 ease-apple border-[1.5px] ${
                active
                  ? "bg-surface border-ink shadow-soft"
                  : "bg-surface-soft border-transparent hover:bg-surface-sunk"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center mb-2 transition-colors ${
                  active ? "bg-ink text-white" : "bg-surface text-ink-soft"
                }`}
              >
                <Icon className="w-3 h-3" strokeWidth={2.2} />
              </div>
              <div className="text-caption font-semibold text-ink leading-tight">{opt.title}</div>
              <div className="text-tiny text-muted mt-0.5 leading-tight">{opt.subtitle}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
