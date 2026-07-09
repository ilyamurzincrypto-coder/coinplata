// src/lib/cashdeskSite.js
// Клиент кассы к мосту «касса → сайт (coinpoint)»: привязка офисов, выходной/
// открыть, пуш расписания. Все вызовы — с JWT кассира. Пока рубильник
// CASHDESK_SYNC_TO_SITE на бэке выключен, запись отвечает { dryRun:true } —
// сайт не трогается (предпросмотр), хозяин сначала смотрит и подтверждает.
import { supabase } from "./supabase.js";

async function authHeaders(json = false) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const h = token ? { authorization: `Bearer ${token}` } : {};
  if (json) h["content-type"] = "application/json";
  return h;
}

/** Живой список офисов сайта + флаг включённости записи. { offices, syncEnabled } */
export async function fetchSiteOffices() {
  const r = await fetch("/api/cashdesk/offices", { headers: await authHeaders() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `offices ${r.status}`);
  return { offices: Array.isArray(body.offices) ? body.offices : [], syncEnabled: !!body.syncEnabled };
}

/** Выходной (closed) / снять (open) на конкретную дату. Возвращает ответ моста (вкл. dryRun). */
export async function setSiteOfficeDay({ code, date, status, reason }) {
  const r = await fetch("/api/cashdesk/office-day", {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ code, date, status, reason }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `office-day ${r.status}`);
  return body;
}

/** Пуш недельного расписания офиса сайта. Возвращает ответ моста (вкл. dryRun). */
export async function pushSiteSchedule({ code, workingHours, isActive }) {
  const r = await fetch("/api/cashdesk/office-schedule", {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ code, working_hours: workingHours, is_active: isActive }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `office-schedule ${r.status}`);
  return body;
}

// ISO день (1=Пн..7=Вс) → ключ coinpoint (working_hours: sun..sat).
const ISO_TO_KEY = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun" };

/**
 * Конверсия расписания кассового офиса → формат сайта working_hours
 * ({ sun..sat: {open,close} | null }). Учитывает:
 *   - workingDays (ISO 1-7) — день не в списке → null (закрыт);
 *   - workingHoursByDay[n] === null → закрыт; объект → свои часы;
 *   - иначе общие workingHours.start/end.
 */
export function officeToSiteWorkingHours(office) {
  const days = Array.isArray(office?.workingDays) ? office.workingDays : [];
  const start = office?.workingHours?.start || "09:00";
  const end = office?.workingHours?.end || "18:00";
  const byDay = office?.workingHoursByDay && typeof office.workingHoursByDay === "object"
    ? office.workingHoursByDay
    : {};
  const out = {};
  for (let n = 1; n <= 7; n++) {
    const key = ISO_TO_KEY[n];
    if (!days.includes(n)) { out[key] = null; continue; }
    const ov = byDay[String(n)];
    if (ov === null) { out[key] = null; continue; }
    if (ov && typeof ov === "object" && ov.start && ov.end) { out[key] = { open: ov.start, close: ov.end }; continue; }
    out[key] = { open: start, close: end };
  }
  return out;
}

/** Локальная дата 'YYYY-MM-DD' по TZ офиса (для выходного «сегодня»). */
export function officeLocalToday(office) {
  const tz = office?.timezone || "Europe/Istanbul";
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
