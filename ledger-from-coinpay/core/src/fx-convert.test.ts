import { describe, expect, it } from 'vitest';
import { sumUsdMinor, toEurMinor, toUsdMinor } from './fx-convert';

// 1 USD = 78,00 RUB → rubPerUsdE6 = 78_000000
const R = { rubPerUsdE6: 78_000000n };
const RE = { rubPerUsdE6: 78_000000n, rubPerEurE6: 91_000000n }; // 1 EUR = 91 RUB

describe('fx-convert (витрина $/€, леджер не трогает)', () => {
  it('USD→USD = identity', () => expect(toUsdMinor(150_00n, 'USD', R)).toBe(150_00n));
  it('RUB→USD по курсу (7800 RUB / 78 = 100 USD)', () => expect(toUsdMinor(7800_00n, 'RUB', R)).toBe(100_00n));
  it('крипта без курса → null', () => expect(toUsdMinor(1000_000000n, 'USDT-TRC20', R)).toBeNull());
  it('евро без курса (до (к)) → null', () => {
    expect(toEurMinor(100_00n, 'USD', R)).toBeNull();
    expect(toUsdMinor(9100_00n, 'EUR', R)).toBeNull(); // EUR без rubPerEurE6 → null
  });
  it('с курсом евро: RUB→EUR (9100/91=100), USD→EUR через RUB', () => {
    expect(toEurMinor(9100_00n, 'RUB', RE)).toBe(100_00n);
    expect(toEurMinor(91_00n, 'USD', RE)).toBe(78_00n); // 91 USD ×78/91 = 78 EUR
  });
  it('Итого $ складывает столбиком (тест эксперта)', () => {
    const rows = [{ amountMinor: 100_00n, currency: 'USD' }, { amountMinor: 7800_00n, currency: 'RUB' }];
    expect(sumUsdMinor(rows, R)).toBe(200_00n); // 100 + 100
  });
});
