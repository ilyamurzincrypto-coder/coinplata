// src/components/ui/PageHeader.jsx
//
// Stripe-style page header — БЕЗ обёртки в карточку. На голом фоне.
// Breadcrumb + h1 + actions справа.
//
// <PageHeader
//   breadcrumb={["Касса", "Terra City"]}
//   title="Балансы"
//   actions={<><Button>Обновить</Button><Button variant="primary">…</Button></>}
// />
import React from "react";

export default function PageHeader({
  breadcrumb = null,
  title,
  subtitle = null,
  actions = null,
  className = "",
}) {
  return (
    <div className={`px-page-x pt-section pb-6 flex items-end justify-between gap-6 ${className}`.trim()}>
      <div className="flex flex-col gap-2.5 min-w-0">
        {Array.isArray(breadcrumb) && breadcrumb.length > 0 && (
          <div className="text-caption text-muted font-medium flex items-center gap-1.5">
            {breadcrumb.map((seg, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="opacity-40">/</span>}
                <span>{seg}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        <h1 className="text-h1 text-ink truncate">{title}</h1>
        {subtitle && <div className="text-body-sm text-muted">{subtitle}</div>}
      </div>
      {actions && (
        <div className="flex items-center gap-2.5 shrink-0">{actions}</div>
      )}
    </div>
  );
}
