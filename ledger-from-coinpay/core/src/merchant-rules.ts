/**
 * (Блок 1, PR-2) Правила мерчанта — что оператор обязан задать, чтобы мерчант заработал.
 * Чистые функции: ни БД, ни времени.
 *
 * 🔴 Полнота = ОТМЕТКА, а не косвенный признак. Разведка живого прогона показала, почему:
 * мерчант был `active` с тарифом 0 % и без валюты выплаты, и по любому косвенному признаку
 * выглядел настроенным. Выводить полноту из «есть валюта выплаты» тоже нельзя — по модели Б2-5
 * рубли это ОТСУТСТВИЕ каналов, и рублёвый мерчант полон без единого валютного канала; такой
 * вывод запер бы его в draft навсегда. Отвечает на вопрос «человек прошёл окно и подтвердил»
 * только сам факт прохождения.
 */

/** Куда платим мерчанту. `rub_only` — осознанный выбор «без конверсии», а не пустое поле. */
/**
 * Куда уходят деньги мерчанта.
 *
 * 🔴 `primary` — ОСНОВНАЯ валюта выплаты, и она обязательна. Прежде её не было вовсе: канал,
 * записанный первым в массиве, молча становился основным (`isPrimary: first`), а порядок массива
 * шёл от порядка кликов в форме. На боевом это дало ровно то, чего боишься: мерчант выставил
 * счёт в долларах, а конверсия увела 860,44 € — основным оказался EUR, потому что он оказался
 * первым. Вопрос «в какой валюте мерчант получит деньги» не может решаться порядком галочек.
 */
export type PayoutMode =
  | { kind: 'rub_only' }
  | { kind: 'currencies'; currencies: string[]; primary: string };

export interface MerchantRulesInput {
  /** Ставка эквайринга, bp. Ноль допустим, но ТОЛЬКО введённый руками. */
  acquiringRateBp: number;
  /** Наша наценка per-валюта, bp. Пустой список недопустим. */
  spreads: { currency: string; priceBp: number }[];
  payout: PayoutMode;
}

export type RulesProblem = string;

/**
 * Проверка заполненности формы. Возвращает список того, чего не хватает — оператору нужен
 * перечень, а не первое попавшееся «неверно».
 */
export function validateMerchantRules(input: MerchantRulesInput): RulesProblem[] {
  const out: RulesProblem[] = [];
  if (!Number.isInteger(input.acquiringRateBp) || input.acquiringRateBp < 0) {
    out.push('Тариф эквайринга — целое число процентов, не меньше нуля');
  }
  if (input.acquiringRateBp > 10_000) out.push('Тариф эквайринга не может превышать 100 %');
  if (input.spreads.length === 0) out.push('Задайте нашу наценку хотя бы по одной валюте');
  for (const s of input.spreads) {
    if (!Number.isInteger(s.priceBp) || s.priceBp < 0) out.push(`Наша наценка ${s.currency} — целое число процентов, не меньше нуля`);
  }
  if (input.payout.kind === 'currencies' && input.payout.currencies.length === 0) {
    out.push('Выберите валюту выплаты или отметьте «только рубли»');
  }
  // Основная валюта обязана быть названа И быть среди выбранных: иначе выплата уйдёт «куда-то».
  if (input.payout.kind === 'currencies' && input.payout.currencies.length > 0) {
    if (!input.payout.primary) {
      out.push('Отметьте основную валюту выплаты — в неё уходит конверсия по умолчанию');
    } else if (!input.payout.currencies.includes(input.payout.primary)) {
      out.push(`Основная валюта ${input.payout.primary} не выбрана среди валют выплаты`);
    }
  }

  /**
   * 🔴 Валюта выплаты БЕЗ нашей наценки — тупик, из которого не выбраться.
   *
   * Живой случай: мерчанту завели канал USDT-TRC20, наценки при этом заводятся только по
   * фиатным POS-валютам. Курс задан, канал есть, а выплата отбивается «наценка не задана» —
   * и снять это нечем, потому что окно правил поля наценки для крипты не показывало вовсе.
   * Ловим здесь, при сохранении правил: нельзя обещать выплату в валюте, цену которой не назвали.
   */
  if (input.payout.kind === 'currencies') {
    const priced = new Set(input.spreads.map((s) => s.currency));
    for (const currency of input.payout.currencies) {
      if (!priced.has(currency)) {
        out.push(`Для выплаты в ${currency} не задана наша наценка — без неё выплату исполнить нельзя`);
      }
    }
  }
  return out;
}

/**
 * Подсказка тарифа: столько платформа сама платит за приём (НСПК + банк). Считается динамически
 * из настроек — поменяется ставка банка, поменяется и подсказка.
 *
 * Смысл: «по умолчанию не уходим в минус». Оператор волен поставить выше (заработок) или ниже,
 * вплоть до нуля, — но осознанно, а не потому что поле осталось пустым.
 */
export function acquiringHintBp(nspkFeeBp: number, bankFeeBp: number): number {
  return Math.max(0, nspkFeeBp) + Math.max(0, bankFeeBp);
}

/**
 * Насколько тариф ниже расходов платформы на приём (bp). 0 — тариф покрывает расходы.
 *
 * 🔴 Это НЕ признак ошибки. По принятой модели (созвон с Кириллом) эквайринг с мерчанта не
 * берётся вовсе: НСПК и банк платим мы, прибыль приходит наценкой на выплате. Поэтому величина
 * показывается как ФАКТ («приём обходится нам в X»), а не как предупреждение о потере.
 */
export function belowCostBp(acquiringRateBp: number, hintBp: number): number {
  return acquiringRateBp < hintBp ? hintBp - acquiringRateBp : 0;
}

/** Правила завершены: оператор прошёл окно. Ничего не угадываем. */
export function rulesComplete(m: { rulesSetAt: Date | null }): boolean {
  return m.rulesSetAt !== null;
}

/** Чего не хватает мерчанту до активации — для подписи на заблокированной кнопке. */
export function activationBlockers(m: { status: string; rulesSetAt: Date | null }): string[] {
  const out: string[] = [];
  if (!rulesComplete(m)) out.push('правила не заданы');
  if (m.status !== 'draft') out.push(`статус «${m.status}» — активация применима только к draft`);
  return out;
}
