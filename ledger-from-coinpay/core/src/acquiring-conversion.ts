/**
 * (С8-3) Автоконвертация ЗАЧИСЛЕНИЯ эквайринга — чистые функции, без db/знаков БД.
 *
 * Отличие от выплаты (payout-conversion): здесь мерчант НЕ выводит деньги, а ДЕРЖИТ валюту выплаты
 * на своём settlement-счёте (конверсия рубля-нетто в валюту при зачислении). Модель Д2: конверсия
 * через позиции платформы, курсовая маржа на «Доход от обмена» (374), Σ=0 обе валюты.
 *
 * ДВА дохода раздельно (доп.12а): эквайринг-комиссия уже удержана в capture (fee_income 370);
 * здесь — только КУРСОВАЯ маржа спреда (374). Тождество зеркала касается эквайринг-комиссии.
 *
 * Курс:
 *  • ЗЕРКАЛО (инвойс выставлен в валюте выплаты): курс из инвойса (quote_our_rate); зачисление в
 *    валюте = сумма_инвойса + наценка_мерчанта_в_валюте − комиссия_в_валюте (`mirrorCreditInTarget`).
 *  • НЕЗЕРКАЛЬНО (рублёвый инвойс → валюта выплаты): курс дня × (1+clientMarkupBp), target = X/our_rate.
 */
import type { Minor } from './money';
import { ceilDivBig, floorDivBig, roundHalfEvenDiv } from './fx';
import type { RoundingMode } from './exchange';
import { defaultMinorUnits } from './currencies';
import { merchantEarningOnInvoice } from './payout-breakdown';

const E6 = 1_000_000n;
/** Рубль — вторая сторона КАЖДОГО перевода здесь, и знаков у него два. */
const RUB_SCALE = 100n;
/** Масштаб валюты выплаты: из справочника, если пришёл; иначе запасной список ядра. */
const targetScaleOf = (currency: string, minorUnits?: number): bigint =>
  10n ** BigInt(minorUnits ?? defaultMinorUnits(currency));

function roundLeg(numer: bigint, denom: bigint, rounding: RoundingMode, down: boolean): bigint {
  if (rounding === 'bankers') return roundHalfEvenDiv(numer, denom);
  return down ? floorDivBig(numer, denom) : ceilDivBig(numer, denom);
}

/**
 * Комиссия эквайринга, выраженная в валюте выплаты (для зеркального тождества). Округляем В ПОЛЬЗУ
 * ПЛАТФОРМЫ (вверх) — мерчант получает ≤, копейки не «дарим». `commissionRubMinor` — уже удержанная
 * в capture эквайринг-комиссия (RUB); `ourRateE6` — курс инвойса (RUB за 1 валюту).
 */
export function mirrorCommissionInTarget(p: {
  commissionRubMinor: Minor;
  ourRateE6: bigint;
  rounding: RoundingMode;
  /** Валюта выплаты — её знаки и задают масштаб. Аргумент обязателен осознанно. */
  targetCurrency: string;
  /** Знаков у валюты выплаты (`currencies.minor_units`). Нет — запасной список ядра. */
  targetMinorUnits?: number;
}): Minor {
  if (p.commissionRubMinor <= 0n) return 0n;
  if (p.ourRateE6 <= 0n) throw new Error('mirrorCommissionInTarget: курс > 0');
  /**
   * 🔴 Масштаб цели. Прежняя формула `комиссия × 1e6 / курс` считала, что у валюты выплаты два
   * знака, как у рубля. У тезера их четыре, и комиссия выходила в СТО РАЗ меньше: счёт на
   * 226,0000 ₮ с комиссией 960,00 ₽ по курсу 89,66 давал 0,1071 ₮ вместо 10,7070 ₮ — платформа
   * ДАРИЛА мерчанту свою эквайринг-комиссию, а Σ=0 сходился (зачисление считалось из той же
   * испорченной величины).
   */
  const targetScale = targetScaleOf(p.targetCurrency, p.targetMinorUnits);
  return roundLeg(p.commissionRubMinor * targetScale * E6, p.ourRateE6 * RUB_SCALE, p.rounding, false); // вверх — в пользу платформы
}

