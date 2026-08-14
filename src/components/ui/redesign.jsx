// src/components/ui/redesign.jsx
// Примитивы редизайна rondesignlab (эталон: design/reference.html).
// Тёплый крем, тонкие крупные цифры (Onest 300), круглые формы, тёмные секции.
// Теней НЕТ — глубину дают крем/белый/тёмный. Все токены — из tailwind.config.
import React from "react";

// ── Pill — таблетка. dark (активная) / line / lime (ок) / warn / ghost / locked.
//    Кликабельна, если передан onClick (рендерит <button>), иначе <span>.
const PILL_VARIANTS = {
  dark: "bg-ink text-cream",
  line: "border border-line-2 text-[#6B675C]",
  lime: "bg-lime text-lime-ink",
  warn: "bg-orange-bg text-orange-ink",
  ghost: "text-muted",
  locked: "bg-line-2 text-[#6B675C]",
};
export function Pill({ variant = "line", className = "", onClick, children, ...rest }) {
  const cls = `inline-flex items-center gap-2 rounded-pill text-[13px] leading-none px-[18px] py-[9px] whitespace-nowrap transition-colors ${PILL_VARIANTS[variant] || PILL_VARIANTS.line} ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}

// ── CircleBtn — круглая кнопка 34px. dark / ring / light. children = иконка.
const CIRCLE_VARIANTS = {
  dark: "bg-ink text-cream",
  ring: "border border-line-2 text-[#6B675C]",
  light: "bg-card text-ink",
};
export function CircleBtn({ variant = "ring", className = "", onClick, children, ...rest }) {
  const cls = `w-[34px] h-[34px] rounded-full inline-flex items-center justify-center shrink-0 transition-colors ${CIRCLE_VARIANTS[variant] || CIRCLE_VARIANTS.ring} ${className}`;
  const Tag = onClick ? "button" : "span";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cls} {...rest}>
      {children}
    </Tag>
  );
}

// ── AlertBadge — оранжевый квадратик «!». Родитель должен быть relative.
export function AlertBadge({ children = "!", className = "" }) {
  return (
    <span
      className={`absolute -top-1.5 -right-1.5 w-[17px] h-[17px] rounded-[6px] bg-orange text-white text-[12px] font-medium flex items-center justify-center ${className}`}
    >
      {children}
    </span>
  );
}

// ── BlockCard — карточка блока. default (крем-белая) / accent (сине-серый
//    градиент) / add (пунктирный пустой слот).
export function BlockCard({ variant = "default", className = "", children, ...rest }) {
  if (variant === "add") {
    return (
      <div
        className={`rounded-card-2 border-[1.5px] border-dashed border-line-2 text-muted text-[13px] flex items-center justify-center gap-2 p-4 ${className}`}
        {...rest}
      >
        {children}
      </div>
    );
  }
  const base = "rounded-card-2 p-[18px] relative";
  const skin =
    variant === "accent"
      ? "bg-accent-block text-blue-ink"
      : "bg-card text-ink";
  return (
    <div className={`${base} ${skin} ${className}`} {...rest}>
      {children}
    </div>
  );
}

// ── DarkSection — тёмная секция (сделки/каналы) с тёплым свечением.
export function DarkSection({ glow = "deals", className = "", children, ...rest }) {
  const g = glow === "hero" ? "bg-hero-glow" : glow === "none" ? "" : "bg-deals-glow";
  return (
    <div className={`rounded-card-2 bg-dark ${g} text-cream p-[22px] ${className}`} {...rest}>
      {children}
    </div>
  );
}

// ── HeroNumber — число-герой. value = строка «14 196,10» (ru). size hero|row.
//    hero: 40px/300 + дробь 21px; row: 24px/300 + дробь 14px.
export function HeroNumber({ value, currency, size = "hero", className = "" }) {
  const s = String(value ?? "");
  const i = s.lastIndexOf(",");
  const int = i < 0 ? s : s.slice(0, i);
  const frac = i < 0 ? "" : s.slice(i);
  const big = size === "hero" ? "text-[40px]" : "text-[24px]";
  const small = size === "hero" ? "text-[21px]" : "text-[14px]";
  return (
    <span className={`font-light leading-none tracking-[-0.01em] tabular-nums ${className}`}>
      <span className={big}>{int}</span>
      {frac && <span className={`${small} text-[#6B675C]`}>{frac}</span>}
      {currency && <span className={`${small} text-[#6B675C] ml-1`}>{currency}</span>}
    </span>
  );
}

// ── BalanceCard — карточка остатка (крем-подложка): валюта · число-герой · подпись.
export function BalanceCard({ currency, value, sub, empty = false, className = "" }) {
  return (
    <div className={`bg-cream rounded-card-sm px-4 py-[14px] ${className}`}>
      <div className="text-[12px] text-muted flex items-center gap-1.5 mb-2.5">
        <i className="w-1.5 h-1.5 rounded-full bg-faint block" />
        {currency}
      </div>
      {empty ? (
        <div className="text-[24px] font-light text-faint leading-none">·</div>
      ) : (
        <HeroNumber value={value} size="row" />
      )}
      {sub && <div className="text-[11px] text-faint mt-1.5">{sub}</div>}
    </div>
  );
}

// ── Chip — чип города (ANT/IST/…). on = активный. Для крем-фона.
export function Chip({ on = false, onClick, className = "", children }) {
  const cls = `text-[12px] px-[15px] py-[7px] rounded-pill border transition-colors ${
    on ? "bg-ink text-cream border-ink" : "border-line-2 text-[#6B675C]"
  } ${className}`;
  const Tag = onClick ? "button" : "span";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cls}>
      {children}
    </Tag>
  );
}
