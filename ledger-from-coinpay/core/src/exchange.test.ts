import { describe, expect, it } from 'vitest';
import { dealRateForDirection, needsMandatoryControl, quoteExchange, rateGuardExceeded, rubEquivalentMinor } from './exchange';

describe('dealRateForDirection', () => {
  it('buy_usd — база×(1+наценка) вверх; sell_usd — база×(1−наценка) вниз', () => {
    expect(dealRateForDirection(90_000000n, 200, 'buy_usd')).toBe(91_800000n); // 90×1.02
    expect(dealRateForDirection(90_000000n, 200, 'sell_usd')).toBe(88_200000n); // 90×0.98
    expect(dealRateForDirection(90_123400n, 0, 'buy_usd')).toBe(90_123400n);
  });
  it('наценка ≥ 100% при продаже — ошибка', () => {
    expect(() => dealRateForDirection(90_000000n, 10000, 'sell_usd')).toThrow();
  });
});

describe('quoteExchange', () => {
  it('buy USD, задана сумма USD (to): 1000$ по 91.80 = 91 800 ₽ ровно', () => {
    const q = quoteExchange({ baseE6: 90_000000n, markupBp: 200, direction: 'buy_usd', amountMinor: 100000n, amountSide: 'to', rounding: 'bankers' });
    expect(q.dealE6).toBe(91_800000n);
    expect(q.fromCurrency).toBe('RUB');
    expect(q.toCurrency).toBe('USD');
    expect(q.fromMinor).toBe(9180000n); // 91 800,00 ₽
    expect(q.toMinor).toBe(100000n); // 1000,00 $
  });
  it('buy USD, задано 10 000 ₽ (from): получает floor/bankers(10893.24)=10893 коп-USD', () => {
    const q = quoteExchange({ baseE6: 90_000000n, markupBp: 200, direction: 'buy_usd', amountMinor: 1_000000n, amountSide: 'from', rounding: 'bankers' });
    expect(q.toMinor).toBe(10893n); // 108,93 $
  });
  it('sell USD, задано 1000$ (from): получает 88 200 ₽ по 88.20', () => {
    const q = quoteExchange({ baseE6: 90_000000n, markupBp: 200, direction: 'sell_usd', amountMinor: 100000n, amountSide: 'from', rounding: 'bankers' });
    expect(q.fromCurrency).toBe('USD');
    expect(q.toMinor).toBe(8820000n); // 88 200,00 ₽
  });
  it('platform-округление: клиент получает — floor, платит — ceil', () => {
    const buyP = quoteExchange({ baseE6: 90_150000n, markupBp: 0, direction: 'buy_usd', amountMinor: 1_000000n, amountSide: 'from', rounding: 'platform' });
    const buyB = quoteExchange({ baseE6: 90_150000n, markupBp: 0, direction: 'buy_usd', amountMinor: 1_000000n, amountSide: 'from', rounding: 'bankers' });
    // 1e12 / 90150000 = 11092.6... platform floor 11092; bankers round 11093
    expect(buyP.toMinor).toBe(11092n);
    expect(buyB.toMinor).toBe(11093n);
  });
});

describe('rateGuardExceeded (±%)', () => {
  it('в пределах guard — false', () => {
    expect(rateGuardExceeded(91_800000n, 90_000000n, 10)).toBe(false); // 2%
    expect(rateGuardExceeded(99_000000n, 90_000000n, 10)).toBe(false); // ровно 10% → не превышение
  });
  it('за пределами — true', () => {
    expect(rateGuardExceeded(100_000000n, 90_000000n, 10)).toBe(true); // 11.1%
    expect(rateGuardExceeded(80_000000n, 90_000000n, 10)).toBe(true); // −11.1%
  });
});

describe('needsMandatoryControl (порог 600 000 ₽)', () => {
  const T = 60_000000n; // 600 000 ₽
  it('RUB напрямую, граница включительно', () => {
    expect(needsMandatoryControl(60_000000n, 'RUB', 90_000000n, T)).toBe(true);
    expect(needsMandatoryControl(59_999999n, 'RUB', 90_000000n, T)).toBe(false);
  });
  it('USD — эквивалент по курсу', () => {
    // 7000$ × 90 = 630 000 ₽ ≥ порога
    expect(needsMandatoryControl(700000n, 'USD', 90_000000n, T)).toBe(true);
    // 1000$ × 90 = 90 000 ₽ < порога
    expect(needsMandatoryControl(100000n, 'USD', 90_000000n, T)).toBe(false);
  });
});

/**
 * 🔴 Тот же дефект «два знака у всех», что поймали на конверсионной выплате
 * (`payout-conversion.ts`), жил и здесь — латентно: USDT-обмен ещё не заводили, поэтому
 * на боевом он не выстрелил. Закрываем до того, как выстрелит.
 */