/**
 * (правка владельца, 15.09.2026) Зачисление ЗЕРКАЛА в валюте.
 *
 * Модель: спред удерживается ТОЛЬКО при обмене, и обмен один для всех путей — рубли мерчанта по
 * НАШЕМУ курсу. Прежде зеркало зачисляло «выставлено − комиссия», и всё, что клиент заплатил сверх
 * нашего курса, — наценка мерчанта — уходило в доход обмена (374). Экран «Вы заработали»
 * показывал её мерчанту, а в деньгах её забирала платформа.
 *
 * Теперь: выставлено + наценка_в_валюте − комиссия_в_валюте. Наценка в рублях берётся ТОЙ ЖЕ
 * функцией, что экран заработка (`merchantEarningOnInvoice`), и переводится по курсу инвойса вниз.
 * Без наценки число совпадает с прежним копейка-в-копейку.
 */
export function mirrorCreditInTarget(p: {
  /** Рубли клиента (invoices.amount_minor). */
  amountRubMinor: Minor;
  /** Удержанная эквайринг-комиссия, RUB. */
  commissionRubMinor: Minor;
  /** Сумма счёта в валюте (display_amount_minor). */
  displayAmountMinor: Minor;
  /** Наш курс инвойса (quote_our_rate): база + наш спред, без наценки мерчанта. */
  ourRateE6: bigint;
  rounding: RoundingMode;
  /** Валюта счёта = валюта выплаты. Её знаки масштабируют обе переводимые величины. */
  targetCurrency: string;
  /** Знаков у валюты выплаты (`currencies.minor_units`). Нет — запасной список ядра. */
  targetMinorUnits?: number;
}): { targetMinor: Minor; commissionTargetMinor: Minor; markupRubMinor: Minor; markupTargetMinor: Minor } {
  if (p.ourRateE6 <= 0n) throw new Error('mirrorCreditInTarget: курс > 0');
  const targetScale = targetScaleOf(p.targetCurrency, p.targetMinorUnits);
  const commissionTargetMinor = mirrorCommissionInTarget({ commissionRubMinor: p.commissionRubMinor, ourRateE6: p.ourRateE6, rounding: p.rounding, targetCurrency: p.targetCurrency, ...(p.targetMinorUnits !== undefined ? { targetMinorUnits: p.targetMinorUnits } : {}) });
  const markupRubMinor = merchantEarningOnInvoice({ amountMinor: p.amountRubMinor, displayAmountMinor: p.displayAmountMinor, ourRateE6: p.ourRateE6, displayCurrency: p.targetCurrency, ...(p.targetMinorUnits !== undefined ? { displayMinorUnits: p.targetMinorUnits } : {}) });
  // Наценка мерчанта в валюту — тем же масштабом (её же он получает на счёт).
  const markupTargetMinor = markupRubMinor > 0n ? roundLeg(markupRubMinor * targetScale * E6, p.ourRateE6 * RUB_SCALE, p.rounding, true) : 0n;
  return {
    targetMinor: p.displayAmountMinor + markupTargetMinor - commissionTargetMinor,
    commissionTargetMinor,
    markupRubMinor,
    markupTargetMinor,
  };
}

export interface AcquiringConversionParams {
  /** X — рубли мерчанта к конверсии (amount − эквайринг-комиссия), уже зачисленные capture-ом. */
  netRubMinor: Minor;
  /** RUB за 1 валюту выплаты ×1e6. Зеркало: quote_our_rate инвойса; иначе дневной×(1+markup). */
  ourRateE6: bigint;
  /** Базовый курс (для расчёта курсовой маржи 374). Зеркало: quote_base_rate; иначе дневной base. */
  baseRateE6: bigint;
  targetCurrency: string;
  /**
   * Зеркало: зачисление в валюте = сумма_инвойса − комиссия_в_валюте (тождество ТОЧНОЕ, копейка-в-копейку).
   * Незеркально не задаётся — target считается из X/our_rate (вниз, в пользу платформы).
   */
  targetMinorOverride?: Minor;
  /**
   * 🔴 Знаков после запятой у ВАЛЮТЫ ВЫПЛАТЫ. Не оформление: на это число масштабируется сумма,
   * которая ложится в леджер, и от него же считается рублёвая база курсовой маржи.
   * Не передали — берём запасной список ядра (тезер 4, фиат 2).
   */
  targetMinorUnits?: number;
  rounding: RoundingMode;
  accounts: {
    merchantRub: string; // расчётный счёт мерчанта (RUB) — источник, обнуляется этой конверсией
    posRub: string; // позиция платформы RUB
    posTarget: string; // позиция платформы валюты выплаты
    exchangeIncome: string; // «Доход от обмена» (RUB, 374) — курсовая маржа
    merchantTarget: string; // расчётный счёт мерчанта в валюте выплаты — сюда зачисляем (он ДЕРЖИТ)
  };
}

