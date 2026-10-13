/**
 * QR «Филиал 2»: можно ли фиксировать оплату — и не поздно ли.
 *
 * 🔴 QR у точки СТАТИЧЕСКИЙ. Наш «срок жизни» оплаты — это срок жизни строки в базе, а не срок
 * действия QR у банка: клиент способен отсканировать тот же код через час, и рубли реально придут
 * на ностро. Поэтому автоистечение НЕ имеет права делать пришедшие деньги незаписываемыми —
 * оно лишь убирает висящую оплату из очереди кассы, а фиксация остаётся возможной с явным
 * подтверждением кассира («деньги всё равно пришли?»).
 *
 * 🔴 А вот отмену кассиром фиксировать нельзя никогда: кассир сам сказал, что сделки не было
 * (курс уехал, клиент ушёл), и по такой оплате рубли платформе не приходили. Различить их по
 * одному статусу `expired` невозможно — различает `expiryReason`; NULL означает «закрыто до
 * появления причины», а тогда единственным, кто ставил `expired`, был кассир.
 */

/** Оплату снял кассир кнопкой «Отмена» — фиксации не будет. */
export const QR_EXPIRY_CASHIER = 'cashier';
/** Оплату закрыл крон по времени — фиксация возможна с подтверждением. */
export const QR_EXPIRY_TIMEOUT = 'timeout';

/** Сколько минут оплата ждёт клиента, прежде чем крон уберёт её из очереди кассы. */
export const QR_PENDING_TTL_MINUTES = 30;

export const QR_LATE_CONFIRM_QUESTION = 'Оплата истекла — деньги всё равно пришли?';

/**
 * 🔴 Фиксация БЕЗ квитанции. Квитанция — то, что мы предъявляем провайдеру, когда оплату
 * оспаривают; поэтому фото остаётся рекомендованным путём и стоит первым. Но запрет «нет фото —
 * нет фиксации» останавливал кассу: чек не снялся, клиент ушёл, а деньги уже пришли, и
 * следующего клиента принять нечем. Поэтому выход есть — через прямой вопрос с названным
 * последствием, а не молчаливой кнопкой.
 */
export const QR_NO_RECEIPT_CONFIRM_QUESTION = 'Продолжить без квитанции?';
export const QR_NO_RECEIPT_CONSEQUENCE =
  'Оплату зафиксируем и деньги встанут в путь, но доказать её провайдеру в споре будет нечем: квитанция — единственное подтверждение, что клиент заплатил.';

const REFUSE_CANCELLED = 'Оплата отменена кассиром — зафиксировать нельзя, выбейте новый QR';
const REFUSE_DONE = 'Оплата уже зафиксирована или отменена';
const REFUSE_NOT_FOUND = 'Оплата не найдена';

export type QrFixationVerdict =
  | { ok: true; late: boolean }
  /** `confirm_late` — не отказ, а вопрос кассиру: повторить вызов с `confirmLate`. */
  | { ok: false; code: 'confirm_late' | 'refused'; error: string };

/**
 * Единственное правило «фиксировать или нет» — его зовут и сервер (перед проводками), и касса
 * (чтобы показать подтверждение). Два набора условий разошлись бы, и разойтись им пришлось бы
 * именно на деньгах: одна сторона считала бы оплату живой, другая — закрытой.
 */
export function qrFixationVerdict(
  inv: { provider: string; status: string; expiryReason?: string | null },
  opts: { confirmLate?: boolean } = {},
): QrFixationVerdict {
  if (inv.provider !== 'qr_static') return { ok: false, code: 'refused', error: REFUSE_NOT_FOUND };
  if (inv.status === 'pending') return { ok: true, late: false };
  if (inv.status !== 'expired') return { ok: false, code: 'refused', error: REFUSE_DONE };
  // NULL-причина = наследие: до автоистечения `expired` ставил только кассир.
  if (inv.expiryReason !== QR_EXPIRY_TIMEOUT) return { ok: false, code: 'refused', error: REFUSE_CANCELLED };
  return opts.confirmLate ? { ok: true, late: true } : { ok: false, code: 'confirm_late', error: QR_LATE_CONFIRM_QUESTION };
}

export type QrReceiptVerdict =
  | { ok: true; withoutReceipt: boolean }
  /** `confirm_no_receipt` — не отказ, а вопрос кассиру: повторить вызов с `confirmNoReceipt`. */
  | { ok: false; code: 'confirm_no_receipt'; error: string };

/**
 * Нужна ли квитанция прямо сейчас — правило одно на кассу (показать вопрос) и на сервер (провести
 * проводки). Разойдись они, касса считала бы оплату записанной, а сервер — нет.
 *
 * 🔴 `confirmNoReceipt` при УЖЕ приложенном фото ничего не помечает: отметка описывает факт
 * («в момент фиксации доказательства не было»), а не нажатую кнопку.
 */
export function qrReceiptVerdict(receipts: number, opts: { confirmNoReceipt?: boolean } = {}): QrReceiptVerdict {
  if (receipts > 0) return { ok: true, withoutReceipt: false };
  return opts.confirmNoReceipt
    ? { ok: true, withoutReceipt: true }
    : { ok: false, code: 'confirm_no_receipt', error: QR_NO_RECEIPT_CONFIRM_QUESTION };
}

/** Момент, раньше которого выбитые и не зафиксированные оплаты пора закрывать. */
export function qrExpiryCutoff(now: Date, minutes: number = QR_PENDING_TTL_MINUTES): Date {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('qrExpiryCutoff: срок в минутах > 0');
  return new Date(now.getTime() - minutes * 60_000);
}
