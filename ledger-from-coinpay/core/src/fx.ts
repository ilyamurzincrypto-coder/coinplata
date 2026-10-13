/**
 * Курсы и округление обменного контура (F2a — ядро; сам обмен — F2b).
 *
 * Курс храним как rate_e6 = курс×10⁶ (integer, без float). Пара RUB/USD:
 * rate_e6 — сколько RUB за 1 USD ×10⁶ (напр. 90.1234 ₽/$ = 90 123 400).
 *
 * Округление — К ВЫГОДЕ ПЛАТФОРМЫ: клиент платит — вверх (ceil), получает —
 * вниз (floor); дробный остаток оседает в позиции. Детерминизм, касса не в минусе.
 */

import type { Minor } from './money';

const E6 = 1_000_000n;
const BP = 10_000n;

/** Целочисленное деление вниз (floor) для положительного делителя. */
export function floorDivBig(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new Error('floorDivBig: делитель должен быть > 0');
  const q = a / b;
  const r = a % b;
  return r < 0n ? q - 1n : q;
}

/** Целочисленное деление вверх (ceil) для положительного делителя. */
export function ceilDivBig(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new Error('ceilDivBig: делитель должен быть > 0');
  const q = a / b;
  const r = a % b;
  return r > 0n ? q + 1n : q;
}

/**
 * Банковское округление a/b (half-even) — ДЕФОЛТ обмена (решение эксперта):
 * половина округляется к ЧЁТНОМУ. Делитель > 0. ceil/floor остаются опцией
 * (fx_settings.rounding='platform').
 */
export function roundHalfEvenDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new Error('roundHalfEvenDiv: делитель должен быть > 0');
  const q = floorDivBig(a, b);
  const rem = a - q * b; // 0 <= rem < b
  const twice = rem * 2n;
  if (twice < b) return q;
  if (twice > b) return q + 1n;
  return q % 2n === 0n ? q : q + 1n; // ровно половина → к чётному
}

/**
 * Наценка сделки. Приоритет: индивидуальная (контрагент) > групповая > дефолт.
 * null/undefined на уровне пропускается.
 */
export function resolveMarkupBp(opts: {
  individual?: number | null;
  group?: number | null;
  fallback: number;
}): number {
  if (opts.individual !== null && opts.individual !== undefined) return opts.individual;
  if (opts.group !== null && opts.group !== undefined) return opts.group;
  return opts.fallback;
}

/**
 * Курс сделки = базовый × (1 + наценка). Округляем вверх (клиент платит по нему
 * больше RUB за USD — в пользу платформы). markupBp может быть 0.
 */
export function dealRateE6(baseE6: bigint, markupBp: number): bigint {
  if (baseE6 <= 0n) throw new Error('dealRateE6: базовый курс должен быть > 0');
  if (markupBp < 0) throw new Error('dealRateE6: наценка не может быть отрицательной');
  return ceilDivBig(baseE6 * (BP + BigInt(markupBp)), BP);
}

/**
 * Клиент ПОКУПАЕТ usdMinor USD — сколько RUB (копеек) платит по курсу сделки.
 * Округление ВВЕРХ (клиент платит) — в пользу платформы.
 */
export function rubToPayForUsd(usdMinor: Minor, dealE6: bigint): Minor {
  return ceilDivBig(usdMinor * dealE6, E6);
}

/**
 * Клиент ПРОДАЁТ usdMinor USD — сколько RUB (копеек) получает по курсу сделки.
 * Округление ВНИЗ (клиент получает) — в пользу платформы.
 */
export function rubToReceiveForUsd(usdMinor: Minor, dealE6: bigint): Minor {
  return floorDivBig(usdMinor * dealE6, E6);
}

/**
 * Клиент ПОКУПАЕТ USD за rubMinor RUB — сколько USD (копеек) получает.
 * Округление ВНИЗ (клиент получает меньше) — в пользу платформы.
 */
export function usdToReceiveForRub(rubMinor: Minor, dealE6: bigint): Minor {
  return floorDivBig(rubMinor * E6, dealE6);
}

/**
 * Формат rate_e6 КАК ЕСТЬ: все значащие знаки, без группировки разрядов («90,1234», «1234,5»).
 *
 * 🔴 Имя с «Exact» — не украшение. Раньше функция звалась `formatRateE6`, ровно как ДРУГАЯ
 * функция в `apps/web/src/lib/format-rate`, печатающая два знака с русской группировкой. Импорт
 * подставлялся по имени, и на одном экране кабинета один и тот же курс выходил двумя разными
 * строками: плитка «90,848534», карточка под ней «90,8485». Два написания одной цифры о деньгах —
 * это вопрос «а какой курс настоящий?», и задать его успел владелец. Совпадение имён устранено.
 *
 * Здесь — представление для мест, где важна ПОЛНАЯ точность хранения (выписка), а не витрина.
 */
export function formatRateE6Exact(rateE6: bigint): string {
  const whole = rateE6 / E6;
  const frac = (rateE6 % E6).toString().padStart(6, '0').replace(/0+$/, '') || '0';
  return `${whole},${frac}`;
}
