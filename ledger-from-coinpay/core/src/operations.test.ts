import { describe, expect, it } from 'vitest';
import {
  MOCK_DECLINE_CODES,
  REFUND_DUAL_CONTROL_THRESHOLD_MINOR,
  refundLimitError,
  refundRequiresDualControl,
} from './operations';

describe('refundRequiresDualControl (порог от суммы возврата)', () => {
  it('выше 50 000 ₽ → двухэтапно', () => {
    expect(refundRequiresDualControl(REFUND_DUAL_CONTROL_THRESHOLD_MINOR + 1n)).toBe(true);
  });
  it('ровно порог и ниже → одноэтапно', () => {
    expect(refundRequiresDualControl(REFUND_DUAL_CONTROL_THRESHOLD_MINOR)).toBe(false);
    expect(refundRequiresDualControl(100_00n)).toBe(false);
  });
});

describe('refundLimitError (инвариант возвратов ≤ суммы счёта)', () => {
  it('в пределах — ок', () => {
    expect(refundLimitError(100000n, 0n, 100000n)).toBeNull();
    expect(refundLimitError(100000n, 40000n, 60000n)).toBeNull();
  });
  it('превышение — ошибка', () => {
    expect(refundLimitError(100000n, 40000n, 60001n)).toMatch(/превыс/i);
    expect(refundLimitError(100000n, 100000n, 1n)).toMatch(/превыс/i);
  });
  it('неположительная сумма — ошибка', () => {
    expect(refundLimitError(100000n, 0n, 0n)).toMatch(/положительн/i);
  });
});

describe('MOCK_DECLINE_CODES', () => {
  it('содержит 852/814/810', () => {
    expect([...MOCK_DECLINE_CODES]).toEqual([852, 814, 810]);
  });
});
