import { describe, expect, it } from 'vitest';
import {
  buildDepositTx,
  buildExchangeTx,
  buildInternalTransferTx,
  buildStornoTx,
  buildTransferCashTx,
  buildTransferClientTx,
  buildWithdrawalTx,
  presentBalanceMinor,
} from './manual-ops';

const sumByCur = (entries: { amountMinor: bigint; currency?: string }[]) => {
  const m = new Map<string, bigint>();
  for (const e of entries) m.set(e.currency ?? '', (m.get(e.currency ?? '') ?? 0n) + e.amountMinor);
  return m;
};

describe('внесение / выдача / переводы — Σ по валюте = 0', () => {
  it('deposit: клиент +X, касса −X', () => {
    const t = buildDepositTx({ amount: 100000n, currency: 'RUB', clientAccount: 'cl', cashDesk: 'cash' });
    expect(t.kind).toBe('deposit');
    expect(t.entries.find((e) => e.accountId === 'cl')?.amountMinor).toBe(100000n);
    expect(t.entries.find((e) => e.accountId === 'cash')?.amountMinor).toBe(-100000n);
    expect([...sumByCur(t.entries).values()]).toEqual([0n]);
  });
  it('withdrawal: клиент −X (в минус можно), касса +X', () => {
    const t = buildWithdrawalTx({ amount: 100000n, currency: 'RUB', clientAccount: 'cl', cashDesk: 'cash' });
    expect(t.entries.find((e) => e.accountId === 'cl')?.amountMinor).toBe(-100000n);
    expect([...sumByCur(t.entries).values()]).toEqual([0n]);
  });
  it('перевод клиент→клиент; совпадающие счета — ошибка', () => {
    const t = buildTransferClientTx({ amount: 5000n, currency: 'USD', fromClient: 'a', toClient: 'b' });
    expect([...sumByCur(t.entries).values()]).toEqual([0n]);
    expect(() => buildTransferClientTx({ amount: 1n, currency: 'RUB', fromClient: 'a', toClient: 'a' })).toThrow();
  });
  it('перевод касса→касса', () => {
    const t = buildTransferCashTx({ amount: 5000n, currency: 'RUB', fromCash: 'c1', toCash: 'c2' });
    expect([...sumByCur(t.entries).values()]).toEqual([0n]);
  });
  it('(Д3а) перевод между своими счетами: источник +raw, получатель −raw, Σ=0; совпадение — ошибка', () => {
    const t = buildInternalTransferTx({ amount: 9820000n, currency: 'RUB', fromAccount: 'acq', toAccount: 'settle' });
    expect(t.kind).toBe('transfer');
    expect(t.entries.find((e) => e.accountId === 'acq')?.amountMinor).toBe(9820000n); // источник: наличие убыло
    expect(t.entries.find((e) => e.accountId === 'settle')?.amountMinor).toBe(-9820000n); // получатель: прибыло
    expect([...sumByCur(t.entries).values()]).toEqual([0n]);
    expect(() => buildInternalTransferTx({ amount: 1n, currency: 'RUB', fromAccount: 'x', toAccount: 'x' })).toThrow();
    expect(() => buildInternalTransferTx({ amount: 0n, currency: 'RUB', fromAccount: 'a', toAccount: 'b' })).toThrow();
  });
});

