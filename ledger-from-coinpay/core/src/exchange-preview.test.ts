import { describe, expect, it } from 'vitest';
import { quoteExchange, type ExchangeDirection, type RoundingMode } from './exchange';
import { buildExchangeTx } from './manual-ops';

/**
 * Гарантия для кассы (Wave 2): сумма, показанная в форме (quoteExchange), ДО КОПЕЙКИ
 * совпадает с суммой, которую запишет проводка (buildExchangeTx). Кассир называет
 * цифру вслух — расхождение недопустимо. Проверяем на краевых суммах, обоих
 * направлениях, обеих сторонах ввода, обоих округлениях.
 */
const ACC = { clientFrom: 'cf', clientTo: 'ct', positionFrom: 'pf', positionTo: 'pt' };
const AMOUNTS = [1n, 99n, 100n, 333n, 12345n, 9000000n, 100000001n];
const DIRS: ExchangeDirection[] = ['buy_usd', 'sell_usd'];
const SIDES: ('from' | 'to')[] = ['from', 'to'];
const ROUNDINGS: RoundingMode[] = ['bankers', 'platform'];

describe('превью формы === сумма проводки (quoteExchange === buildExchangeTx)', () => {
  it('обе ноги совпадают на всех краевых наборах', () => {
    const baseE6 = 90_150000n;
    const markupBp = 250;
    for (const direction of DIRS) {
      for (const amountSide of SIDES) {
        for (const rounding of ROUNDINGS) {
          for (const amountMinor of AMOUNTS) {
            const q = quoteExchange({ baseE6, markupBp, direction, amountMinor, amountSide, rounding });
            const b = buildExchangeTx({ baseE6, markupBp, direction, amountMinor, amountSide, rounding, accounts: ACC });
            expect(b.fromMinor, `from ${direction}/${amountSide}/${rounding}/${amountMinor}`).toBe(q.fromMinor);
            expect(b.toMinor, `to ${direction}/${amountSide}/${rounding}/${amountMinor}`).toBe(q.toMinor);
            expect(b.dealE6).toBe(q.dealE6);
          }
        }
      }
    }
  });
});
