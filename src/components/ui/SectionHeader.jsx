// src/components/ui/SectionHeader.jsx
//
// Заголовок секции — БЕЗ обёртки. На голом фоне. Левая часть = title +
// counter + subtitle, правая = controls.
//
// <SectionHeader title="Счета" count={8} subtitle="Все валюты в офисе"
//                actions={<SegmentedMini items={...} />} />
import React from "react";
import Badge from "./Badge.jsx";

export default function SectionHeader({
  title,
  count = null,
  subtitle = null,
  actions = null,
  eyebrow = null,
  className = "",
}) {
  return (
    <div className={`px-page-x pt-section pb-4 flex items-center justify-between gap-4 ${className}`.trim()}>
      <div className="flex flex-col gap-0.5 min-w-0">
        {eyebrow && (
          <div className="text-micro text-muted uppercase">{eyebrow}</div>
        )}
        <div className="text-h2 text-ink flex items-center gap-2.5">
          <span className="truncate">{title}</span>
          {count != null && <Badge variant="counter">{count}</Badge>}
        </div>
        {subtitle && (
          <div className="text-body-sm text-muted">{subtitle}</div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
