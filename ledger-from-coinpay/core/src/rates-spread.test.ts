import { describe, expect, it } from 'vitest';
import { applySpread, effectiveSpreadBp, crossExpectedRubPerTryE6, crossDeviationBp, e6 } from './rates';

/**
 * (С8-2) Эталонный тест курсового спреда — ЧИСЛА ЭКСПЕРТА с созвона (его калькулятор = наш эталон):
 * RUB/USD 82,60 × 1,045 = 86,32 · RUB/TRY 1,7366 × 1,045 = 1,8147 · кросс 86,32 ÷ 1,8147 = 47,57 (TRY/USD).
 * Спред 4,5% (450 bp). Копейка-в-копейку по rate_e6.
 */
describe('курсовой спред — числа эксперта (С8-2)', () => {
  const SPREAD_BP = 450; // 4,5%

  it('RUB/USD: база 82,60 × 1,045 = 86,32 (E6 86_317_000)', () => {
    const base = e6(82.6); // 82_600_000
    const shown = applySpread(base, SPREAD_BP);
    expect(shown).toBe(86_317_000n);
    expect(Number(shown) / 1e6).toBeCloseTo(86.32, 2);
  });

  it('RUB/TRY: база 1,7366 × 1,045 = 1,8147 (E6 1_814_747)', () => {
    const base = e6(1.7366); // 1_736_600
    const shown = applySpread(base, SPREAD_BP);
    expect(shown).toBe(1_814_747n);
    expect(Number(shown) / 1e6).toBeCloseTo(1.8147, 4);
  });

  it('кросс-инвариант: наш RUB/USD ÷ наш RUB/TRY ≈ рыночный USD/TRY 47,57, в допуске', () => {
    const rubUsd = applySpread(e6(82.6), SPREAD_BP); // 86_317_000
    const rubTry = applySpread(e6(1.7366), SPREAD_BP); // 1_814_747
    // TRY за 1 USD = RUB/USD ÷ RUB/TRY
    const usdTry = (rubUsd * 1_000_000n) / rubTry;
    expect(Number(usdTry) / 1e6).toBeCloseTo(47.57, 1);
    // Обратно: ожидаемый RUB/TRY из рыночного USD/TRY 47,57 ≈ наш RUB/TRY (спред сокращается в отношении).
    const expected = crossExpectedRubPerTryE6(rubUsd, e6(47.57));
    const devBp = crossDeviationBp(rubTry, expected);
    expect(devBp).not.toBeNull();
    expect(devBp!).toBeLessThan(50); // < 0,5% — в допуске (округление)
  });

  it('разовый спред «поверх» постоянного суммируется; null → только постоянный', () => {
    expect(effectiveSpreadBp(450, 200)).toBe(650); // волатильный день: 4,5% + 2%
    expect(effectiveSpreadBp(450, null)).toBe(450);
    // витрина с разовым: 82,60 × (1 + 6,5%) = 87,969
    expect(applySpread(e6(82.6), effectiveSpreadBp(450, 200))).toBe(87_969_000n);
  });
});
