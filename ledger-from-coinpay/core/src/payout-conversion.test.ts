import { describe, it, expect } from 'vitest';
import { buildPayoutConversionTx, buildRequestHoldReversalTx, buildRequestHoldTx, buildRequestReleaseTx, sumEntriesByCurrency } from './payout-conversion';

/**
 * (Д2 генпрогон копейка-в-копейку) Мерчант заработал эквивалент 100 $ (по своему курсу 80 → 8000 ₽
 * на расчётном счёте). Выплата в USD по НАШЕМУ курсу 80, база 79 → мерчант получает 100.00 $ из
 * кассы, наша курсовая маржа 100 ₽ на «Доходе от обмена». Σ=0 по RUB и USD ОДНОВРЕМЕННО.
 */
const ACC = { merchantRub: 'm-rub', posRub: 'p-rub', posTarget: 'p-usd', exchangeIncome: 'fx-income', sourceTarget: 'kassa-usd' };

describe('Д2 конверсионная выплата — Σ=0 обе валюты', () => {
  it('8000 ₽ → 100.00 $ по нашему курсу 80 (база 79), маржа 100 ₽', () => {
    const r = buildPayoutConversionTx({
      amountSourceMinor: 800000n, // 8000,00 ₽
      ourRateE6: 80_000000n, // 80 ₽/$
      baseRateE6: 79_000000n, // база 79 ₽/$
      rounding: 'bankers',
      targetCurrency: 'USD',
      accounts: ACC,
    });
    expect(r.targetMinor).toBe(10000n); // 100,00 $
    expect(r.incomeRubMinor).toBe(10000n); // 100,00 ₽ курсовая маржа
    const s = sumEntriesByCurrency(r.entries);
    expect(s.RUB).toBe(0n); // Σ RUB = 0
    expect(s.USD).toBe(0n); // Σ USD = 0
    // мерчант списан ровно на 8000, доход обмена ровно 100, касса отдала ровно 100$
    expect(r.entries.find((e) => e.accountId === 'm-rub')!.amountMinor).toBe(-800000n);
    expect(r.entries.find((e) => e.accountId === 'fx-income')!.amountMinor).toBe(10000n);
    expect(r.entries.find((e) => e.accountId === 'kassa-usd')!.amountMinor).toBe(10000n);
  });

  it('курс без маржи (our=base) → доход обмена 0, Σ=0 держится', () => {
    const r = buildPayoutConversionTx({ amountSourceMinor: 790000n, ourRateE6: 79_000000n, baseRateE6: 79_000000n, rounding: 'bankers', targetCurrency: 'USD', accounts: ACC });
    expect(r.targetMinor).toBe(10000n);
    expect(r.incomeRubMinor).toBe(0n);
    const s = sumEntriesByCurrency(r.entries);
    expect(s.RUB).toBe(0n);
    expect(s.USD).toBe(0n);
  });

  /**
   * 🔴 Регресс с боевого 25.09: сумма выплаты считалась в СТО РАЗ меньше для тезера.
   *
   * Формула была `X × 1e6 / our_rate` — она молча принимала, что у валюты выплаты два знака,
   * как у рубля. Соседняя долларовая заявка выходила верной, тезеровая — нет, и именно поэтому
   * дефект прожил так долго.
   *
   * Числа взяты из реальной строки `payout_requests` на dev: 1 000,00 ₽ по курсу 90,79665 ₽/₮.
   * В базе лежало 1101 — это 0,1101 ₮ при четырёх знаках. Мерчант заказал 11,0136 ₮.
   *
   * Σ=0 этого НЕ ловил и не мог: обе target-ноги были неверны одинаково, проводка сходилась.
   * Поэтому тест проверяет ВЕЛИЧИНУ, а не только баланс.
   */
  it('🔴 тезер: сумма выплаты масштабируется по знакам ВАЛЮТЫ, а не «два у всех»', () => {
    const usdt = { ...ACC, posTarget: 'p-usdt', sourceTarget: 'wallet-usdt' };
    const r = buildPayoutConversionTx({
      amountSourceMinor: 100_000n, // 1 000,00 ₽
      ourRateE6: 90_796_650n, // 90,79665 ₽ за 1 ₮
      baseRateE6: 90_796_650n,
      rounding: 'platform',
      targetCurrency: 'USDT-TRC20',
      accounts: usdt,
    });
    // 1000,00 / 90,79665 = 11,0136… ₮ → 110 136 минорных единиц (4 знака), а не 1101.
    expect(r.targetMinor).toBe(110_136n);
    expect(r.targetMinor).not.toBe(1101n); // ровно то, что лежало в базе
    const s = sumEntriesByCurrency(r.entries);
    expect(s.RUB).toBe(0n);
    expect(s['USDT-TRC20']).toBe(0n);
  });

  it('доллар считается как прежде — у него знаков и правда два', () => {
    // Та же заявка в USD: масштаб цели совпадает с рублёвым, поэтому число не изменилось.
    const r = buildPayoutConversionTx({
      amountSourceMinor: 100_000n,
      ourRateE6: 90_796_650n,
      baseRateE6: 90_796_650n,
      rounding: 'platform',
      targetCurrency: 'USD',
      accounts: ACC,
    });
    expect(r.targetMinor).toBe(1101n); // 11,01 $
  });

  it('число знаков из справочника побеждает запасной список', () => {
    const r = buildPayoutConversionTx({
      amountSourceMinor: 100_000n,
      ourRateE6: 90_796_650n,
      baseRateE6: 90_796_650n,
      rounding: 'platform',
      targetCurrency: 'USDT-TRC20',
      targetMinorUnits: 2, // справочник правится из админки — он и есть правда
      accounts: { ...ACC, posTarget: 'p-usdt', sourceTarget: 'wallet-usdt' },
    });
    expect(r.targetMinor).toBe(1101n);
  });

  it('инвариант Σ=0 держится на произвольных суммах/курсах', () => {
    for (const [X, our, base] of [[123456n, 81_500000n, 79_900000n], [999999n, 90_120000n, 88_000000n], [1n, 80_000000n, 79_000000n]] as const) {
      const r = buildPayoutConversionTx({ amountSourceMinor: X, ourRateE6: our, baseRateE6: base, rounding: 'bankers', targetCurrency: 'USD', accounts: ACC });
      const s = sumEntriesByCurrency(r.entries);
      expect(s.RUB, `X=${X}`).toBe(0n);
      expect(s.USD, `X=${X}`).toBe(0n);
    }
  });
});

