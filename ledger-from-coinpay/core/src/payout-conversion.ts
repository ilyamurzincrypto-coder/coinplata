/**
 * (Д2 / В10c) Математика конверсионной выплаты мерчанту — чистые функции, без db/знаков счетов.
 * Мерчант отдаёт рубли (X), получает валюту выплаты (target) по НАШЕМУ итоговому курсу
 * (our_rate = RUB за 1 target, фиксируется при ИСПОЛНЕНИИ). Наша курсовая маржа = X − Y×base
 * (в рублях) оседает на ОТДЕЛЬНОМ счёте «Доход от обмена» (не эквайринговый доход). Проводки:
 * конверсия через позиции (Σ=0 обе валюты) + выдача из ностро-источника. Σ=0 per-currency.
 */
import type { Minor } from './money';
import { ceilDivBig, floorDivBig, roundHalfEvenDiv } from './fx';
import type { RoundingMode } from './exchange';
import { defaultMinorUnits } from './currencies';

const E6 = 1_000_000n;
/** Рубль — источник конверсии, и знаков у него два. Именно от них и масштабируется цель. */
const RUB_UNITS = 2n;

export interface PayoutConversionParams {
  amountSourceMinor: Minor; // X — рубли мерчанта на конвертацию
  ourRateE6: bigint; // наш итоговый курс: RUB за 1 target ×1e6 (фикс при исполнении)
  baseRateE6: bigint; // базовый (рыночный) курс — для расчёта маржи (дохода обмена)
  rounding: RoundingMode;
  targetCurrency: string;
  /**
   * 🔴 Знаков после запятой у ВАЛЮТЫ ВЫПЛАТЫ. Не косметика: на это число масштабируется сумма,
   * которая ложится в леджер. Не передали — берём запасной список ядра (тезер 4, фиат 2).
   */
  targetMinorUnits?: number;
  accounts: {
    merchantRub: string; // расчётный счёт мерчанта (RUB) — источник
    posRub: string; // позиция платформы RUB
    posTarget: string; // позиция платформы target
    exchangeIncome: string; // «Доход от обмена» (RUB) — отдельный счёт
    sourceTarget: string; // ностро-источник выдачи в target (касса $ / кошелёк USDT)
  };
  idempotencyKey?: string;
}

export interface PayoutConversionResult {
  targetMinor: Minor; // сколько получит мерчант в target
  incomeRubMinor: Minor; // наша курсовая маржа (RUB), на «Доход от обмена»
  entries: { accountId: string; amountMinor: Minor; currency: string }[];
}

function roundLeg(numer: bigint, denom: bigint, rounding: RoundingMode, down: boolean): bigint {
  if (rounding === 'bankers') return roundHalfEvenDiv(numer, denom);
  return down ? floorDivBig(numer, denom) : ceilDivBig(numer, denom);
}

/**
 * Строит проводки конверсионной выплаты. Y (target) = X / our_rate (мерчант получает по нашему
 * курсу — вниз, в пользу платформы). Маржа = X − Y×base (RUB). Ноги:
 *   RUB:    merchant −X · posRub +(X−маржа) · exchangeIncome +маржа     (Σ=0)
 *   target: posTarget −Y · sourceTarget +Y                              (Σ=0)
 * merchant-target — сквозной (нетто 0), опущен; аудит несёт связка request↔tx.
 */
export function buildPayoutConversionTx(p: PayoutConversionParams): PayoutConversionResult {
  if (p.amountSourceMinor <= 0n) throw new Error('buildPayoutConversionTx: сумма > 0');
  if (p.ourRateE6 <= 0n || p.baseRateE6 <= 0n) throw new Error('buildPayoutConversionTx: курс > 0');
  const X = p.amountSourceMinor;
  /**
   * 🔴 Масштаб валюты выплаты. Прежняя формула `X × 1e6 / our_rate` молча считала, что у ВСЕХ
   * валют два знака, как у рубля. Для доллара это верно, для тезера — нет.
   *
   * Что это стоило: заявка на 1 000,00 ₽ по курсу 90,79665 ₽/₮ записывала в леджер 1101 минорную
   * единицу. У тезера их четыре, то есть 0,1101 ₮ вместо 11,0136 ₮ — выплата в СТО РАЗ меньше
   * заказанной. Инвариант Σ=0 этого не ловил: ОБЕ target-ноги были неверны ОДИНАКОВО, поэтому
   * проводка сходилась идеально и была неправильной.
   *
   * Делим на масштаб рубля, а не вычитаем степени, — чтобы валюта с меньшим числом знаков, чем
   * у рубля, не дала отрицательный показатель.
   */
  const targetScale = 10n ** BigInt(p.targetMinorUnits ?? defaultMinorUnits(p.targetCurrency));
  const rubScale = 10n ** RUB_UNITS;
  // target minor = X × 10^знаков_цели × 1e6 / (our_rate × 100); клиент получает — округляем ВНИЗ.
  const targetMinor = roundLeg(X * targetScale * E6, p.ourRateE6 * rubScale, p.rounding, true);
  // Базовая стоимость target-ноги в рублях = Y × base, приведённая обратно к копейкам; маржа = X − это.
  const baseValueRub = (targetMinor * p.baseRateE6 * rubScale) / (E6 * targetScale);
  const incomeRubMinor = X - baseValueRub; // может быть 0/отрицательной (курс без маржи) — не режем
  const { accounts: a } = p;
  const entries = [
    { accountId: a.merchantRub, amountMinor: -X, currency: 'RUB' },
    { accountId: a.posRub, amountMinor: X - incomeRubMinor, currency: 'RUB' },
    { accountId: a.exchangeIncome, amountMinor: incomeRubMinor, currency: 'RUB' },
    { accountId: a.posTarget, amountMinor: -targetMinor, currency: p.targetCurrency },
    { accountId: a.sourceTarget, amountMinor: targetMinor, currency: p.targetCurrency },
  ];
  return { targetMinor, incomeRubMinor, entries };
}

