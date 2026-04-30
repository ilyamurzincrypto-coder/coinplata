// src/utils/date.js
// Хелперы работы с датами. Seed-данные имеют дату как "Apr 20" — эмулируем
// что это сегодня минус небольшой offset, чтобы фильтры date range имели смысл в демо.

// Нормализация tx.date или entry.date в YYYY-MM-DD
// Если приходит уже ISO-подобное — возвращаем как есть.
// Если "Apr 20" — маппим на сегодня (в моке все транзакции "сегодня").
// Локальная YYYY-MM-DD (без UTC сдвига)
function localYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toISODate(dateValue) {
  if (!dateValue) return localYMD(new Date());
  if (typeof dateValue === "string") {
    // Уже YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
    // ISO timestamp "YYYY-MM-DDT..." — отрезаем дату
    const m = dateValue.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    // Любая парсимая дата (включая "Apr 30 2026")
    const d = new Date(dateValue);
    if (Number.isFinite(d.getTime())) return localYMD(d);
  }
  if (dateValue instanceof Date && Number.isFinite(dateValue.getTime())) {
    return localYMD(dateValue);
  }
  // Fallback — сегодня
  return localYMD(new Date());
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
