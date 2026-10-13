/**
 * (Косяк 4) Газ крипто-выплаты — РАСХОД ПЛАТФОРМЫ, а не вычет у мерчанта. Чистые функции.
 *
 * 🔴 Смена модели. PR-3 задумывал газ как удержание: `applyPayoutGas` возвращал «сколько мерчант
 * получит на руки после газа». Решение владельца — противоположное: мерчант получает ПОЛНУЮ
 * сумму выплаты, а комиссию сети платформа платит из своего кармана отдельной ногой в счёт
 * затрат 373 «Затраты сети (газ)». Поэтому функция вычета удалена целиком, а не оставлена
 * «на всякий случай»: пока она существует, её кто-нибудь позовёт.
 *
 * Важно: до этой правки газ не вычитался НИГДЕ — прежняя функция жила только в тестах. Так что
 * это первая реализация модели, а не миграция денег: пересчитывать нечего.
 *
 * Газ платится в НАТИВНОЙ монете сети (TRC20 → TRX), а не в валюте выплаты. Поэтому оценка —
 * фиксированная сумма в валюте газа. Процент от суммы выплаты здесь бессмыслен: комиссия сети
 * не зависит от того, сколько токенов ты переводишь, и жила бы в другой валюте.
 */

export type GasType = 'percent' | 'fixed';

export interface GasRule {
  /** null — газ не задан (или канал не крипто). */
  gasType: GasType | null;
  /** Легаси-колонка PR-3. Для расхода платформы неприменима — см. `estimateGas`. */
  gasPercentBp: number | null;
  /** Оценка газа в минорных единицах ВАЛЮТЫ ГАЗА (TRX), а не валюты выплаты. */
  gasFixedMinor: bigint | null;
}

export interface GasEstimate {
  /** Сколько списать с кошелька в расход. 0 — газ не применяется. */
  gasMinor: bigint;
  /** Применять ногу расхода. */
  applies: boolean;
  /** Правило есть, но исполнить его нельзя — причина словами. Молча пропускать нельзя. */
  problem: string | null;
}

const NO_GAS: GasEstimate = { gasMinor: 0n, applies: false, problem: null };

/**
 * Оценка газа по правилу канала. Возвращает СУММУ РАСХОДА, а не уменьшенную выплату:
 * сумма мерчанту этой функцией не касается вовсе.
 */
export function estimateGas(rule: GasRule): GasEstimate {
  if (rule.gasType === 'fixed') {
    if (rule.gasFixedMinor === null || rule.gasFixedMinor < 0n) {
      return { gasMinor: 0n, applies: false, problem: 'оценка газа не заполнена' };
    }
    if (rule.gasFixedMinor === 0n) return NO_GAS; // ноль — осознанное «газа нет»
    return { gasMinor: rule.gasFixedMinor, applies: true, problem: null };
  }

  if (rule.gasType === 'percent') {
    // Осознанно не считаем. Процент задан от суммы выплаты, а списывать надо в валюте газа —
    // это разные валюты, и перевод одной в другую здесь был бы догадкой. В деньгах не гадаем.
    return { gasMinor: 0n, applies: false, problem: 'газ задан процентом — укажите оценку суммой в валюте сети' };
  }

  return NO_GAS; // тип не задан: газа нет. Нормальный случай для фиатных каналов.
}

/** Правило заполнено корректно: для формы. Процент считается незаполненным — он неисполним. */
export function isGasRuleComplete(rule: GasRule): boolean {
  if (rule.gasType === 'fixed') return rule.gasFixedMinor !== null && rule.gasFixedMinor >= 0n;
  if (rule.gasType === 'percent') return false;
  return rule.gasFixedMinor === null && rule.gasPercentBp === null;
}

/**
 * Человеческая подпись: «оценка газа 1,5000 TRX» / «газ не задан».
 *
 * 🔴 Число знаков — БЕЗ дефолта. Заряженная двойка печатала газ нативной монеты (четыре знака)
 * в сто раз крупнее: 1,5000 TRX читалось как «150,00 TRX». Знаки приходят от валюты газа —
 * из справочника или из запасного списка ядра, — и вызывающий обязан их назвать.
 */
export function describeGas(rule: GasRule, gasCurrency: string, decimals: number): string {
  if (rule.gasType === 'fixed' && rule.gasFixedMinor !== null) {
    const unit = 10n ** BigInt(decimals);
    const whole = rule.gasFixedMinor / unit;
    const frac = (rule.gasFixedMinor % unit).toString().padStart(decimals, '0');
    return `оценка газа ${whole},${frac} ${gasCurrency}`;
  }
  if (rule.gasType === 'percent') return 'газ задан процентом — неисполнимо';
  return 'газ не задан';
}
