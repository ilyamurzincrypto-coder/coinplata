/**
 * (CP PAY, PR-1) Правило активации правила «с даты». Чистая функция, без БД.
 *
 * Денежный баг, который она закрывает (боевой случай 25.08.2026):
 *  11:38 провизия при одобрении KYB записала тариф 2,5 % с valid_from = now();
 *  11:47 оператор задал 5 % «с 25.08» — поле даты дало valid_from = 00:00;
 *  резолвер берёт запись с НАИБОЛЬШИМ valid_from, а 11:38 > 00:00 —
 *  значит правка оператора не применилась НИКОГДА, и с оборота брали 2,5 % вместо 5 %.
 *
 * Решение владельца: ручная правка ВСЕГДА побеждает провизию. Реализуем это не хитростью
 * в чтении, а правилом записи: новая запись не может активироваться раньше или одновременно
 * с уже действующей — она сдвигается на секунду вперёд от неё. Тогда «последняя по valid_from»
 * и «последняя по намерению оператора» — это всегда одна и та же запись.
 *
 * Побочно уходит и дубль: две записи с одинаковым valid_from стать активными разом больше
 * не могут — вторая обязана сдвинуться.
 */

// Шаг сдвига — СЕКУНДА (решение владельца): уникальность момента та же, что у минуты,
// но окно, в котором ещё действует прежняя ставка, сжимается до ≤ 1 с.
export const ACTIVATION_STEP_MS = 1_000;

export interface ActivationInput {
  /** Чего просит оператор (из формы: дата → полночь, либо дата+время). */
  requested: Date;
  /** valid_from уже действующей записи. null — записей ещё нет. */
  activeValidFrom: Date | null;
}

export interface ActivationResult {
  /** Момент, с которого правило реально начнёт действовать. */
  validFrom: Date;
  /** true — запрошенный момент занят/в прошлом относительно активного, сдвинули. */
  shifted: boolean;
}

/**
 * Момент активации новой записи. Если запрошенный момент НЕ позже действующей записи —
 * сдвигаем на секунду вперёд от неё: активной обязана стать именно новая запись.
 */
export function resolveActivation({ requested, activeValidFrom }: ActivationInput): ActivationResult {
  if (!activeValidFrom || requested.getTime() > activeValidFrom.getTime()) {
    return { validFrom: requested, shifted: false };
  }
  return { validFrom: new Date(activeValidFrom.getTime() + ACTIVATION_STEP_MS), shifted: true };
}

/** Человеческая пометка о сдвиге — оператор обязан узнать реальное время активации. */
export function activationNotice(result: ActivationResult, formatted: string): string | null {
  if (!result.shifted) return null;
  return `Уже есть правило, действующее с более позднего момента — новое активируется с ${formatted}.`;
}

/**
 * Детерминированный выбор действующей записи из набора. Порядок — valid_from, затем время
 * создания, затем id: две записи с одинаковым valid_from больше не решают спор случаем
 * сортировки БД. Тот же порядок обязаны применять ВСЕ читатели (capture, карточка, кабинет).
 */
export function pickActive<T extends { validFrom: Date; createdAt: Date; id: string }>(
  rows: readonly T[],
  at: Date,
): T | null {
  const eligible = rows.filter((r) => r.validFrom.getTime() <= at.getTime());
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => {
    const byValid = b.validFrom.getTime() - a.validFrom.getTime();
    if (byValid !== 0) return byValid;
    const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreated !== 0) return byCreated;
    return b.id.localeCompare(a.id);
  })[0]!;
}
