// src/styles/tokens.js
// JS-mirror of tokens.css custom properties.
// Use for inline styles, conditional logic, or where CSS-classes
// inappropriate (e.g. canvas, programmatic color manipulation).
//
// Source of truth — tokens.css. Поддерживай оба файла синхронно;
// при расхождении выигрывает CSS (он влияет на runtime).

export const tokens = {
  color: {
    bg:             "#ffffff",
    text:           "#0f172a",   // slate-900
    textSecondary:  "#334155",   // slate-700
    textMuted:      "#64748b",   // slate-500
    border:         "#e2e8f0",   // slate-200
    borderStrong:   "#cbd5e1",   // slate-300
    accent:         "#4f46e5",   // indigo-600
    success:        "#059669",   // emerald-600
    danger:         "#e11d48",   // rose-600
    warning:        "#d97706",   // amber-600
    brandPrimary:   "#4f46e5",   // = accent (override hook)
    brandPrimaryHover: "#4338ca",// indigo-700
  },
  font: {
    size: {
      heading: "16px",
      value:   "14px",
      number:  "20px",
      label:   "11px",
      hint:    "12px",
    },
    weight: {
      heading: 700,
      value:   500,
      number:  600,
      label:   600,
    },
  },
  tracking: {
    label: "0.08em",
    tight: "-0.01em",
  },
  radius: {
    cell:    6,
    section: 10,
  },
  space: {
    1: 4,
    2: 8,
    4: 16,
    6: 24,
  },
  layout: {
    legRowHeight:    52,
    footerBarHeight: 64,
    titleBarHeight:  56,
    ratesPanelWidth: 240,
  },
};

export default tokens;
