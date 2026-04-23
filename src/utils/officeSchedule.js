// src/utils/officeSchedule.js
// Frontend-mirror бэкенд-функции public.is_office_open_at.
// Учитывает: status, active, tempClosedUntil, holidays (YYYY-MM-DD),
// workingDays (ISO 1-7), workingHoursByDay (override), workingHours (fallback).

export function dayOfWeekISO(date) {
  // JS Sunday=0..Saturday=6 → ISO Monday=1..Sunday=7
  const js = date.getDay();
  return js === 0 ? 7 : js;
}

export function localDateParts(date, timezone) {
  if (!timezone) {
    return {
      dateStr: date.toISOString().slice(0, 10),
      time: date.toISOString().slice(11, 16),
      dow: dayOfWeekISO(date),
    };
  }
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(date);
    const byType = {};
    parts.forEach((p) => { byType[p.type] = p.value; });
    const dateStr = `${byType.year}-${byType.month}-${byType.day}`;
    const time = `${byType.hour}:${byType.minute}`;
    // weekday → ISO number
    const wkMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const dow = wkMap[byType.weekday] || dayOfWeekISO(date);
    return { dateStr, time, dow };
  } catch {
    return {
      dateStr: date.toISOString().slice(0, 10),
      time: date.toISOString().slice(11, 16),
      dow: dayOfWeekISO(date),
    };
  }
}

// Возвращает object { open: bool, reason?: string } объясняющий решение.
export function getOfficeOpenState(office, now = new Date()) {
  if (!office) return { open: false, reason: "no office" };
  if (office.status === "closed" || office.active === false) {
    return { open: false, reason: "closed" };
  }
  // Временное закрытие
  if (office.tempClosedUntil) {
    const until = new Date(office.tempClosedUntil);
    if (now <= until) {
      return {
        open: false,
        reason: office.tempClosedReason || "temporarily closed",
        until,
      };
    }
  }

  const { dateStr, time, dow } = localDateParts(now, office.timezone);

  if (Array.isArray(office.holidays) && office.holidays.includes(dateStr)) {
    return { open: false, reason: "holiday", dateStr };
  }

  const workingDays = Array.isArray(office.workingDays) && office.workingDays.length > 0
    ? office.workingDays
    : [1, 2, 3, 4, 5];
  if (!workingDays.includes(dow)) {
    return { open: false, reason: "not a working day" };
  }

  let hours = office.workingHours || { start: "09:00", end: "21:00" };
  const perDay = office.workingHoursByDay;
  if (perDay && typeof perDay === "object") {
    const override = perDay[String(dow)] ?? perDay[dow];
    if (override === null) {
      return { open: false, reason: "day explicitly closed" };
    }
    if (override && override.start && override.end) {
      hours = override;
    }
  }

  if (time < hours.start || time >= hours.end) {
    return { open: false, reason: "outside working hours", hours };
  }
  return { open: true, hours };
}

export function isOfficeOpenNow(office) {
  return getOfficeOpenState(office).open;
}
