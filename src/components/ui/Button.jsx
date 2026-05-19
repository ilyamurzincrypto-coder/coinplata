// src/components/ui/Button.jsx
//
// Design system Button.
//
// variant:
//   primary   — anchor CTA emerald + glow (для «Новая сделка», submit'ы)
//   secondary — белая с border (Обновить, Фильтры)
//   ghost     — без фона, hover-fill (Подробнее, Закрыть)
//   link      — emerald текст (для inline-link типа «История →»)
//   danger    — danger-цвет (Удалить, Отменить)
//
// size: sm (h-7, px-2.5) | md (h-9, px-3.5/4) — default | lg (h-11, px-5)
//
// Anchor CTA «Новая сделка» имеет ВСЕГДА primary variant + glow shadow.
// Размер кнопки можно менять под контекст (sm в нав-баре, md в page-
// header, lg в hero-блоке), цвет/glow остаются.
import React from "react";

const VARIANT = {
  primary: "bg-accent hover:bg-accent-hover text-white shadow-cta-glow hover:shadow-cta-glow-hover active:scale-[0.98]",
  secondary: "bg-surface hover:bg-surface-soft text-ink border border-border",
  ghost: "bg-transparent hover:bg-surface-soft text-ink-soft hover:text-ink",
  link: "bg-transparent text-accent hover:text-accent-hover px-0",
  danger: "bg-danger hover:bg-danger/90 text-white shadow-card-hover active:scale-[0.98]",
};

const SIZE = {
  sm: "h-7 px-2.5 text-caption gap-1.5 rounded-button",
  md: "h-9 px-3.5 text-body-sm gap-1.5 rounded-button",
  lg: "h-11 px-5 text-body gap-2 rounded-button",
};

const ICON_SIZE = {
  sm: 13,
  md: 15,
  lg: 17,
};

export default function Button({
  children,
  variant = "secondary",
  size = "md",
  icon: Icon = null,
  iconRight: IconRight = null,
  hotkey = null,    // если задано — рендерим <kbd> справа (для primary)
  type = "button",
  disabled = false,
  className = "",
  ...rest
}) {
  const variantCls = VARIANT[variant] || VARIANT.secondary;
  const sizeCls = SIZE[size] || SIZE.md;
  const iconSz = ICON_SIZE[size] || ICON_SIZE.md;

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-semibold transition-all duration-150 ease-apple disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${variantCls} ${sizeCls} ${className}`.trim()}
    >
      {Icon && <Icon size={iconSz} strokeWidth={2.2} />}
      {children}
      {IconRight && <IconRight size={iconSz} strokeWidth={2.2} />}
      {hotkey && (
        <kbd
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 ml-1 bg-white/20 border border-white/20 rounded text-tiny font-mono font-semibold"
          aria-hidden
        >
          {hotkey}
        </kbd>
      )}
    </button>
  );
}
