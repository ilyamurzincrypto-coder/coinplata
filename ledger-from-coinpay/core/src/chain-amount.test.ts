import { describe, expect, it } from 'vitest';
import { chainToMinorExact, minorToChain, payableExactly } from './chain-amount';

/**
 * 🔴 Знаки сети и знаки книги — разные числа. У USDT 6 в TRON и Ethereum, 18 в BNB Chain, у нас
 * в книге 4. Ошибка здесь стоит до 10^14 и инвариантом Σ=0 не ловится: обе ноги проводки будут
 * неверны одинаково. Поэтому у каждой сети здесь свой случай, а не «проверили на рублях».
 */
describe('граница сети и книги', () => {
  const BOOK = 4;

  describe('TRON и Ethereum — 6 знаков', () => {
    it('218,5224 ₮ туда и обратно', () => {
      expect(minorToChain(2_185_224n, 6, BOOK)).toBe(218_522_400n);
      expect(chainToMinorExact(218_522_400n, 6, BOOK)).toBe(2_185_224n);
    });

    it('🔴 лишние знаки из сети НЕ округляются — это null', () => {
      // 1,234567 ₮ в сети: книга держит четыре знака, тихо записать 1,2346 нельзя.
      expect(chainToMinorExact(1_234_567n, 6, BOOK)).toBeNull();
      expect(chainToMinorExact(1_234_500n, 6, BOOK)).toBe(12_345n);
    });
  });

  describe('🔴 BNB Chain — 18 знаков, множитель 10^14', () => {
    it('одна монета это 10^18, а не 10^6', () => {
      expect(minorToChain(10_000n, 18, BOOK)).toBe(1_000_000_000_000_000_000n);
    });

    it('218,5224 ₮ туда и обратно без потери знаков', () => {
      const chain = minorToChain(2_185_224n, 18, BOOK)!;
      expect(chain).toBe(218_522_400_000_000_000_000n);
      expect(chainToMinorExact(chain, 18, BOOK)).toBe(2_185_224n);
    });

    it('пыль ниже нашей минорной единицы не представима', () => {
      expect(chainToMinorExact(1n, 18, BOOK)).toBeNull();
    });

    /** Вот цена ошибки: прочитать 18-значную сумму как 6-значную. */
    it('ошибка «зашили 6 вместо 18» даёт промах в 10^12', () => {
      const chain = minorToChain(10_000n, 18, BOOK)!; // 1 ₮
      const верно = chainToMinorExact(chain, 18, BOOK);
      const неверно = chainToMinorExact(chain, 6, BOOK);
      expect(верно).toBe(10_000n);
      expect(неверно).toBe(10_000_000_000_000_000n); // в 10^12 раз больше
    });
  });

  it('TRX — 6 знаков, та же механика', () => {
    expect(minorToChain(13_0000n, 6, BOOK)).toBe(13_000_000n); // 13,0000 TRX
    expect(chainToMinorExact(13_000_000n, 6, BOOK)).toBe(13_0000n);
  });

  it('знаки совпадают — число не меняется', () => {
    expect(minorToChain(12_345n, 4, 4)).toBe(12_345n);
    expect(chainToMinorExact(12_345n, 4, 4)).toBe(12_345n);
  });

  it('у книги знаков больше — перевод в сеть возможен только для кратных', () => {
    expect(minorToChain(12_345n, 2, 4)).toBeNull(); // 1,2345 не представимо при двух знаках
    expect(minorToChain(12_300n, 2, 4)).toBe(123n);
    expect(chainToMinorExact(123n, 2, 4)).toBe(12_300n);
  });

  it('ноль остаётся нулём в любых знаках', () => {
    expect(minorToChain(0n, 18, BOOK)).toBe(0n);
    expect(chainToMinorExact(0n, 18, BOOK)).toBe(0n);
  });

  it('бессмысленные знаки — ошибка, а не молчаливая подстановка', () => {
    for (const [c, m] of [[-1, 4], [4, -1], [37, 4], [4, 37], [1.5, 4]] as const) {
      expect(() => minorToChain(1n, c, m), `${c}/${m}`).toThrow();
    }
  });

  describe('payableExactly — правило выплат', () => {
    it('сумма книги всегда отправима, когда у сети знаков не меньше', () => {
      expect(payableExactly(2_185_224n, 6, BOOK)).toBe(true);
      expect(payableExactly(2_185_224n, 18, BOOK)).toBe(true);
    });
    it('и не отправима, когда у сети знаков меньше, а сумма не кратна', () => {
      expect(payableExactly(12_345n, 2, BOOK)).toBe(false);
    });
  });
});