/** Проверка инварианта Σ=0 per-currency (для тестов и рантайм-ассерта). */
export function sumEntriesByCurrency(entries: { amountMinor: Minor; currency: string }[]): Record<string, Minor> {
  const s: Record<string, Minor> = {};
  for (const e of entries) s[e.currency] = (s[e.currency] ?? 0n) + e.amountMinor;
  return s;
}


/**
 * (правка владельца) Двухшаговая выплата: РЕЗЕРВ при заявке и ВЫДАЧА при исполнении.
 *
 * 🔴 Зачем разделили. Прежде `buildPayoutConversionTx` делал всё одной проводкой в момент, когда
 * оператор жал «исполнить»: курс брался тогда же, рубли до этого числились свободными (мерчант
 * мог заказать их второй раз), а кабинет не показывал, что деньги уже в работе.
 *
 * Теперь сделка фиксируется там, где её заключают — при заявке мерчанта:
 *   шаг 1 (резерв):  RUB    merchantRub −X · posRub +(X−маржа) · exchangeIncome +маржа
 *                    TARGET posTarget −Y · merchantHold +Y
 *   шаг 2 (выдача):  TARGET merchantHold −Y · sourceTarget +Y
 *
 * Сумма двух шагов бит-в-бит равна прежней одной проводке — это и проверяет тест. Оператор
 * больше не влияет на курс: он выбирает, откуда физически платить, и подтверждает.
 */
/* Имя с «Request» не для красоты: в `finance.ts` живёт СВОЙ `buildPayoutHoldTx` — hold-модель
   платформенных выплат (A6). Это другая сущность, и одинаковые имена рано или поздно свели бы
   их в одном импорте. */
export function buildRequestHoldTx(p: Omit<PayoutConversionParams, 'accounts'> & {
  accounts: Omit<PayoutConversionParams['accounts'], 'sourceTarget'> & { merchantHold: string };
}): PayoutConversionResult {
  const base = buildPayoutConversionTx({
    ...p,
    accounts: { ...p.accounts, sourceTarget: p.accounts.merchantHold },
  });
  return base;
}

/**
 * Шаг 2: выдача. Обязательство перед мерчантом закрывается, деньги уходят с ностро/кассы.
 * Курс здесь не участвует вовсе — он зафиксирован на шаге 1, и пересчитать его нечем.
 */
export function buildRequestReleaseTx(p: {
  targetMinor: Minor;
  targetCurrency: string;
  accounts: { merchantHold: string; sourceTarget: string };
}): { entries: { accountId: string; amountMinor: Minor; currency: string }[] } {
  if (p.targetMinor <= 0n) throw new Error('buildRequestReleaseTx: сумма > 0');
  return {
    entries: [
      { accountId: p.accounts.merchantHold, amountMinor: -p.targetMinor, currency: p.targetCurrency },
      { accountId: p.accounts.sourceTarget, amountMinor: p.targetMinor, currency: p.targetCurrency },
    ],
  };
}

/** Отмена заявки: разворот резерва теми же ногами с обратным знаком. Курс — тот, что был. */
export function buildRequestHoldReversalTx(hold: PayoutConversionResult): PayoutConversionResult {
  return {
    targetMinor: hold.targetMinor,
    incomeRubMinor: hold.incomeRubMinor,
    entries: hold.entries.map((e) => ({ ...e, amountMinor: -e.amountMinor })),
  };
}
