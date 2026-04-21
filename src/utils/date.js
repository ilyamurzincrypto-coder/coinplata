// src/utils/date.js
// Хелперы работы с датами. Seed-данные имеют дату как "Apr 20" — эмулируем
// что это сегодня минус небольшой offset, чтобы фильтры date range имели смысл в демо.

// Нормализация tx.date или entry.date в YYYY-MM-DD
// Если приходит уже ISO-подобное — возвращаем как есть.
// Если "Apr 20" — маппим на сегодня (в моке все транзакции "сегодня").
export function toISODate(dateValue) {
  if (!dateValue) return new Date().toISOString().slice(0, 10);
  if (typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }
  // Seed-строки типа "Apr 20" — считаем сегодняшней датой
  return new Date().toISOString().slice(0, 10);
}

export function monthKey(iso) {
  if (!iso) return "";
  return iso.slice(0, 7); // YYYY-MM
}

export function monthLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso + "-01");
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}
