// src/components/ui/Input.jsx
//
// Design system Input — утоплен в покое (bg-surface-sunk без видимой
// границы), всплывает на focus (фон становится белым, emerald ring + glow).
//
// Можно использовать как `<Input value="..." onChange={...} />` или
// прокидывать любые input-атрибуты (type, placeholder, etc.).
import React, { forwardRef } from "react";

const SIZE = {
  sm: "h-8 px-3 text-body-sm",
  md: "h-10 px-3.5 text-body",
  lg: "h-11 px-4 text-body",
};

const Input = forwardRef(function Input(
  { className = "", size = "md", invalid = false, ...rest },
  ref
) {
  const sizeCls = SIZE[size] || SIZE.md;
  const invalidCls = invalid
    ? "ring-1 ring-inset ring-danger focus:ring-danger focus:shadow-[0_0_0_3px_rgba(240,68,82,0.12)]"
    : "ring-1 ring-inset ring-transparent focus:ring-accent focus:shadow-input-focus";
  return (
    <input
      ref={ref}
      {...rest}
      className={`w-full rounded-input bg-surface-sunk text-ink placeholder:text-muted-soft border-0 focus:bg-surface focus:outline-none transition-all duration-150 ease-apple ${sizeCls} ${invalidCls} ${className}`.trim()}
    />
  );
});

export default Input;
