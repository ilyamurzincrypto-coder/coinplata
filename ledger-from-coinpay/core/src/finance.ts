/**
 * Финансы: выплаты, резервы, сверка — ЧИСТЫЕ функции.
 * Деньги — только копейки (bigint). Все проводки балансируются в 0n.
 */

import type { Minor } from './money';
import { formatMoneyText } from './money';
import { assertBalanced, type EntryDraft, type TxDraft } from './ledger';

/**
 * Порог двухэтапности ВЫПЛАТЫ — 100 000 ₽. ОТДЕЛЬНЫЙ от порога возврата
 * (см. REFUND_DUAL_CONTROL_THRESHOLD_MINOR): возврат ограничен суммой счёта и
 * инициируется извне, выплата — вывод накопленного, риски разные.
 */
export const PAYOUT_DUAL_CONTROL_THRESHOLD_MINOR: Minor = 10_000_000n;

export function payoutRequiresDualControl(amountMinor: Minor): boolean {
  return amountMinor > PAYOUT_DUAL_CONTROL_THRESHOLD_MINOR;
}

export interface PayoutGuardInput {
  amountMinor: Minor;
  availableMinor: Minor;
  /** true, если статус мерчанта frozen_payouts или frozen_all. */
  payoutsFrozen: boolean;
  /**
   * 🔴 Валюта суммы. Не оформление: текст отказа называет ЧИСЛО, и число это — в валюте выплаты.
   *
   * Пока гард был рублёвым, отказ по тезеру печатался рублёвым форматтером: доступные 218,5224 ₮
   * (2 185 224 минорных единицы) выходили как «21 852,24 ₽» — чужая валюта и ошибка в сто раз, в
   * той самой строке, по которой оператор решает, что делать дальше. По умолчанию рубль — весь
   * прежний тракт выплат рублёвый, и его сообщения не меняются ни на символ.
   */
  currency?: string;
  /** Знаков у валюты из справочника (`currencies.minor_units`); нет — запасной список ядра. */
  minorUnits?: number;
}

/**
 * Проверка возможности выплаты. Возвращает текст ошибки или null.
 * Заморозка выплат блокирует выплату В ЛЮБОМ размере (смычка A5↔A6) —
 * проверяется ПЕРВОЙ, до суммы.
 */
export function payoutError(input: PayoutGuardInput): string | null {
  if (input.payoutsFrozen) {
    return 'Выплаты мерчанта заморожены — выплата невозможна в любом размере';
  }
  if (input.amountMinor <= 0n) {
    return 'Сумма выплаты должна быть положительной';
  }
  if (input.amountMinor > input.availableMinor) {
    return `Недостаточно доступных средств (доступно ${formatMoneyText(input.availableMinor, input.currency ?? 'RUB', input.minorUnits)})`;
  }
  return null;
}

export interface PayoutAccounts {
  merchantSettlement: string;
  platformPayable: string;
}

