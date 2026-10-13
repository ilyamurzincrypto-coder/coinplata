/**
 * Операции: пороги и инварианты возвратов (чистые функции).
 */
import type { Minor } from './money';

/** Возврат на сумму выше порога требует двухэтапного подтверждения. */
export const REFUND_DUAL_CONTROL_THRESHOLD_MINOR: Minor = 5_000_000n; // 50 000 ₽

/** Порог считается от СУММЫ ВОЗВРАТА, не от суммы счёта. */
export function refundRequiresDualControl(refundAmountMinor: Minor): boolean {
  return refundAmountMinor > REFUND_DUAL_CONTROL_THRESHOLD_MINOR;
}

/**
 * Инвариант частичного возврата: сумма всех возвратов по счёту ≤ суммы счёта,
 * и сам возврат положительный. Возвращает текст ошибки или null (можно).
 */
export function refundLimitError(
  invoiceAmountMinor: Minor,
  alreadyRefundedMinor: Minor,
  refundAmountMinor: Minor,
): string | null {
  if (refundAmountMinor <= 0n) return 'Сумма возврата должна быть положительной';
  if (alreadyRefundedMinor + refundAmountMinor > invoiceAmountMinor) {
    return 'Сумма возвратов превысила бы сумму счёта';
  }
  return null;
}

/** Коды СБП, доступные для симуляции отклонения (mock-режим). */
export const MOCK_DECLINE_CODES = [852, 814, 810] as const;
export type MockDeclineCode = (typeof MOCK_DECLINE_CODES)[number];