export interface AcquiringConversionResult {
  targetMinor: Minor; // зачисление мерчанту в валюте выплаты
  incomeRubMinor: Minor; // курсовая маржа (RUB) на 374 (может быть 0)
  entries: { accountId: string; amountMinor: Minor; currency: string }[];
}

/**
 * Проводки автоконвертации зачисления. Ноги (Σ=0 обе валюты):
 *   RUB:    merchantRub −X · posRub +(X−маржа) · exchangeIncome +маржа
 *   target: posTarget −Y · merchantTarget +Y
 * Y = targetMinorOverride (зеркало) ИЛИ X/our_rate (вниз). Маржа = X − Y×base/1e6.
 */
export function buildAcquiringConversionTx(p: AcquiringConversionParams): AcquiringConversionResult {
  if (p.netRubMinor <= 0n) throw new Error('buildAcquiringConversionTx: сумма > 0');
  if (p.ourRateE6 <= 0n || p.baseRateE6 <= 0n) throw new Error('buildAcquiringConversionTx: курс > 0');
  const X = p.netRubMinor;
  /**
   * 🔴 Масштаб валюты выплаты — тот же дефект, что уже выстрелил на конверсионной ВЫПЛАТЕ
   * (`payout-conversion.ts`). Формула `X × 1e6 / our_rate` молча считала, что у всех валют два
   * знака, как у рубля. Для доллара верно, для тезера нет: приём 19 591,83 ₽ с комиссией 5 %
   * (нетто 18 612,24 ₽) по курсу 89,655917 давал 2,0760 ₮ вместо 207,6023 ₮. Обе target-ноги
   * были неверны ОДИНАКОВО, поэтому Σ=0 сходился и триггер молчал; а нетто ниже ≈90 ₽ схлопывало
   * зачисление в 0 и оплата навсегда оставалась в `deferred`.
   *
   * Делим на масштаб рубля, а не вычитаем степени, — чтобы валюта с числом знаков меньше двух
   * не дала отрицательный показатель.
   */
  const targetScale = targetScaleOf(p.targetCurrency, p.targetMinorUnits);
  const targetMinor = p.targetMinorOverride ?? roundLeg(X * targetScale * E6, p.ourRateE6 * RUB_SCALE, p.rounding, true);
  if (targetMinor <= 0n) throw new Error('buildAcquiringConversionTx: зачисление в валюте ≤ 0');
  // Рублёвая стоимость target-ноги по БАЗОВОМУ курсу — обратный перевод тем же масштабом,
  // иначе курсовая маржа (и доход обмена) выходит завышенной на порядок.
  const baseValueRub = (targetMinor * p.baseRateE6 * RUB_SCALE) / (E6 * targetScale);
  const incomeRubMinor = X - baseValueRub; // курсовая маржа; 0/отриц. не режем (как payout-conversion)
  const a = p.accounts;
  const entries = [
    { accountId: a.merchantRub, amountMinor: -X, currency: 'RUB' },
    { accountId: a.posRub, amountMinor: X - incomeRubMinor, currency: 'RUB' },
    { accountId: a.exchangeIncome, amountMinor: incomeRubMinor, currency: 'RUB' },
    { accountId: a.posTarget, amountMinor: -targetMinor, currency: p.targetCurrency },
    { accountId: a.merchantTarget, amountMinor: targetMinor, currency: p.targetCurrency },
  ];
  return { targetMinor, incomeRubMinor, entries };
}