describe('обмен: у не-рублёвой ноги СВОЁ число знаков', () => {
  const common = { baseE6: 85_000000n, markupBp: 0, rounding: 'platform' as const };

  it('🔴 тезер: 100 000,00 ₽ по 85 ₽/₮ — это 1 176,47 ₮, а не 11,7647 ₮', () => {
    const q = quoteExchange({
      ...common,
      direction: 'buy_usd',
      amountMinor: 100_000_00n, // 100 000,00 ₽
      amountSide: 'from',
      foreignCurrency: 'USDT-TRC20',
    });
    // 100 000 / 85 = 1 176,4705… ₮ → 11 764 705 минорных единиц (4 знака).
    expect(q.toMinor).toBe(11_764_705n);
    expect(q.toMinor).not.toBe(117_647n); // столько дала бы прежняя формула
    expect(q.toCurrency).toBe('USDT-TRC20');
  });

  it('🔴 обратная сторона симметрична: задаём тезеры — получаем те же рубли', () => {
    const q = quoteExchange({
      ...common,
      direction: 'sell_usd',
      amountMinor: 11_764_705n, // 1 176,4705 ₮
      amountSide: 'from',
      foreignCurrency: 'USDT-TRC20',
    });
    // 1 176,4705 × 85 = 99 999,99… ₽ (вниз, в пользу платформы).
    expect(q.toMinor).toBe(99_999_99n);
  });

  it('доллар считается как прежде — знаков и правда два', () => {
    const q = quoteExchange({ ...common, direction: 'buy_usd', amountMinor: 100_000_00n, amountSide: 'from', foreignCurrency: 'USD' });
    expect(q.toMinor).toBe(117_647n); // 1 176,47 $
  });

  it('число знаков из справочника побеждает запасной список', () => {
    const q = quoteExchange({ ...common, direction: 'buy_usd', amountMinor: 100_000_00n, amountSide: 'from', foreignCurrency: 'USDT-TRC20', foreignMinorUnits: 2 });
    expect(q.toMinor).toBe(117_647n);
  });
});

/**
 * 🔴 Обязательный контроль — реестр, который выгружается НАРУЖУ, поэтому у него две смертельные
 * ошибки, и обе тут закрыты по величине:
 *   • чужой масштаб (сумма четырёхзначной валюты оценивалась как двузначная) → порог 600 000 ₽
 *     пробивался ложно на суммах в сто раз меньше;
 *   • fail-open: нет строки курса → rateE6 = 0 → оценка 0 ₽ → контроль не срабатывал НИКОГДА.
 */
describe('обязательный контроль: свой курс, свой масштаб, fail-closed', () => {
  const T = 60_000000n; // порог 600 000 ₽

  it('🔴 тезер: 218,5224 ₮ по 84,50 = 18 465,14 ₽ — порог НЕ пробит', () => {
    expect(rubEquivalentMinor(2_185_224n, 'USDT-TRC20', 84_500_000n)).toBe(1_846_514n);
    expect(needsMandatoryControl(2_185_224n, 'USDT-TRC20', 84_500_000n, T)).toBe(false);
    // Прежняя формула (масштаб рубля) давала 1 846 514,28 ₽ — в сто раз больше порога.
    expect((2_185_224n * 84_500_000n) / 1_000_000n).toBe(184_651_428n);
  });

  it('🔴 лира считается по СВОЕЙ паре: 70 000,00 ₺ по 2,10 = 147 000 ₽, а не по курсу доллара', () => {
    expect(rubEquivalentMinor(7_000_000n, 'TRY', 2_100_000n)).toBe(14_700_000n);
    expect(needsMandatoryControl(7_000_000n, 'TRY', 2_100_000n, T)).toBe(false);
    // По курсу доллара (84,50) те же лиры оценивались в 5 915 000 ₽ — завышение в 40 раз.
    expect(rubEquivalentMinor(7_000_000n, 'TRY', 84_500_000n)).toBe(591_500_000n);
  });

  it('🔴 курса нет → операция ПОМЕЧАЕТСЯ контролем, а не проходит мимо', () => {
    expect(rubEquivalentMinor(2_185_224n, 'USDT-TRC20', 0n)).toBeNull();
    expect(needsMandatoryControl(2_185_224n, 'USDT-TRC20', 0n, T)).toBe(true);
    // Прежде это была тишина: 0 ₽ < порога → false на любой сумме.
    expect((2_185_224n * 0n) / 1_000_000n).toBe(0n);
  });

  it('крупная тезерная сумма порог всё-таки пробивает (контроль не «выключен»)', () => {
    // 8 000,0000 ₮ × 84,50 = 676 000 ₽.
    expect(rubEquivalentMinor(80_000_000n, 'USDT-TRC20', 84_500_000n)).toBe(67_600_000n);
    expect(needsMandatoryControl(80_000_000n, 'USDT-TRC20', 84_500_000n, T)).toBe(true);
  });
});
