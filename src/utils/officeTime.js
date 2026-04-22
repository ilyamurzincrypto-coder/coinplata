// src/utils/officeTime.js
// Хелперы для вычисления "operational state" офиса:
//   — сегодня рабочий день?
//   — текущее время внутри working hours?
//
// Все расчёты — в timezone офиса (Intl.DateTimeFormat). Если timezone отсутствует,
// используется локальный браузерный.

// ISO day of week в указанном timezone. Monday=1..Sunday=7.
function isoDayInTimezone(now, timezone) {
  try {
    // en-GB даёт "Mon, Tue, …" — парсим через формат
    const weekday = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
    }).format(now);
    const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return map[weekday] || null;
  } catch {
    const d = now.getDay(); // 0=Sun..6=Sat
    return d === 0 ? 7 : d;
  }
}

// Возвращает {hours, minutes} для now в timezone.
function hoursMinutesInTimezone(now, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hh = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const mm = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    return { hours: hh, minutes: mm };
  } catch {
    return { hours: now.getHours(), minutes: now.getMinutes() };
  }
}

// Парсит "HH:MM" в минуты от полуночи. Некорректные строки → null.
function parseClockString(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (isNaN(hh) || isNaN(mm)) return null;
  return hh * 60 + mm;
}

// Состояние офисных часов. Возвращает один из:
//   "off"           — сегодня не рабочий день
//   "before_start"  — рабочий день, но ещё не открылись
//   "open"          — в пределах working hours
//   "after_end"     — рабочий день уже закончился
//   "unknown"       — данных о часах работы нет (не ломаем UX)
export function getOfficeClockState(office, now = new Date()) {
  if (!office) return "unknown";
  const tz = office.timezone;
  const days = office.workingDays;
  const hours = office.workingHours;
  if (!Array.isArray(days) || !hours?.start || !hours?.end) return "unknown";

  const day = isoDayInTimezone(now, tz);
  if (!day || !days.includes(day)) return "off";

  const startMin = parseClockString(hours.start);
  const endMin = parseClockString(hours.end);
  if (startMin == null || endMin == null) return "unknown";

  const { hours: h, minutes: m } = hoursMinutesInTimezone(now, tz);
  const cur = h * 60 + m;

  if (cur < startMin) return "before_start";
  if (cur >= endMin) return "after_end";
  return "open";
}

// true, если офис СЕЙЧАС работает (in working hours, on working day).
// Используется для баннера подтверждения курсов.
export function isOfficeWorkingNow(office, now = new Date()) {
  return getOfficeClockState(office, now) === "open";
}

// Alias для совместимости с ранее добавленным кодом. Семантически эквивалентно
// isOfficeWorkingNow — баннер показываем только когда офис работает сейчас.
export function shouldOfficeHaveRatesConfirmed(office, now = new Date()) {
  return isOfficeWorkingNow(office, now);
}

// Для UI — человекочитаемая формулировка состояния.
export function formatClockState(state) {
  switch (state) {
    case "off": return "Office is closed today";
    case "before_start": return "Not yet open";
    case "open": return "Open";
    case "after_end": return "Closed for today";
    default: return "";
  }
}
