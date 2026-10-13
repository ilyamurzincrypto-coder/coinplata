import { describe, expect, it } from 'vitest';
import { carryForward, isRateAnomaly, rateDeltaBp, RATE_SPIKE_CRYPTO_BP, RATE_SPIKE_FIAT_BP } from './rates';

// (Волна9.5 R4) Санити курса перед фиксацией: мусор (0/отрицательный/скачок) НЕ пишется —
// держим последний с пометкой «источник дал аномалию»; первый курс — «первичный».
describe('R4 санити курса', () => {
  const last = { rateE6: 90_000000n, rateDate: '2026-07-30' }; // 90 ₽/$ вчера

  it('ноль/отрицательное — аномалия при любом пороге', () => {
    expect(isRateAnomaly(0n, last.rateE6, RATE_SPIKE_FIAT_BP)).toBe(true);
    expect(isRateAnomaly(-5n, last.rateE6, RATE_SPIKE_FIAT_BP)).toBe(true);
  });

  it('фиатный порог 20%: +30% — аномалия, +10% — норма', () => {
    expect(isRateAnomaly(117_000000n, last.rateE6, RATE_SPIKE_FIAT_BP)).toBe(true); // +30%
    expect(isRateAnomaly(99_000000n, last.rateE6, RATE_SPIKE_FIAT_BP)).toBe(false); // +10%
  });

  it('крипта-порог 50%: +30% допустимо (волатильность), +60% — аномалия', () => {
    expect(isRateAnomaly(117_000000n, last.rateE6, RATE_SPIKE_CRYPTO_BP)).toBe(false); // +30% ок для крипты
    expect(isRateAnomaly(144_000000n, last.rateE6, RATE_SPIKE_CRYPTO_BP)).toBe(true); // +60%
  });

  it('скачок 1000× — аномалия: курс НЕ пишется, держим последний + отклонение % в источнике', () => {
    const spike = 90_000_000000n;
    const q = carryForward('RUB/USD', spike, 'CoinGecko', last, RATE_SPIKE_FIAT_BP);
    expect(q?.rateE6).toBe(last.rateE6); // мусор не записан
    expect(q?.source).toMatch(/аномали/i);
    expect(q?.source).toMatch(/отклонение/i);
  });

  it('нормальное движение фиксируется своим значением', () => {
    const q = carryForward('RUB/USD', 92_700000n, 'CoinGecko', last, RATE_SPIKE_FIAT_BP);
    expect(q?.rateE6).toBe(92_700000n);
    expect(q?.source).toBe('CoinGecko');
  });

  it('первый курс (нет базы) — фиксируется с пометкой «первичный», если > 0', () => {
    expect(isRateAnomaly(90_000000n, null, RATE_SPIKE_FIAT_BP)).toBe(false);
    const q = carryForward('BTC/USD', 65_000_000000n, 'CoinGecko', null, RATE_SPIKE_CRYPTO_BP);
    expect(q?.rateE6).toBe(65_000_000000n);
    expect(q?.source).toMatch(/первичный/i);
  });

  it('rateDeltaBp: +20% = 2000 bp; нет базы → null', () => {
    expect(rateDeltaBp(108_000000n, 90_000000n)).toBe(2000);
    expect(rateDeltaBp(90_000000n, null)).toBeNull();
  });
});
