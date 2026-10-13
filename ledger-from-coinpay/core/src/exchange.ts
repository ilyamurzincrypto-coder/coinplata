/**
 * Математика обмена (F2b, ядро) — чистые функции, без проводок/знаков счетов.
 * Курс сделки, суммы ног, округление; rate-guard; порог обязательного контроля.
 * Проводки-шаблоны (buildExchangeTx и др.) — отдельно, валидируются на db/f2b.
 */

import type { Minor } from './money';
import { ceilDivBig, floorDivBig, roundHalfEvenDiv } from './fx';
import { defaultMinorUnits } from './currencies';

const E6 = 1_000_000n;
const BP = 10_000n;

/** Клиент покупает USD (платит RUB) либо продаёт USD (получает RUB). */
export type ExchangeDirection = 'buy_usd' | 'sell_usd';
export type RoundingMode = 'bankers' | 'platform';

export interface ExchangeQuote {
  baseE6: bigint;
  markupBp: number;
  dealE6: bigint;
  /** Валюта ноги from/to. RUB — пивот; вторая нога — любая валюта (USD по умолчанию,
   *  а также EUR/TRY/USDT-TRC20/TRX — крипта и экзотика через тот же RUB↔foreign контур). */
  fromCurrency: string;
  toCurrency: string;
  /** Сколько клиент отдаёт (копейки валюты from). */
  fromMinor: Minor;
  /** Сколько клиент получает (копейки валюты to). */
  toMinor: Minor;
}

/**
 * Курс сделки из базового и наценки. buy_usd — база×(1+наценка) (клиент платит
 * больше RUB за USD); sell_usd — база×(1−наценка) (клиент получает меньше RUB).
 * Оба — в пользу платформы. Округление курса вверх (buy) / вниз (sell).
 */
export function dealRateForDirection(baseE6: bigint, markupBp: number, direction: ExchangeDirection): bigint {
  if (baseE6 <= 0n) throw new Error('dealRateForDirection: базовый курс > 0');
  if (markupBp < 0) throw new Error('dealRateForDirection: наценка ≥ 0');
  const bp = BigInt(markupBp);
  if (direction === 'buy_usd') return ceilDivBig(baseE6 * (BP + bp), BP);
  const deal = floorDivBig(baseE6 * (BP - bp), BP);
  if (deal <= 0n) throw new Error('dealRateForDirection: наценка ≥ 100% при продаже');
  return deal;
}

function roundLeg(numer: bigint, denom: bigint, rounding: RoundingMode, clientReceives: boolean): bigint {
  if (rounding === 'bankers') return roundHalfEvenDiv(numer, denom);
  // platform: клиент получает — вниз (floor), платит — вверх (ceil).
  return clientReceives ? floorDivBig(numer, denom) : ceilDivBig(numer, denom);
}

/**
 * Котировка обмена: задаётся сумма на ноге `amountSide` (from — клиент отдаёт,
 * to — клиент хочет получить), вторая нога считается по курсу сделки с округлением.
 * RUB — всегда пивот (2 знака); rate_e6 = RUB за 1 единицу foreign ×10⁶.
 *
 * 🔴 У не-рублёвой ноги СВОЁ число знаков, и оно участвует в расчёте. Прежде формула была
 * `RUB_minor × 1e6 / rate`, то есть предполагала «две копейки» у обеих сторон. Для доллара и
 * евро это верно, для тезера нет: обмен 100 000,00 ₽ по 85 ₽/₮ дал бы 11,7647 ₮ вместо
 * 1 176,47 ₮ — в сто раз меньше. Тот же дефект уже поймали на конверсионной выплате
 * (`payout-conversion.ts`); здесь он латентный, потому что USDT-обмен ещё не заводили.
 */