describe('двухшаговая выплата: резерв при заявке + выдача при исполнении', () => {
  const p = {
    amountSourceMinor: 181_593_30n,
    ourRateE6: 95_356_900n,
    baseRateE6: 90_816_100n,
    rounding: 'bankers' as const,
    targetCurrency: 'USDT-TRC20',
  };
  const acc = { merchantRub: 'mRub', posRub: 'pRub', posTarget: 'pT', exchangeIncome: 'inc' };

  it('🔴 резерв + выдача = ровно прежняя одна проводка', () => {
    // Разделение НЕ должно менять деньги: та же маржа, та же сумма мерчанту, те же счета.
    const old = buildPayoutConversionTx({ ...p, accounts: { ...acc, sourceTarget: 'nostro' } });
    const hold = buildRequestHoldTx({ ...p, accounts: { ...acc, merchantHold: 'hold' } });
    const rel = buildRequestReleaseTx({ targetMinor: hold.targetMinor, targetCurrency: p.targetCurrency, accounts: { merchantHold: 'hold', sourceTarget: 'nostro' } });

    expect(hold.targetMinor).toBe(old.targetMinor);
    expect(hold.incomeRubMinor).toBe(old.incomeRubMinor);

    // Свернём два шага: ноги по «hold» гасят друг друга, остаток обязан совпасть с прежним.
    const fold = (es: { accountId: string; amountMinor: bigint; currency: string }[]) => {
      const m = new Map<string, bigint>();
      for (const e of es) m.set(`${e.accountId}|${e.currency}`, (m.get(`${e.accountId}|${e.currency}`) ?? 0n) + e.amountMinor);
      return [...m].filter(([, v]) => v !== 0n).sort();
    };
    expect(fold([...hold.entries, ...rel.entries])).toEqual(fold(old.entries));
  });

  it('Σ=0 по каждой валюте на КАЖДОМ шаге, а не только в сумме', () => {
    const hold = buildRequestHoldTx({ ...p, accounts: { ...acc, merchantHold: 'hold' } });
    for (const v of Object.values(sumEntriesByCurrency(hold.entries))) expect(v).toBe(0n);
    const rel = buildRequestReleaseTx({ targetMinor: hold.targetMinor, targetCurrency: p.targetCurrency, accounts: { merchantHold: 'hold', sourceTarget: 'nostro' } });
    for (const v of Object.values(sumEntriesByCurrency(rel.entries))) expect(v).toBe(0n);
  });

  it('резерв кладёт валюту мерчанту в «ожидает выплаты», а не на ностро', () => {
    const hold = buildRequestHoldTx({ ...p, accounts: { ...acc, merchantHold: 'hold' } });
    const toHold = hold.entries.find((e) => e.accountId === 'hold');
    expect(toHold?.amountMinor).toBe(hold.targetMinor);
    expect(hold.entries.some((e) => e.accountId === 'nostro')).toBe(false);
  });

  it('🔴 отмена разворачивает резерв ровно теми же ногами — рубли возвращаются', () => {
    const hold = buildRequestHoldTx({ ...p, accounts: { ...acc, merchantHold: 'hold' } });
    const back = buildRequestHoldReversalTx(hold);
    const all = [...hold.entries, ...back.entries];
    for (const v of Object.values(sumEntriesByCurrency(all))) expect(v).toBe(0n);
    // Рублёвый счёт мерчанта вернулся к исходному: сумма его ног равна нулю.
    expect(all.filter((e) => e.accountId === 'mRub').reduce((s, e) => s + e.amountMinor, 0n)).toBe(0n);
  });

  it('выдача нулевой суммы невозможна — это не выплата, а пустая проводка', () => {
    expect(() => buildRequestReleaseTx({ targetMinor: 0n, targetCurrency: 'USD', accounts: { merchantHold: 'h', sourceTarget: 'n' } })).toThrow();
  });
});
