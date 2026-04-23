// src/utils/csv.js
// Универсальный CSV-экспорт. Используется TransactionsTable, PnL, Cashflow и IE-tab.

const esc = (v) => {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

// rows: array of plain objects. columns: array of { key, label } или строк —
// если просто строка, key=label.
export function exportCSV({ filename, columns, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const cols = (columns || Object.keys(rows[0])).map((c) =>
    typeof c === "string" ? { key: c, label: c } : c
  );
  const lines = [cols.map((c) => esc(c.label)).join(",")];
  rows.forEach((r) => {
    lines.push(cols.map((c) => esc(r[c.key])).join(","));
  });
  const csv = lines.join("\n");
  // BOM для Excel корректно читал UTF-8.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = filename || `coinplata-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
