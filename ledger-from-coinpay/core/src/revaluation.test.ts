import { describe, expect, it } from 'vitest';
import { buildRevaluationTx } from './revaluation';

const ACC = { countervalue: 'cv', revalPnl: 'pnl' };

describe('buildRevaluationTx — дельта, знак, инвариант', () => {
  it('переоценка позиции −1000$ по 90.00: контрвалюта −90 000 ₽, обе ноги RUB, Σ=0', () => {
    const r = buildRevaluationTx({ usdPositionMinor: -100000n, currentCountervalueMinor: 0n, rateE6: 90_000000n, accounts: ACC });
    expect(r.newCountervalueMinor).toBe(-9000000n); // −90 000,00 ₽
    expect(r.deltaMinor).toBe(-9000000n);
    expect(r.tx!.kind).toBe('revaluation');
    expect(r.tx!.entries.reduce((s, e) => s + e.amountMinor, 0n)).toBe(0n);
    expect(r.tx!.entries.every((e) => e.currency === 'RUB')).toBe(true);
  });
});

describe('идемпотентность и догон (F2c доп.№1)', () => {
  it('повтор того же дня (курс+позиция те же) → дельта 0, tx=null', () => {
    const first = buildRevaluationTx({ usdPositionMinor: -100000n, currentCountervalueMinor: 0n, rateE6: 90_000000n, accounts: ACC });
    const second = buildRevaluationTx({ usdPositionMinor: -100000n, currentCountervalueMinor: first.newCountervalueMinor, rateE6: 90_000000n, accounts: ACC });
    expect(second.deltaMinor).toBe(0n);
    expect(second.tx).toBeNull();
  });

  it('пропущенный день (пятница 90 → понедельник 92) → одна дельта покрывает разницу без задвоения', () => {
    // пятница: CV с 0 до pos×90
    const fri = buildRevaluationTx({ usdPositionMinor: -100000n, currentCountervalueMinor: 0n, rateE6: 90_000000n, accounts: ACC });
    // сб/вс пропущены (курса нет). понедельник 92 — от последней контрвалюты
    const mon = buildRevaluationTx({ usdPositionMinor: -100000n, currentCountervalueMinor: fri.newCountervalueMinor, rateE6: 92_000000n, accounts: ACC });
    // дельта = pos×(92−90) = −100000×2 = −200000 коп, ровно, без гэпа/задвоения
    expect(mon.deltaMinor).toBe(-200000n);
    expect(mon.newCountervalueMinor).toBe(-9200000n);
  });

  it('сторно меняет позицию задним числом → следующая переоценка абсорбирует, баланс сходится', () => {
    // обмен: позиция −1000$, CV переоценена по 91
    const afterEx = buildRevaluationTx({ usdPositionMinor: -100000n, currentCountervalueMinor: 0n, rateE6: 91_000000n, accounts: ACC });
    expect(afterEx.newCountervalueMinor).toBe(-9100000n);
    // сторно обмена: позиция вернулась в 0. следующая переоценка по 91:
    const afterStorno = buildRevaluationTx({ usdPositionMinor: 0n, currentCountervalueMinor: afterEx.newCountervalueMinor, rateE6: 91_000000n, accounts: ACC });
    expect(afterStorno.newCountervalueMinor).toBe(0n); // оценка вернулась в 0
    expect(afterStorno.deltaMinor).toBe(9100000n); // абсорбировала изменение позиции
    // накопленный PnL (сумма дельт) = 0 → баланс сходится
    expect(afterEx.deltaMinor + afterStorno.deltaMinor).toBe(0n);
  });
});
