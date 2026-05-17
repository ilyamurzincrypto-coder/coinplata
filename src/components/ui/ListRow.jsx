// src/components/ui/ListRow.jsx
//
// Строка списка для балансов, сделок, обязательств. Hairline-разделитель
// сверху между строками (первая без), hover-fill surface-soft. Адаптивно
// принимает любую сетку через `cols` (CSS grid-template-columns).
//
// Пример:
//   <ListRow cols="40px 1fr auto auto" onClick={...}>
//     <CurrencyIcon ccy="USDT" />
//     <div>USDT · TRC20</div>
//     <MoneyDisplay value={204731.14} />
//     <span>+0</span>
//   </ListRow>
import React from "react";

export default function ListRow({
  children,
  cols = "auto 1fr auto",
  onClick = null,
  className = "",
  ...rest
}) {
  const clickable = Boolean(onClick);
  return (
    <div
      {...rest}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={{ display: "grid", gridTemplateColumns: cols }}
      className={`items-center gap-4 px-5 py-4 border-t border-border-soft first:border-0 transition-colors duration-150 ease-apple ${clickable ? "cursor-pointer hover:bg-surface-soft" : ""} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
