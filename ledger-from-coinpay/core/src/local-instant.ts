/**
 * Поле `datetime-local` ↔ АБСОЛЮТНЫЙ момент. Чистые функции: ни DOM, ни БД, ни часов машины.
 *
 * 🔴 Боевой случай 16.09.2026. Оператор в 19:47 по Москве завёл тариф «с 16.09.2026, 19:47».
 * В базу легло `2026-09-16T19:47:00.000Z` — 22:47 по его часам, на три часа позже намеренного:
 * форма отдавала наивную строку `YYYY-MM-DDTHH:mm` без пояса, а сервер (на Vercel это UTC)
 * читал её `new Date(...)` СВОИМИ часами. Правило уехало в будущее, карточка показывала прежнюю
 * ставку, и это выглядело как «сохранение не сработало».
 *
 * Правило класса: наивная строка не пересекает границу «браузер → сервер». Часовой пояс знает
 * только браузер оператора — там и переводим в момент, а на проводе всегда явное смещение
 * (`2026-09-16T19:47:00+03:00`). Сервер наивную строку ОТКЛОНЯЕТ, а не додумывает: молчаливая
 * догадка о поясе и есть тот баг, которому нельзя дать повториться.
 *
 * ⚠️ Знак смещения. Здесь `offsetMinutes` — минуты, которые надо ПРИБАВИТЬ к UTC, чтобы получить
 * местное время (Москва = +180), как в ISO-строке «+03:00». У встроенного
 * `Date.prototype.getTimezoneOffset()` знак ОБРАТНЫЙ (для Москвы он вернёт −180), поэтому
 * браузерные обёртки берут его со знаком минус. Перепутанный знак ошибается ровно на два пояса —
 * то есть «почти правильно», что хуже явной поломки.
 */

export interface LocalParts {
  year: number;
  /** 1–12, как у человека, а не как у `Date`. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Реальные пояса лежат в ±14:00 — всё, что вне, считаем мусором. */
export const MAX_OFFSET_MINUTES = 14 * 60;

const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
/** Момент с ЯВНЫМ поясом: «…Z» либо «…+03:00». Наивная строка сюда не подходит — так и задумано. */
const ABSOLUTE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function pad2(v: number): string {
  return String(v).padStart(2, '0');
}

/** Значение поля `datetime-local` → части стенных часов. null — пусто, не тот формат или дата, которой нет. */
export function parseLocalDateTimeInput(value: string): LocalParts | null {
  const m = LOCAL_INPUT_RE.exec(value.trim());
  if (!m) return null;
  const parts: LocalParts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
  if (parts.hour > 23 || parts.minute > 59) return null;
  // «31 февраля» браузер не даст, но значение приходит и программно — проверяем, что дата реальна.
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    probe.getUTCFullYear() !== parts.year ||
    probe.getUTCMonth() !== parts.month - 1 ||
    probe.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return parts;
}

/** Стенные часы + пояс → эпоха (мс). Единственное место, где живёт эта арифметика. */
export function localPartsToEpochMs(parts: LocalParts, offsetMinutes: number): number {
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - offsetMinutes * 60_000
  );
}

/** «+03:00» / «-05:30» / «+00:00». Пояс на проводе пишем всегда явно, даже нулевой. */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * Значение поля + пояс оператора → строка для сервера: `2026-09-16T19:47:00+03:00`.
 * Стенные часы оператора остаются читаемыми (это важно для аудита), а пояс делает момент
 * однозначным. null — значение поля битое или смещение невозможное.
 */