export function quoteExchange(input: {
  baseE6: bigint;
  markupBp: number;
  direction: ExchangeDirection;
  amountMinor: Minor;
  amountSide: 'from' | 'to';
  rounding: RoundingMode;
  /** Валюта не-рублёвой ноги (дефолт USD — обратная совместимость). RUB — всегда пивот;
   *  baseE6/dealE6 = RUB за 1 единицу foreign. Так один контур обслуживает USD/EUR/крипту. */
  foreignCurrency?: string;
  /** Волна 4: договорной курс сделки — прямой курс вместо база×наценка. */
  dealE6Override?: bigint;
  /** Знаков у не-рублёвой ноги (`currencies.minor_units`). Не передали — запасной список ядра. */
  foreignMinorUnits?: number;
}): ExchangeQuote {
  if (input.amountMinor <= 0n) throw new Error('quoteExchange: сумма > 0');
  const dealE6 =
    input.dealE6Override !== undefined && input.dealE6Override > 0n
      ? input.dealE6Override
      : dealRateForDirection(input.baseE6, input.markupBp, input.direction);
  const foreign = input.foreignCurrency ?? 'USD';
  // Масштабы сторон: делим на рублёвый, а не вычитаем степени, — чтобы валюта с числом знаков
  // меньше двух не дала отрицательный показатель.
  const fScale = 10n ** BigInt(input.foreignMinorUnits ?? defaultMinorUnits(foreign));
  const rScale = 100n; // рубль — пивот, у него два знака
  // buy = клиент платит RUB, получает foreign; sell = отдаёт foreign, получает RUB.
  const fromCurrency = input.direction === 'buy_usd' ? 'RUB' : foreign;
  const toCurrency = input.direction === 'buy_usd' ? foreign : 'RUB';

  let fromMinor: bigint;
  let toMinor: bigint;
  // RUB = foreign_minor × dealE6 × 100 / (1e6 × 10^знаков) ; foreign — обратно.
  if (input.direction === 'buy_usd') {
    // from=RUB, to=foreign
    if (input.amountSide === 'from') {
      fromMinor = input.amountMinor;
      toMinor = roundLeg(fromMinor * fScale * E6, dealE6 * rScale, input.rounding, true); // клиент получает foreign
    } else {
      toMinor = input.amountMinor;
      fromMinor = roundLeg(toMinor * dealE6 * rScale, E6 * fScale, input.rounding, false); // клиент платит RUB
    }
  } else {
    // from=foreign, to=RUB
    if (input.amountSide === 'from') {
      fromMinor = input.amountMinor;
      toMinor = roundLeg(fromMinor * dealE6 * rScale, E6 * fScale, input.rounding, true); // клиент получает RUB
    } else {
      toMinor = input.amountMinor;
      fromMinor = roundLeg(toMinor * fScale * E6, dealE6 * rScale, input.rounding, false); // клиент отдаёт foreign
    }
  }
  return { baseE6: input.baseE6, markupBp: input.markupBp, dealE6, fromCurrency, toCurrency, fromMinor, toMinor };
}

/**
 * Rate-guard: курс сделки отклонился от базового больше чем на guardPct %.
 * Отклонение по модулю (в любую сторону). Границе (ровно =) — НЕ превышение.
 */
export function rateGuardExceeded(dealE6: bigint, baseE6: bigint, guardPct: number): boolean {
  if (baseE6 <= 0n) return true;
  const diff = dealE6 > baseE6 ? dealE6 - baseE6 : baseE6 - dealE6;
  // diff/base > guardPct/100  ⇔  diff*100 > guardPct*base
  return diff * 100n > BigInt(guardPct) * baseE6;
}

/**
 * Рублёвая оценка суммы: `rateE6` — ₽ за 1 единицу ЭТОЙ ЖЕ валюты (не «курс доллара вообще»).
 * null — оценить нечем (курса нет); это ответ, а не ноль.
 *
 * 🔴 Масштаб обязателен. `сумма × курс / 1e6` верно только когда у валюты два знака, как у
 * рубля. 218,5224 ₮ (четыре знака) оценивались в 1 846 725,59 ₽ вместо 18 467,26 ₽ — в сто раз
 * больше, и порог обязательного контроля 600 000 ₽ пробивался ложно.
 */
export function rubEquivalentMinor(amountMinor: Minor, currency: string, rateE6: bigint, minorUnits?: number): Minor | null {
  if (currency === 'RUB') return amountMinor;
  if (rateE6 <= 0n) return null;
  const scale = 10n ** BigInt(minorUnits ?? defaultMinorUnits(currency));
  return (amountMinor * rateE6 * 100n) / (E6 * scale);
}

/**
 * Обязательный контроль: сумма операции ≥ порога (в RUB). Валютная сумма приводится к рублю по
 * курсу СВОЕЙ пары и со СВОИМ числом знаков.
 *
 * 🔴 Курса нет — операция помечается контролируемой, а не пропускается. Прежде `rateE6` приходил
 * нулём (строки курса нет) и оценка давала 0 ₽ — контроль не срабатывал НИКОГДА, молча. Это
 * реестр, который выгружается наружу: ложная пометка стоит одной проверки человеком, пропуск —
 * неполного реестра. Поэтому здесь fail-closed.
 */
export function needsMandatoryControl(amountMinor: Minor, currency: string, rateE6: bigint, thresholdMinor: Minor, minorUnits?: number): boolean {
  const rub = rubEquivalentMinor(amountMinor, currency, rateE6, minorUnits);
  if (rub === null) return true;
  return rub >= thresholdMinor;
}