/** Удержание при создании выплаты: settlement → payable (деньги «в пути»). */
export function buildPayoutHoldTx(p: {
  amountMinor: Minor;
  accounts: PayoutAccounts;
  idempotencyKey?: string;
}): TxDraft {
  if (p.amountMinor <= 0n) {
    throw new Error(`buildPayoutHoldTx: сумма должна быть положительной, получено ${p.amountMinor}`);
  }
  const entries: EntryDraft[] = [
    { accountId: p.accounts.merchantSettlement, amountMinor: -p.amountMinor },
    { accountId: p.accounts.platformPayable, amountMinor: p.amountMinor },
  ];
  assertBalanced(entries);
  const tx: TxDraft = { kind: 'payout', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return tx;
}

/** Откат при failed: payable → settlement (деньги вернулись мерчанту). */
export function buildPayoutReversalTx(p: {
  amountMinor: Minor;
  accounts: PayoutAccounts;
  idempotencyKey?: string;
}): TxDraft {
  if (p.amountMinor <= 0n) {
    throw new Error(`buildPayoutReversalTx: сумма должна быть положительной, получено ${p.amountMinor}`);
  }
  const entries: EntryDraft[] = [
    { accountId: p.accounts.platformPayable, amountMinor: -p.amountMinor },
    { accountId: p.accounts.merchantSettlement, amountMinor: p.amountMinor },
  ];
  assertBalanced(entries);
  const tx: TxDraft = { kind: 'payout', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return tx;
}

export interface ReserveAccounts {
  merchantSettlement: string;
  merchantHold: string;
}

/** Удержание резерва: settlement → hold. */
export function buildReserveHoldTx(p: {
  amountMinor: Minor;
  accounts: ReserveAccounts;
  idempotencyKey?: string;
}): TxDraft {
  if (p.amountMinor <= 0n) {
    throw new Error(`buildReserveHoldTx: сумма должна быть положительной, получено ${p.amountMinor}`);
  }
  const entries: EntryDraft[] = [
    { accountId: p.accounts.merchantSettlement, amountMinor: -p.amountMinor },
    { accountId: p.accounts.merchantHold, amountMinor: p.amountMinor },
  ];
  assertBalanced(entries);
  const tx: TxDraft = { kind: 'reserve_hold', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return tx;
}

/** Освобождение резерва: hold → settlement (по истечении hold_days). */
export function buildReserveReleaseTx(p: {
  amountMinor: Minor;
  accounts: ReserveAccounts;
  idempotencyKey?: string;
}): TxDraft {
  if (p.amountMinor <= 0n) {
    throw new Error(`buildReserveReleaseTx: сумма должна быть положительной, получено ${p.amountMinor}`);
  }
  const entries: EntryDraft[] = [
    { accountId: p.accounts.merchantHold, amountMinor: -p.amountMinor },
    { accountId: p.accounts.merchantSettlement, amountMinor: p.amountMinor },
  ];
  assertBalanced(entries);
  const tx: TxDraft = { kind: 'reserve_release', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return tx;
}

/** Дисбаланс транзакции: сумма проводок. 0n — сходится, иначе — проблема. */
export function txImbalance(entries: ReadonlyArray<{ amountMinor: Minor }>): Minor {
  let sum = 0n;
  for (const e of entries) sum += e.amountMinor;
  return sum;
}

// ── Сверка ───────────────────────────────────────────────────────────────

export type DiscrepancyKind =
  | 'status_mismatch'
  | 'amount_mismatch'
  | 'missing_local'
  | 'missing_provider'
  | 'balance_mismatch';

export interface ReconRecord {
  orderId: string;
  /** Статус в НАШЕЙ модели (у провайдера — уже смаппленный). */
  status: string;
  amountMinor: Minor;
}

export interface Discrepancy {
  kind: DiscrepancyKind;
  orderId: string;
  details: Record<string, unknown>;
}

/**
 * Классифицирует расхождение по одному заказу: наша запись vs запись провайдера
 * (статус уже приведён к нашей модели). null — всё сходится.
 */
export function classifyInvoiceDiscrepancy(
  ours: ReconRecord | null,
  provider: ReconRecord | null,
): Discrepancy | null {
  if (ours && !provider) {
    return { kind: 'missing_provider', orderId: ours.orderId, details: { ourStatus: ours.status } };
  }
  if (!ours && provider) {
    return {
      kind: 'missing_local',
      orderId: provider.orderId,
      details: { providerStatus: provider.status },
    };
  }
  if (!ours || !provider) return null;
  if (ours.status !== provider.status) {
    return {
      kind: 'status_mismatch',
      orderId: ours.orderId,
      details: { ours: ours.status, provider: provider.status },
    };
  }
  if (ours.amountMinor !== provider.amountMinor) {
    return {
      kind: 'amount_mismatch',
      orderId: ours.orderId,
      details: {
        oursMinor: ours.amountMinor.toString(),
        providerMinor: provider.amountMinor.toString(),
      },
    };
  }
  return null;
}

/** Сверка баланса: наш леджер vs get-balance провайдера. */
export function classifyBalanceDiscrepancy(
  ourMinor: Minor,
  providerMinor: Minor,
): Discrepancy | null {
  if (ourMinor === providerMinor) return null;
  return {
    kind: 'balance_mismatch',
    orderId: '—',
    details: { oursMinor: ourMinor.toString(), providerMinor: providerMinor.toString() },
  };
}
