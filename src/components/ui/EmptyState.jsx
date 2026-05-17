// src/components/ui/EmptyState.jsx
//
// Эмпти-стейт внутри карточки. Иконка-кружок в кружке + title + subtitle.
//
// <EmptyState icon={CheckCircle} title="Все сделки закрыты"
//             subtitle="Когда появится незавершённая сделка — будет здесь" />
import React from "react";

export default function EmptyState({
  icon: Icon = null,
  title,
  subtitle = null,
  tone = "muted",  // muted | success | warning | danger
  className = "",
  action = null,
}) {
  const toneCls =
    tone === "success" ? "text-success"
    : tone === "warning" ? "text-warning"
    : tone === "danger"  ? "text-danger"
    : "text-muted";
  return (
    <div className={`py-12 px-7 text-center ${className}`.trim()}>
      {Icon && (
        <div className={`inline-flex w-11 h-11 rounded-full bg-surface-sunk items-center justify-center mb-3 ${toneCls}`}>
          <Icon size={20} strokeWidth={2.2} />
        </div>
      )}
      <div className="text-body font-semibold text-ink mb-1">{title}</div>
      {subtitle && (
        <div className="text-body-sm text-muted">{subtitle}</div>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
