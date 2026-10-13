import { describe, it, expect } from 'vitest';
import {
  rublesToMinor,
  applyRateBp,
  computeFee,
  formatAmount,
  formatRubText,
} from './money';

/** Intl для ru-RU использует неразрывный/узкий пробел — нормализуем для сравнения. */
const norm = (s: string): string => s.replace(/\s/g, ' ');

describe('rublesToMinor', () => {
  it('парсит строку с копейками', () => {
    expect(rublesToMinor('1234.50')).toBe(123450n);
    expect(rublesToMinor('1234,50')).toBe(123450n);
    expect(rublesToMinor('0.05')).toBe(5n);
  });

  it('парсит целые рубли и одну цифру копеек', () => {
    expect(rublesToMinor('1000')).toBe(100000n);
    expect(rublesToMinor('12.5')).toBe(1250n);
  });

  it('парсит number', () => {
    expect(rublesToMinor(1234.5)).toBe(123450n);
    expect(rublesToMinor(99)).toBe(9900n);
  });

  it('отрицательные суммы', () => {
    expect(rublesToMinor('-12.34')).toBe(-1234n);
  });

  it('бросает на мусоре и лишних знаках', () => {
    expect(() => rublesToMinor('abc')).toThrow();
    expect(() => rublesToMinor('1.234')).toThrow();
    expect(() => rublesToMinor('')).toThrow();
    expect(() => rublesToMinor(NaN)).toThrow();
    expect(() => rublesToMinor(Infinity)).toThrow();
  });
});

describe('applyRateBp', () => {
  it('считает процент через bp', () => {
    // 1% от 10000.00 руб = 100.00 руб
    expect(applyRateBp(1000000n, 100)).toBe(10000n);
    expect(applyRateBp(123450n, 250)).toBe(3086n); // 2.5%: 123450*250/10000 = 3086.25 → floor
  });

  it('округляет вниз (floor)', () => {
    expect(applyRateBp(999n, 100)).toBe(9n); // 9.99 → 9
    expect(applyRateBp(1n, 9999)).toBe(0n);
  });

  it('нулевая ставка → 0n', () => {
    expect(applyRateBp(123456n, 0)).toBe(0n);
  });

  it('бросает на дробном или отрицательном bp', () => {
    expect(() => applyRateBp(100n, 1.5)).toThrow();
    expect(() => applyRateBp(100n, -1)).toThrow();
  });
});

describe('computeFee', () => {
  it('берёт процент, когда он выше минимума', () => {
    expect(computeFee(1000000n, 100, 500n)).toBe(10000n);
  });

  it('min fee срабатывает при маленькой сумме', () => {
    // 1% от 10.00 руб = 10 коп., минимум 5.00 руб
    expect(computeFee(1000n, 100, 500n)).toBe(500n);
  });

  it('равенство — возвращает минимум (тот же результат)', () => {
    expect(computeFee(50000n, 100, 500n)).toBe(500n);
  });
});

describe('formatAmount', () => {
  // (правка владельца 25.08.2026) Копейки показываются ВСЕГДА — скрытие при ,00 убрано.
  it('ровная сумма всё равно отдаёт копейки «00»', () => {
    const f = formatAmount(123400n);
    expect(f.minor).toBe('00');
    expect(norm(f.major)).toBe('1 234');
  });

  it('ненулевые копейки', () => {
    const f = formatAmount(123456n);
    expect(f.minor).toBe('56');
    expect(norm(f.major)).toBe('1 234');
  });

  it('группировка разрядов как в ru-RU', () => {
    const f = formatAmount(123456789012n);
    expect(norm(f.major)).toBe('1 234 567 890');
    expect(f.minor).toBe('12');
  });

  it('отрицательные: минус в major', () => {
    const f = formatAmount(-123450n);
    expect(norm(f.major)).toBe('-1 234');
    expect(f.minor).toBe('50');
  });

  it('ноль', () => {
    const f = formatAmount(0n);
    expect(f.major).toBe('0');
    expect(f.minor).toBe('00');
  });

  it('копейки < 10 дополняются нулём', () => {
    expect(formatAmount(105n).minor).toBe('05');
  });
});

describe('formatRubText', () => {
  it('с копейками', () => {
    expect(norm(formatRubText(123450n))).toBe('1 234,50 ₽');
  });

  it('ровная сумма — «,00», а не голые рубли', () => {
    expect(norm(formatRubText(123400n))).toBe('1 234,00 ₽');
  });

  it('ноль — «0,00 ₽»', () => {
    expect(norm(formatRubText(0n))).toBe('0,00 ₽');
  });

  it('отрицательная сумма', () => {
    expect(norm(formatRubText(-999999n))).toBe('-9 999,99 ₽');
  });
});