describe('обмен — ноги балансируются по каждой валюте, доход в RUB', () => {
  it('buy USD за 10 000 ₽ (база 90, наценка 2%): ΣRUB=0, ΣUSD=0, доход ≈ спред', () => {
    const r = buildExchangeTx({
      baseE6: 90_000000n, markupBp: 200, direction: 'buy_usd', amountMinor: 1_000000n, amountSide: 'from', rounding: 'bankers',
      accounts: { clientFrom: 'clRub', positionFrom: 'posRub', positionTo: 'posUsd', clientTo: 'clUsd' },
    });
    expect(r.tx.kind).toBe('exchange');
    expect(r.dealE6).toBe(91_800000n);
    expect(r.toMinor).toBe(10893n);
    const s = sumByCur(r.tx.entries);
    expect(s.get('RUB')).toBe(0n);
    expect(s.get('USD')).toBe(0n);
    // доход = USD-нога × (91.8−90.0) = 10893 × 1.8 = 19607.4 → 19607 коп RUB
    expect(r.incomeMinorRub).toBe(19607n);
    // клиентские/позиционные знаки
    expect(r.tx.entries.find((e) => e.accountId === 'clRub')?.amountMinor).toBe(-1_000000n);
    expect(r.tx.entries.find((e) => e.accountId === 'clUsd')?.amountMinor).toBe(10893n);
  });

  /**
   * 🔴 ЗНАК дохода. С наценкой спред всегда в нашу пользу, поэтому модуль в формуле не было видно.
   * Договорной курс (`dealE6Override`) оператор вводит руками — и он легко оказывается хуже
   * базового. Модуль печатал такой убыток ПРИБЫЛЬЮ: счёт «Доход от обмена» рос на сделке,
   * которая платформу обеднила.
   */
  it('🔴 договорной курс хуже базового: доход ОТРИЦАТЕЛЬНЫЙ, а не по модулю', () => {
    // Клиент покупает валюту, а мы продаём её ДЕШЕВЛЕ базы (88 при базе 90) — это убыток.
    const loss = buildExchangeTx({
      baseE6: 90_000000n, markupBp: 200, direction: 'buy_usd', dealE6Override: 88_000000n,
      amountMinor: 1_000000n, amountSide: 'from', rounding: 'bankers',
      accounts: { clientFrom: 'clRub', positionFrom: 'posRub', positionTo: 'posUsd', clientTo: 'clUsd' },
    });
    // 10 000,00 ₽ / 88 = 113,64 $; убыток = 113,64 × (88 − 90) = −227,28 ₽.
    expect(loss.toMinor).toBe(11364n);
    expect(loss.incomeMinorRub).toBe(-22728n);

    // Обратная сторона: клиент ПРОДАЁТ валюту, а мы покупаем её ДОРОЖЕ базы — тоже убыток.
    const sellLoss = buildExchangeTx({
      baseE6: 90_000000n, markupBp: 200, direction: 'sell_usd', dealE6Override: 92_000000n,
      amountMinor: 10_000n, amountSide: 'from', rounding: 'bankers',
      accounts: { clientFrom: 'clUsd', positionFrom: 'posUsd', positionTo: 'posRub', clientTo: 'clRub' },
    });
    expect(sellLoss.incomeMinorRub).toBe(-20_000n); // 100,00 $ × (90 − 92) = −200,00 ₽

    // А обычная сделка по наценке по-прежнему даёт ПЛЮС — знак не «перевёрнут», он сохранён.
    const sellGain = buildExchangeTx({
      baseE6: 90_000000n, markupBp: 200, direction: 'sell_usd',
      amountMinor: 10_000n, amountSide: 'from', rounding: 'bankers',
      accounts: { clientFrom: 'clUsd', positionFrom: 'posUsd', positionTo: 'posRub', clientTo: 'clRub' },
    });
    expect(sellGain.incomeMinorRub).toBe(18_000n); // 100,00 $ × (90 − 88,2) = 180,00 ₽
  });

  /** 🔴 Доход на четырёхзначной валюте — по величине: масштаб ноги участвует и здесь. */
  it('тезер: доход обмена 18,00 ₽, а не 1 800,00 ₽ (масштаб ноги)', () => {
    const r = buildExchangeTx({
      baseE6: 90_000000n, markupBp: 200, direction: 'sell_usd', foreignCurrency: 'USDT-TRC20', foreignMinorUnits: 4,
      amountMinor: 100_000n, amountSide: 'from', rounding: 'bankers', // 10,0000 ₮
      accounts: { clientFrom: 'clT', positionFrom: 'posT', positionTo: 'posRub', clientTo: 'clRub' },
    });
    expect(r.dealE6).toBe(88_200000n);
    expect(r.toMinor).toBe(88_200n); // 882,00 ₽
    expect(r.incomeMinorRub).toBe(1_800n); // 10 ₮ × 1,8 ₽ = 18,00 ₽
  });
});

describe('сторно — зеркало', () => {
  it('инвертирует все проводки, kind=storno', () => {
    const orig = [
      { accountId: 'cl', amountMinor: 100000n, currency: 'RUB' },
      { accountId: 'cash', amountMinor: -100000n, currency: 'RUB' },
    ];
    const t = buildStornoTx(orig);
    expect(t.kind).toBe('storno');
    expect(t.entries.find((e) => e.accountId === 'cl')?.amountMinor).toBe(-100000n);
    expect([...sumByCur(t.entries).values()]).toEqual([0n]);
    expect(() => buildStornoTx([])).toThrow();
  });
});

describe('presentBalanceMinor — флип ТОЛЬКО для активов', () => {
  /**
   * 🔴 Позиция и контрвалюта — капитал, и показываются сырым знаком. Прежде они флипались здесь,
   * а дерево, ОСВ и выписка печатали их сырыми: одна валютная позиция на Обзоре Финансов
   * приходила двумя противоположными числами (`positionsByCurrency` сырой против
   * `positionUsdMinor` через эту функцию). Верный знак задаёт тождество: в обмене клиент отдаёт
   * 100 ₽ → позиция `raw +100`, то есть плюс = длинная позиция.
   */
  it('касса и ностро — с флипом; позиция, контрвалюта и клиентские счета — как есть', () => {
    expect(presentBalanceMinor('cash_desk', -100000n)).toBe(100000n);
    expect(presentBalanceMinor('nostro', -50000n)).toBe(50000n);
    expect(presentBalanceMinor('position', 70000n), 'длинная позиция показывается плюсом').toBe(70000n);
    expect(presentBalanceMinor('position', -70000n), 'короткая — минусом').toBe(-70000n);
    expect(presentBalanceMinor('countervalue', -70000n), 'контрвалюта идёт за позицией').toBe(-70000n);
    expect(presentBalanceMinor('settlement', 100000n)).toBe(100000n);
  });
});
