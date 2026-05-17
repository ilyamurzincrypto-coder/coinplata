// src/components/ui/Badge.jsx
//
// Design system Badge / Tag — мелкие индикаторы статуса, сетей, тегов.
//
// variant:
//   status   — с дотом, h-6, для status (Завершено, Открыта)
//   tag      — h-4 mono uppercase, для технических меток (TRC20, CASH)
//   highlight — h-4 emerald tint, для highlight (ALL OFFICES)
//   counter  — обычный rounded-md, для счётчиков (5, 12)
//
// tone (для status и counter): success | danger | warning | info | muted
import React from "react";

const TONE = {
  success: { bg: "bg-success-soft", text: "text-success" },
  danger:  { bg: "bg-danger-soft",  text: "text-danger"  },
  warning: { bg: "bg-warning-soft", text: "text-warning" },
  info:    { bg: "bg-info-soft",    text: "text-info"    },
  muted:   { bg: "bg-surface-sunk", text: "text-muted"   },
};

export default function Badge({
  children,
  variant = "status",
  tone = "success",
  showDot = true,
  className = "",
  ...rest
}) {
  const t = TONE[tone] || TONE.success;

  if (variant === "tag") {
    return (
      <span
        {...rest}
        className={`inline-flex items-center h-4 px-1.5 rounded bg-surface-soft text-muted text-[10px] font-bold font-mono tracking-wide ${className}`.trim()}
      >
        {children}
      </span>
    );
  }

  if (variant === "highlight") {
    return (
      <span
        {...rest}
        className={`inline-flex items-center h-4 px-1.5 rounded bg-accent-bg text-success text-[9px] font-bold tracking-wider uppercase ${className}`.trim()}
      >
        {children}
      </span>
    );
  }

  if (variant === "counter") {
    return (
      <span
        {...rest}
        className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular ${className}`.trim()}
      >
        {children}
      </span>
    );
  }

  // status (default)
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-badge text-caption font-medium ${t.bg} ${t.text} ${className}`.trim()}
    >
      {showDot && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
