import type { Minor } from './money';

/**
 * 🔴 ОПРОС БАНКА ФИЛИАЛА 2 — ИНДИКАТОР, А НЕ ПОДТВЕРЖДЕНИЕ.
 *
 * Провайдер отдаёт ручку «приходил ли СЕГОДНЯ платёж ровно на такую сумму»: `{amount} → {status,
 * datetime}`. В ответе нет ни идентификатора платежа, ни плательщика, ни назначения. Значит она
 * отвечает не «наш платёж пришёл», а «какой-то платёж с такой суммой сегодня был».
 *
 * Отсюда два свойства, из-за которых автофиксация по этой ручке ЗАПРЕЩЕНА (решение владельца
 * 29.09.2026: «нам нужно только индикативное оповещение»):
 *
 *  1. Сумма не идентификатор. Два клиента платят по 5 000 ₽ в один день — пришёл один платёж, а
 *     ручка ответит `true` обоим счетам. Автофиксация поставила бы провайдеру требование на два,
 *     а тезер он пришлёт за один, и разошлось бы это только на следующий день, на расчёте.
 *  2. `true` держится весь день. Счёт на 5 000 ₽ оплатили утром; вечером кассир выбивает новый на
 *     те же 5 000 — и ПЕРВЫЙ же опрос отвечает `true` по чужому утреннему платежу.
 *
 * Единственный осмысленный сигнал при отсутствии идентификатора — ПЕРЕХОД `absent → seen`, пока
 * счёт открыт. Поэтому запоминается ПЕРВЫЙ ответ: если он сразу `seen`, зелёного не будет никогда,
 * сколько ни опрашивай.
 */

/** Ответ банка по одной сумме. `absent` — платежа нет, `seen` — платёж с такой суммой сегодня был. */
export type BankAnswer = 'absent' | 'seen';

export type BankPollState =
  /** Ещё не спрашивали. */
  | 'idle'
  /** Спросили, платежа пока нет. */
  | 'waiting'
  /** 🟢 На наших глазах было «нет», стало «есть» — это похоже на наш платёж. */
  | 'seen'
  /** 🟡 Первый же ответ был «есть»: совпадение по сумме с чужим платежом неотличимо от нашего. */
  | 'ambiguous'
  /** ⚪ Провайдер не ответил — проверка недоступна, касса работает как раньше. */
  | 'unavailable';

/**
 * Состояние индикатора. `firstAnswer` — самый первый ответ по ЭТОМУ счёту (null — ещё не спрашивали).
 *
 * 🔴 `ambiguous` НЕ переходит в `seen` ни при каких последующих ответах: если на момент выставления
 * QR платёж с такой суммой уже числился, отличить наш от чужого нечем до конца дня. Молчаливое
 * позеленение здесь было бы худшим из возможных — кассир поверил бы зелёному.
 */
export function bankPollState(p: {
  firstAnswer: BankAnswer | null;
  /** Ответ получен? false — сеть/сервер провайдера недоступны. */
  reachable: boolean;
  /** Текущий ответ; имеет смысл только при `reachable`. */
  answer?: BankAnswer;
}): BankPollState {
  if (!p.reachable) return p.firstAnswer === null ? 'unavailable' : 'unavailable';
  if (p.firstAnswer === 'seen') return 'ambiguous';
  if (p.firstAnswer === null) return p.answer === 'seen' ? 'ambiguous' : 'waiting';
  return p.answer === 'seen' ? 'seen' : 'waiting';
}

/**
 * 🔴 Сумма для провайдера — СТРОКА, собранная из минорных единиц. Через число её гонять нельзя.
 *
 * Их ручка принимает `{"amount": 123.45}`, то есть JSON-число, и сверяет ТОЧНОЕ совпадение. Наши
 * 19 591,83 ₽ при сериализации через float дают `19591.830000000002`, и точное совпадение не
 * находится. Деньги в проекте живут только целыми — здесь это правило доходит до самого провода.
 */
export function bankAmountText(minor: Minor, minorUnits: number): string {
  if (minorUnits < 0) throw new Error('bankAmountText: знаков не может быть меньше нуля');
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const scale = 10n ** BigInt(minorUnits);
  const whole = abs / scale;
  const frac = abs % scale;
  const text = minorUnits === 0 ? `${whole}` : `${whole}.${frac.toString().padStart(minorUnits, '0')}`;
  return neg ? `-${text}` : text;
}

