import { describe, expect, it } from 'vitest';
import { formatPayout, formatPayoutMinor, isPayoutAsset, payoutRecordProblem } from './qr-payout';

/** Intl ru-RU группирует неразрывным пробелом — сравниваем по обычному. */
const plain = (s: string) => s.replace(/ /g, ' ');

describe('QR: запись о выдаче клиенту', () => {
  it('🔴 знаки — по валюте выдачи: у тезера четыре, у наличных и рублей два', () => {
    expect(plain(formatPayoutMinor(500_000n, 'USDT'))).toBe('50,0000');
    expect(plain(formatPayoutMinor(200_000n, 'TRY'))).toBe('2 000,00');
    expect(plain(formatPayoutMinor(874_522n, 'RUB'))).toBe('8 745,22');
    expect(plain(formatPayoutMinor(10_000n, 'USD'))).toBe('100,00');
  });

  it('копейки печатаются всегда, разряды разделены', () => {
    expect(plain(formatPayoutMinor(100_000_000n, 'RUB'))).toBe('1 000 000,00');
    expect(plain(formatPayoutMinor(10_000_000_000n, 'USDT'))).toBe('1 000 000,0000');
    expect(plain(formatPayoutMinor(1n, 'USDT'))).toBe('0,0001');
  });

  it('символ валюты — из справочника', () => {
    expect(plain(formatPayout({ currency: 'TRY', minor: 200_000n }))).toBe('2 000,00 ₺');
    expect(plain(formatPayout({ currency: 'USDT', minor: 500_000n }))).toBe('50,0000 ₮');
    expect(plain(formatPayout({ currency: 'RUB', minor: 874_522n }))).toBe('8 745,22 ₽');
    expect(plain(formatPayout({ currency: 'EUR', minor: 5_000n }))).toBe('50,00 €');
  });

  it('валюта выдачи — только из листа пункта', () => {
    expect(isPayoutAsset('USDT')).toBe(true);
    expect(isPayoutAsset('RUB')).toBe(true);
    // Код леджера — не валюта выдачи: в кассе тезер называется одинаково, в какой бы он сети ни был.
    expect(isPayoutAsset('USDT-TRC20')).toBe(false);
    expect(isPayoutAsset('GBP')).toBe(false);
  });

  it('негодная запись названа причиной, а не молча пропущена', () => {
    expect(payoutRecordProblem({ currency: 'TRY', minor: 200_000n })).toBeNull();
    expect(payoutRecordProblem({ currency: 'USDT-TRC20', minor: 1n })).toContain('Валюта выдачи');
    expect(payoutRecordProblem({ currency: 'TRY', minor: 0n })).toContain('больше нуля');
    expect(payoutRecordProblem({ currency: 'TRY', minor: -1n })).toContain('больше нуля');
    // Потолок — миллион ЕДИНИЦ валюты, то есть у тезера свой в минорных единицах.
    expect(payoutRecordProblem({ currency: 'USDT', minor: 10_000_000_000n })).toBeNull();
    expect(payoutRecordProblem({ currency: 'USDT', minor: 10_000_000_001n })).toContain('больше миллиона');
    expect(payoutRecordProblem({ currency: 'RUB', minor: 100_000_001n })).toContain('больше миллиона');
  });
});
