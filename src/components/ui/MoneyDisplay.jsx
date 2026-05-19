// src/components/ui/MoneyDisplay.jsx
//
// Display для денежных сумм. Всегда font-mono + tabular-nums. Колонки
// сумм в списках выравниваются по правому краю.
//
// size:
//   xs  — text-body-sm (внутри tooltip'ов, мелкие подписи)
//   sm  — text-body
//   md  — text-h3 (строки балансов) — default
//   lg  — text-display (стат-блок, total в карточке)
//   xl  — text-display-lg (hero)
//   xxl — text-display-xl (login hero, max emphasis)
//
// dim:    приглушает дробную часть (.32 → text-muted-soft)
// ccy:    суффикс — мелкий, text-muted-soft (через 30-40% размера)
// align:  left | right (default right для табличных колонок)
import React from "react";

const SIZE = {
  xs:  "text-body-sm",
  sm:  "text-body",
  md:  "text-h3",
  lg:  "text-display",
  xl:  "text-display-lg",
  xxl: "text-display-xl",
};

const CCY_SIZE = {
  xs:  "text-tiny",
  sm:  "text-caption",
  md:  "text-caption",
  lg:  "text-body-sm",
  xl:  "text-body",
  xxl: "text-h2",
};

const WEIGHT = {
  xs:  "font-semibold",
  sm:  "font-semibold",
  md:  "font-bold",
  lg:  "font-bold",
  xl:  "font-bold",
  xxl: "font-bold",
};

// Разбиваем «12,458.32» → integer «12,458», fraction «.32»
function splitNumber(value) {
  if (value == null) return { int: "—", frac: "" };
  const str = typeof value === "number"
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value);
  const dotIdx = str.lastIndexOf(".");
  if (dotIdx === -1) return { int: str, frac: "" };
  return { int: str.slice(0, dotIdx), frac: str.slice(dotIdx) };
}

export default function MoneyDisplay({
  value,
  ccy,
  size = "md",
  dim = false,
  tone = "ink",  // ink | success | danger | muted
  align = "right",
  className = "",
}) {
  const sizeCls = SIZE[size] || SIZE.md;
  const ccyCls = CCY_SIZE[size] || CCY_SIZE.md;
  const wCls = WEIGHT[size] || WEIGHT.md;
  const toneCls =
    tone === "success" ? "text-success"
    : tone === "danger" ? "text-danger"
    : tone === "muted"  ? "text-muted"
    : "text-ink";
  const alignCls = align === "left" ? "text-left" : "text-right";

  const { int, frac } = splitNumber(value);

  return (
    <span className={`font-mono tabular ${sizeCls} ${wCls} ${toneCls} ${alignCls} ${className}`.trim()}>
      {int}
      {frac && (
        <span className={dim ? "text-muted-soft" : ""}>{frac}</span>
      )}
      {ccy && (
        <span className={`${ccyCls} ml-1 font-semibold text-muted-soft`}>{ccy}</span>
      )}
    </span>
  );
}