/**
 * 🔴 КОПЕЙКИ — НОМЕР ОПЛАТЫ ЗА ДЕНЬ, а не «ближайшая свободная».
 *
 * Решение владельца 29.09: «чтобы копейки не просто рандом, а как бы выбивали номер транзы для
 * нас, для сверки». Копейки суммы делаются равными порядковому номеру оплаты этого провайдера за
 * день: 5 000,17 ₽ — это семнадцатая оплата. В выписке провайдера номер читается прямо со строки,
 * и сверять больше нечего — сопоставление получается глазами, без таблиц соответствия.
 *
 * Попутно это СИЛЬНЕЕ прежнего перебора: уникальность суммы следует из уникальности номера.
 * Номера не переиспользуются в течение дня, поэтому оплаченная утром сумма не может быть выдана
 * повторно вечером — а именно на этом индикатор зеленел бы по чужому платежу.
 *
 * Сдвиг всегда ВВЕРХ и всегда меньше рубля: берём ближайшую сумму не ниже запрошенной, у которой
 * копейки равны номеру. Кассир просил 5 000,47 при номере 17 — получится 5 001,17.
 *
 * Номер 0 не используется: ровные копейки `,00` означали бы «номера нет», и отличить их от
 * запасного пути было бы нечем.
 */
export function seqAmountMinor(askedMinor: Minor, seq: number, minorUnits = 2): Minor {
  const scale = 10n ** BigInt(minorUnits);
  if (!Number.isInteger(seq) || seq <= 0 || BigInt(seq) >= scale) {
    throw new Error(`seqAmountMinor: номер вне диапазона 1..${scale - 1n}`);
  }
  if (askedMinor <= 0n) throw new Error('seqAmountMinor: сумма > 0');
  const candidate = (askedMinor / scale) * scale + BigInt(seq);
  return candidate >= askedMinor ? candidate : candidate + scale;
}

/** Сколько номеров помещается в копейки этой валюты: 99 у двузначной, 9999 у тезера. */
export function maxAmountSeq(minorUnits = 2): number {
  return Number(10n ** BigInt(minorUnits) - 1n);
}

/**
 * 🔴 ЗАПАСНОЙ ПУТЬ: номера кончились (больше 99 оплат провайдера за день) или номерная сумма чем-то
 * занята. Тогда берём ближайшую вверх свободную — различимость важнее читаемости номера.
 *
 * Вверх, а не вниз: клиент платит по QR ровно столько, сколько там написано, и занизить сумму
 * мерчанту нельзя. `limit` ограничивает поиск: если подряд занято слишком много, честнее отказать,
 * чем увести сумму далеко от названной кассиром.
 */
export function uniqueAmountMinor(base: Minor, taken: ReadonlySet<string>, limit = 100): Minor | null {
  if (base <= 0n) throw new Error('uniqueAmountMinor: сумма > 0');
  for (let i = 0; i < limit; i += 1) {
    const candidate = base + BigInt(i);
    if (!taken.has(candidate.toString())) return candidate;
  }
  return null;
}

/**
 * Итоговая сумма QR: номерная, если номер свободен и его сумма не занята; иначе запасной путь.
 * `taken` — суммы оплат этого провайдера за сегодня (и ждущие, и уже оплаченные).
 */
export function qrAmountWithSeq(p: {
  askedMinor: Minor;
  /** Следующий номер дня (1-based). */
  nextSeq: number;
  taken: ReadonlySet<string>;
  minorUnits?: number;
}): { minor: Minor; seq: number | null } | null {
  const units = p.minorUnits ?? 2;
  const max = maxAmountSeq(units);
  for (let seq = p.nextSeq; seq <= max; seq += 1) {
    const minor = seqAmountMinor(p.askedMinor, seq, units);
    if (!p.taken.has(minor.toString())) return { minor, seq };
  }
  const fallback = uniqueAmountMinor(p.askedMinor, p.taken);
  return fallback === null ? null : { minor: fallback, seq: null };
}
