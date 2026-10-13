/**
 * Деньги — только целые копейки (bigint). Никаких float.
 * Ставки — basis points (bp), 1% = 100 bp.
 */
import { currencySymbol, defaultMinorUnits } from './currencies';

export type Minor = bigint;

const RUB_RE = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Рубли → копейки. Строку парсим строго: целая часть, опционально
 * точка/запятая и 1–2 знака копеек. Всё остальное — ошибка,
 * лучше упасть, чем угадать сумму.
 */
export function rublesToMinor(rub: number | string): Minor {
  if (typeof rub === 'number') {
    if (!Number.isFinite(rub)) {
      throw new Error(`rublesToMinor: не число: ${rub}`);
    }
    // Через строку, чтобы не тащить float-арифметику.
    rub = String(rub);
  }
  const s = rub.trim().replace(/\s+/g, '');
  const m = RUB_RE.exec(s);
  if (!m) {
    throw new Error(`rublesToMinor: не удалось разобрать сумму "${rub}"`);
  }
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = BigInt(m[2] ?? '0');
  const frac = BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return sign * (whole * 100n + frac);
}

/**
 * Минорные единицы → ПЛОСКАЯ десятичная строка («1234.56»), точно и без float.
 *
 * Нужна ровно там, где сумма уже известна точно (касса держит bigint), а уехать должна через
 * границу серверного действия: bigint туда не ходит, а `Number(minor)/100` — это тот самый float,
 * из-за которого «100.555» превращалось в 100,56 ₽. Строка + `parseAmountMinor` на сервере дают
 * круговой путь без единой операции с плавающей точкой.
 *
 * Без разделителей разрядов и без символа валюты: это машинный формат для передачи, а не подача
 * человеку — человеку печатает `formatMoneyText`.
 */
export function minorToPlain(minor: Minor, minorUnits: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 18) {
    throw new Error(`minorToPlain: знаков должно быть 0..18, получено ${minorUnits}`);
  }
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const scale = 10n ** BigInt(minorUnits);
  const whole = abs / scale;
  const frac = abs % scale;
  const body = minorUnits === 0 ? `${whole}` : `${whole}.${frac.toString().padStart(minorUnits, '0')}`;
  return neg ? `-${body}` : body;
}

/**
 * 🔴 Введённая ЧЕЛОВЕКОМ сумма → минорные единицы ПО ЗНАКАМ ЭТОЙ ВАЛЮТЫ. null — разобрать нельзя.
 *
 * `rublesToMinor` рядом умеет ровно два знака и умножает на 100 — для рубля это верно, для тезера
 * ошибка в сто раз. Пока такого разбора не было в ядре, каждая форма писала свой: у перевода
 * между счетами он жил локальной функцией, у выплаты его не было вовсе, и поле называлось
 * «Сумма, ₽». Владелец формулирует требование числом: «218,5224» обязано вводиться и приниматься.
 *
 * Строго: только цифры, один разделитель (точка или запятая) и НЕ БОЛЬШЕ `minorUnits` знаков
 * после него. Лишний знак — отказ, а не тихое округление: человек, набравший «218,52245», имел в
 * виду что-то своё, и додумывать за него сумму денег мы не будем.
 */
export function parseAmountMinor(raw: string, minorUnits: number): Minor | null {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 18) return null;
  const c = raw.trim().replace(/\s/g, '').replace(',', '.');
  const re = minorUnits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${minorUnits}})?$`);
  if (!re.test(c)) return null;
  const [major, minor = ''] = c.split('.');
  return BigInt(`${major}${minor.padEnd(minorUnits, '0')}`);
}

/**
 * amount * bp / 10000 с округлением вниз (floor) в целочисленной
 * bigint-арифметике. bp — целое неотрицательное.
 */
export function applyRateBp(amount: Minor, bp: number): Minor {
  if (!Number.isInteger(bp) || bp < 0) {
    throw new Error(`applyRateBp: ставка bp должна быть целым >= 0, получено ${bp}`);
  }
  return (amount * BigInt(bp)) / 10000n;
}

/** Комиссия: процент от суммы, но не меньше минимальной. */
export function computeFee(amount: Minor, rateBp: number, minFeeMinor: Minor): Minor {
  const pct = applyRateBp(amount, rateBp);
  return pct > minFeeMinor ? pct : minFeeMinor;
}

const ruInt = new Intl.NumberFormat('ru-RU', { useGrouping: true, maximumFractionDigits: 0 });

export interface FormattedAmount {
  /** Целые рубли с ru-RU-группировкой разрядов; минус — здесь. */
  major: string;
  /** Копейки, всегда две цифры '00'..'99'. */
  minor: string;
}

export function formatAmount(amount: Minor): FormattedAmount {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const rub = abs / 100n;
  const kop = abs % 100n;
  const major = (negative ? '-' : '') + ruInt.format(rub);
  const minor = kop.toString().padStart(2, '0');
  return { major, minor };
}

/** "1 234,50 ₽" · "1 234,00 ₽" — копейки показываем ВСЕГДА (правка владельца 25.08.2026). */
export function formatRubText(amount: Minor): string {
  const { major, minor } = formatAmount(amount);
  return `${major},${minor} ₽`;
}

/**
 * 🔴 Сумма ЛЮБОЙ валюты текстом — с её символом и её числом знаков.
 *
 * Появилась после 25.09: журнал операций печатал расчёт по тезеру как «21 852,24 $» — чужой символ
 * и два знака вместо четырёх, то есть неверная валюта и ошибка в сто раз в одной строке. Причина
 * была не в журнале, а в том, что текстовых денежных форматтеров стало два. Здесь он один.
 *
 * `minorUnits` передаётся, когда его несут данные (`currencies.minor_units`); иначе берётся
 * запасной список ядра.
 */
export function formatMoneyText(amount: Minor, currency: string, minorUnits?: number): string {
  if (currency === 'RUB') return formatRubText(amount);
  const units = minorUnits ?? defaultMinorUnits(currency);
  const value = Number(amount) / 10 ** units;
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: units, maximumFractionDigits: units })} ${currencySymbol(currency)}`;
}
