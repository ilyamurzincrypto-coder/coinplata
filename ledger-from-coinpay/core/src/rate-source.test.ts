import { describe, expect, it } from 'vitest';
import { isManualRateSource, rateSourceLabel } from './rate-source';

describe('подпись источника курса', () => {
  it('🔴 боевой случай: ручной курс USDT не подписывается «ЦБ»', () => {
    // Владелец увидел на тезеровом счёте «ЦБ 90,8161» — числа, которое сам вписал руками.
    expect(rateSourceLabel('manual')).toBe('ручной курс');
    expect(rateSourceLabel('manual')).not.toContain('ЦБ');
  });

  it('официальные источники называются своими именами', () => {
    expect(rateSourceLabel('cbr')).toBe('ЦБ');
    expect(rateSourceLabel('coingecko')).toBe('CoinGecko');
    expect(rateSourceLabel('binance')).toBe('Binance');
    expect(rateSourceLabel('frankfurter')).toBe('ЕЦБ');
  });

  it('регистр и пробелы источника не ломают подпись', () => {
    expect(rateSourceLabel(' CBR ')).toBe('ЦБ');
    expect(rateSourceLabel('Manual')).toBe('ручной курс');
  });

  it('источник неизвестен → нейтральная «база», а не выдуманный ЦБ', () => {
    expect(rateSourceLabel(null)).toBe('база');
    expect(rateSourceLabel(undefined)).toBe('база');
    expect(rateSourceLabel('')).toBe('база');
  });

  it('уже человеческую подпись не портим', () => {
    expect(rateSourceLabel('Frankfurter (ЕЦБ)')).toBe('Frankfurter (ЕЦБ)');
  });

  it('ручной курс распознаётся для сноски', () => {
    expect(isManualRateSource('manual')).toBe(true);
    expect(isManualRateSource('cbr')).toBe(false);
    expect(isManualRateSource(null)).toBe(false);
  });
});
