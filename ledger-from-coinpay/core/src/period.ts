/**
 * Периоды для финансовых отчётов и списков (F1).
 *
 * Границы — по UTC-суткам (совпадает с lib/data/overview.ts и seed'ом, чтобы
 * все пресеты были демонстрируемы на демо-данных). Таймзона — единственная
 * точка `DAY_MS`/`utcDayStart`; перевод на МСК — локальная правка здесь.
 *
 * Модель в URL шэрабельна: `?period=today|yesterday|7d|month|prevmonth`
 * либо `?from=YYYY-MM-DD&to=YYYY-MM-DD` (произвольный, обе даты включительно).
 *
 * `from` включительно, `to` — ЭКСКЛЮЗИВНАЯ верхняя граница (начало след. суток):
 * в SQL — `createdAt >= from AND createdAt < to`.
 */

export type PeriodPreset = 'today' | 'yesterday' | '7d' | 'month' | 'prevmonth' | 'custom';

export interface ResolvedPeriod {
  preset: PeriodPreset;
  /** Включительно. */
  from: Date;
  /** Эксклюзивно (начало суток за последним днём периода). */
  to: Date;
  /** Человеческий лейбл для пилюли/заголовка. */
  label: string;
}

export interface PeriodParams {
  period?: string;
  from?: string;
  to?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Начало UTC-суток для момента. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «7 июля 2026». date — момент внутри нужных суток (UTC). */
export function formatDayRu(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Лейбл диапазона: один день → одна дата, иначе «c … по …» (to — эксклюзив). */
export function formatRangeRu(from: Date, toExclusive: Date): string {
  const lastDay = new Date(toExclusive.getTime() - DAY_MS);
  if (from.getTime() === lastDay.getTime()) return formatDayRu(from);
  return `${formatDayRu(from)} — ${formatDayRu(lastDay)}`;
}

const PRESET_LABELS: Record<Exclude<PeriodPreset, 'custom'>, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  month: 'Этот месяц',
  prevmonth: 'Прошлый месяц',
};

/** Только пресеты (для рендера списка кнопок). */
export const PERIOD_PRESETS: { value: Exclude<PeriodPreset, 'custom'>; label: string }[] = (
  ['today', 'yesterday', '7d', 'month', 'prevmonth'] as const
).map((value) => ({ value, label: PRESET_LABELS[value] }));

function fromPreset(preset: Exclude<PeriodPreset, 'custom'>, now: Date): { from: Date; to: Date } {
  const todayStart = utcDayStart(now);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  switch (preset) {
    case 'today':
      return { from: todayStart, to: tomorrowStart };
    case 'yesterday':
      return { from: new Date(todayStart.getTime() - DAY_MS), to: todayStart };
    case '7d':
      // 7 календарных суток, включая сегодня.
      return { from: new Date(todayStart.getTime() - 6 * DAY_MS), to: tomorrowStart };
    case 'month':
      return { from: monthStart, to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
    case 'prevmonth':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), to: monthStart };
  }
}

/** YYYY-MM-DD → начало UTC-суток; null если не парсится. */
export function parseIsoDay(s: string | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Отсечь переполнение (напр. 2026-02-31 → март).
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Дата → YYYY-MM-DD (UTC). Для сериализации произвольного периода в URL. */
export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DEFAULT_PRESET: Exclude<PeriodPreset, 'custom'> = 'month';

/**
 * Разбирает searchParams в период. Приоритет: валидный `period`-пресет →
 * валидный произвольный `from`/`to` → дефолт (`defaultPreset`, по умолч. «Этот месяц»).
 * Произвольный: обе даты включительно (to сдвигается на начало след. суток).
 * from > to — меняем местами (терпимость к обратному вводу).
 */
export function resolvePeriod(
  params: PeriodParams,
  opts: { now?: Date; defaultPreset?: Exclude<PeriodPreset, 'custom'> } = {},
): ResolvedPeriod {
  const now = opts.now ?? new Date();
  const preset = params.period;

  if (preset && preset in PRESET_LABELS) {
    const p = preset as Exclude<PeriodPreset, 'custom'>;
    const { from, to } = fromPreset(p, now);
    return { preset: p, from, to, label: PRESET_LABELS[p] };
  }

  if (preset === 'custom' || params.from || params.to) {
    let a = parseIsoDay(params.from);
    let b = parseIsoDay(params.to);
    if (a && b) {
      if (a.getTime() > b.getTime()) [a, b] = [b, a];
      const to = new Date(b.getTime() + DAY_MS); // включительно последний день
      return { preset: 'custom', from: a, to, label: formatRangeRu(a, to) };
    }
    // Неполный/битый произвольный — падаем в дефолт.
  }

  const dp = opts.defaultPreset ?? DEFAULT_PRESET;
  const { from, to } = fromPreset(dp, now);
  return { preset: dp, from, to, label: PRESET_LABELS[dp] };
}

/**
 * Собирает query-строку периода (для ссылок/перехода). Пресет → `period=…`;
 * произвольный → `from=…&to=…`. Возвращает пары для слияния с прочими фильтрами.
 */
export function periodToQuery(p: { preset: PeriodPreset; from: Date; to: Date }): Record<string, string> {
  if (p.preset !== 'custom') return { period: p.preset };
  const lastDay = new Date(p.to.getTime() - DAY_MS);
  return { from: toIsoDay(p.from), to: toIsoDay(lastDay) };
}