export function localInputToIso(value: string, offsetMinutes: number): string | null {
  const p = parseLocalDateTimeInput(value);
  if (!p) return null;
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) return null;
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00${formatOffset(offsetMinutes)}`;
}

export interface AbsoluteInstant {
  date: Date;
  /** Пояс, в котором оператор набирал время: минуты к UTC. «Z» → 0. */
  offsetMinutes: number;
}

/**
 * Строка с проводов → момент и пояс оператора. **Наивная строка (без пояса) → null**: сервер
 * обязан отказать, а не подставить свои часы. Отсюда же берётся пояс для правила «задним числом
 * нельзя»: сутки у оператора свои.
 */
export function parseAbsoluteInstant(value: string): AbsoluteInstant | null {
  const trimmed = value.trim();
  const m = ABSOLUTE_RE.exec(trimmed);
  if (!m) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;

  const zone = m[7]!;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
    if (Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) return null;
  }
  return { date, offsetMinutes };
}

/** Полночь СУТОК ОПЕРАТОРА (его часы) как абсолютный момент. */
export function localDayStart(instant: Date, offsetMinutes: number): Date {
  const local = new Date(instant.getTime() + offsetMinutes * 60_000);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(startLocal - offsetMinutes * 60_000);
}

/** Момент → значение для `datetime-local` в заданном поясе. */
export function toLocalInput(instant: Date, offsetMinutes: number): string {
  const local = new Date(instant.getTime() + offsetMinutes * 60_000);
  return (
    `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}` +
    `T${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`
  );
}

/** Подпись пояса для подсказки под полем: «МСК», иначе «UTC+3» / «UTC−5:30». */
export function zoneLabel(timeZone: string, offsetMinutes: number): string {
  if (timeZone === 'Europe/Moscow') return 'МСК';
  const sign = offsetMinutes < 0 ? '−' : '+'; // типографский минус, а не дефис
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${pad2(m)}`;
}

// ── Деловые часы платформы ───────────────────────────────────────────────────────────────────
/**
 * 🔴 Рабочий пояс платформы — московский (Турция живёт в том же, см. `moscowDate`). Витрина
 * рисует время по нему, и ПРАВИЛА СЧИТАЮТСЯ ПО НЕМУ ЖЕ.
 *
 * Почему правило не может опираться на пояс из запроса: смещение приходит с клиента, и заявить
 * можно любое в пределах ±14:00. Граница «задним числом нельзя», построенная на нём, сдвигается
 * почти на сутки назад по желанию отправителя — и тариф датируется прошлым. Денег это не двигает
 * (момент активации всё равно сдвигается вперёд, а списание считается по «сейчас»), но карточка
 * операции печатает «заявленную ставку» ИСТОРИЧЕСКИ — то есть задним числом можно переписать то,
 * что рассказывает о себе уже проведённая операция, на единственном экране, который и заведён,
 * чтобы такое расхождение показывать. Поэтому пояс клиента используется ТОЛЬКО для разбора
 * стенных часов, а граница суток — всегда деловая.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Moscow';

/** Смещение произвольного пояса (минуты к UTC) на конкретный момент — с учётом перехода на лето. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const got: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') got[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(got.year!, got.month! - 1, got.day!, got.hour!, got.minute!, got.second!);
  // Миллисекунды срезаем: смещения поясов кратны минуте, и остаток дал бы «сдвиг» на пустом месте.
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Смещение деловых часов на этот момент. */
export function businessOffsetMinutes(at: Date = new Date()): number {
  return zoneOffsetMinutes(BUSINESS_TIME_ZONE, at);
}

/** Полночь ДЕЛОВЫХ суток, в которые попадает `at`. Граница всех правил «с даты». */
export function businessDayStart(at: Date = new Date()): Date {
  return localDayStart(at, businessOffsetMinutes(at));
}

/**
 * Значение поля `type="date"` («2026-09-20») → полночь этого дня по ДЕЛОВЫМ часам.
 *
 * Без нормализации такая дата уходит в базу UTC-полуночью и на витрине с деловым поясом читается
 * как «20 сент., 03:00» — время, которого никто не задавал. null — значение не дата.
 */
export function businessDayStartFromDateInput(value: string): Date | null {
  const parts = parseLocalDateTimeInput(`${value.trim()}T00:00`);
  if (!parts) return null;
  // Смещение берём на сам этот день, а не на «сейчас».
  const offset = zoneOffsetMinutes(
    BUSINESS_TIME_ZONE,
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
  );
  return new Date(localPartsToEpochMs(parts, offset));
}
