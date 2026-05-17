// src/components/ui/Card.jsx
//
// Design system Card — основной контейнер. БЕЗ border, БЕЗ shadow в покое.
// Hover-shadow опционально (только для кликабельных).
//
// variant:
//   default — обычная карточка (rounded-card, p-card)
//   hero    — главные/login блоки (rounded-card-lg, p-card-lg)
//   bare    — голый surface без padding (для списков с собственным spacing)
//
// Правило: оборачиваем в Card только если блок логически «коробка с
// однородным содержимым» (список, форма, виджет). Page headers, stat-
// полосы, заголовки секций — НЕ оборачивать.
import React from "react";

const VARIANT = {
  default: "rounded-card p-card",
  hero:    "rounded-card-lg p-card-lg",
  bare:    "rounded-card overflow-hidden",
};

export default function Card({
  children,
  className = "",
  variant = "default",
  hoverable = false,
  as: Tag = "div",
  ...rest
}) {
  const variantCls = VARIANT[variant] || VARIANT.default;
  const hoverCls = hoverable
    ? "transition-shadow duration-200 ease-apple hover:shadow-card-hover cursor-pointer"
    : "";
  return (
    <Tag
      {...rest}
      className={`bg-surface ${variantCls} ${hoverCls} ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}
