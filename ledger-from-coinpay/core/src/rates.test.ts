import { describe, expect, it } from 'vitest';
import { carryForward, deriveRubPerEurE6, e6 } from './rates';

describe('rates — чистая логика (Волна 4 к)', () => {
  it('e6 округляет к ×1e6', () => expect(e6(1.1389)).toBe(1_138_900n));

  it('RUB/EUR выводится из RUB/USD × USD-per-EUR', () => {
    // 78,0172 RUB/USD × 1,1389 USD/EUR = 88,86 RUB/EUR
    const rubEur = deriveRubPerEurE6(78_017200n, e6(1.1389));
    expect(rubEur).toBe(88_853789n); // 78.0172×1.1389 = 88.853789 (integer ×1e6)
  });

  it('carry-forward: свежий курс → он', () => {
    // (R4) первый курс (нет базы) фиксируется с пометкой «первичный».
    expect(carryForward('RUB/USD', 78_000000n, 'CoinGecko', null)).toEqual({ pair: 'RUB/USD', rateE6: 78_000000n, source: 'CoinGecko · первичный' });
  });
  it('carry-forward: источник недоступен → перенос последнего с пометкой', () => {
    const q = carryForward('RUB/EUR', null, 'Frankfurter', { rateE6: 88_800000n, rateDate: '2026-07-25' });
    expect(q).toEqual({ pair: 'RUB/EUR', rateE6: 88_800000n, source: 'перенос с 2026-07-25' });
  });
  it('carry-forward: нет свежего и нет последнего → null', () => {
    expect(carryForward('X/Y', null, 's', null)).toBeNull();
  });
});
