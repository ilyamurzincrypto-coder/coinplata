/**
 * QR «Филиал 2»: ЗАПИСЬ О ВЫДАЧЕ — что кассир отдал клиенту на руки.
 *
 * Это не платформенная величина и не проводка: рубли клиента платформа видит одной суммой, а
 * наличные (или тезер) из кассы пункта уходят его собственными деньгами. Но владелец обязан
 * видеть в журнале и в карточке оплаты именно выдачу — «2 000,00 ₺», «50,0000 ₮», — иначе
 * сверить кассу пункта с оплатами не с чем.
 *
 * Валюта — код утреннего листа (RUB/USD/EUR/TRY/USDT), а не код валюты леджера: USDT здесь
 * означает тезер «на руки клиенту», знаков у него четыре, как в кассе и в листе.
 */
import { currencySymbol } from './currencies';
import { isSheetAsset, SHEET_ASSETS, SHEET_MINOR_UNITS, type SheetAsset } from './point-rate-sheet';

/** Валюта выдачи = валюта листа пункта. Рубли — «выдача» рублёвого режима (клиент платит их же). */
export type PayoutAsset = SheetAsset;

export interface QrPayoutRecord {
  currency: PayoutAsset;
  /** Сумма в минорных единицах ЭТОЙ валюты: ₮ — 4 знака, наличные и рубли — 2. */
  minor: bigint;
}

/** Потолок записи — миллион единиц валюты выдачи, тот же, что у ввода на кассе. */
const MAX_PAYOUT_UNITS = 1_000_000n;

const ruInt = new Intl.NumberFormat('ru-RU', { useGrouping: true, maximumFractionDigits: 0 });

/** Валюта выдачи? Строка из базы проверяется здесь, а не приводится к типу вслепую. */
export function isPayoutAsset(v: string): v is PayoutAsset {
  return isSheetAsset(v);
}

/**
 * Претензия к записи о выдаче; null — запись годная. Сервер зовёт её перед сохранением: касса
 * присылает валюту и сумму строкой, и принимать «USDT-TRC20», ноль или миллиард нельзя.
 */
export function payoutRecordProblem(r: { currency: string; minor: bigint }): string | null {
  if (!isPayoutAsset(r.currency)) return `Валюта выдачи — одна из: ${SHEET_ASSETS.join(', ')}`;
  if (r.minor <= 0n) return 'Сумма выдачи должна быть больше нуля';
  if (r.minor > MAX_PAYOUT_UNITS * 10n ** BigInt(SHEET_MINOR_UNITS[r.currency])) return 'Сумма выдачи больше миллиона единиц';
  return null;
}

/**
 * 🔴 ЕДИНСТВЕННЫЙ форматтер выдачи: «2 000,00 ₺», «50,0000 ₮», «8 745,22 ₽». Его печатают и
 * журнал кассы, и борд расчёта, и карточка операции — второй неизбежно разошёлся бы в знаках
 * (у тезера их четыре) или в символе. Дробная часть — того же кегля и веса, что целая
 * (дизайн-система): приглушается только символ валюты, и делает это вёрстка, не форматтер.
 */
export function formatPayoutMinor(minor: bigint, currency: PayoutAsset): string {
  const units = SHEET_MINOR_UNITS[currency];
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const scale = 10n ** BigInt(units);
  const frac = (abs % scale).toString().padStart(units, '0');
  return `${neg ? '−' : ''}${ruInt.format(abs / scale)},${frac}`;
}

/** Та же сумма с символом валюты — одной строкой, для мест без своей вёрстки. */
export function formatPayout(r: QrPayoutRecord): string {
  return `${formatPayoutMinor(r.minor, r.currency)} ${currencySymbol(r.currency)}`;
}
