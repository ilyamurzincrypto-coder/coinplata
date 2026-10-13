import { describe, expect, it } from 'vitest';
import {
  assertBalancedByCurrency,
  buildCurrencyPayoutHoldTx,
  buildCurrencyPayoutReleaseTx,
  buildCurrencyPayoutReversalTx,
} from './payout-currency';
import { parseAmountMinor } from './money';
import { sumEntriesByCurrency } from './payout-conversion';

/**
 * 🔴 Проверяем ВЕЛИЧИНУ, а не только Σ=0, и на ЧЕТЫРЁХЗНАЧНОЙ валюте.
 *
 * У двузначных валют масштаб сокращается, и ошибка в сто раз становится невидимой: обе ноги
 * проводки неверны ОДИНАКОВО, поэтому сумма сходится идеально и остаётся неправильной. Ровно так
 * прошли мимо трёх дефектов подряд. Боевой профиль: у мерчанта CoinPoint на счёте
 * 440-M0001-1303-02 лежит 218,5224 ₮ = 2 185 224 минорных единицы.
 */
const TARGET = 'USDT-TRC20';
const AMOUNT = 2_185_224n; // 218,5224 ₮
const SETTLEMENT = 'acc-440-usdt';
const HOLD = 'acc-445-usdt';
const NOSTRO = 'acc-230-usdt';

describe('валютная выплата: удержание', () => {
  it('снимает с расчётного счёта РОВНО ту сумму и кладёт её в «ожидает выплаты»', () => {
    const tx = buildCurrencyPayoutHoldTx({ amountMinor: AMOUNT, currency: TARGET, accounts: { merchantSettlement: SETTLEMENT, merchantHold: HOLD } });
    expect(tx.entries).toHaveLength(2);
    expect(tx.entries.find((e) => e.accountId === SETTLEMENT)!.amountMinor).toBe(-2_185_224n);
    expect(tx.entries.find((e) => e.accountId === HOLD)!.amountMinor).toBe(2_185_224n);
    // Валюта на каждой ноге — та же: сумма без валюты в этом леджере ничего не значит.
    expect(tx.entries.every((e) => e.currency === TARGET)).toBe(true);
    expect(sumEntriesByCurrency(tx.entries)[TARGET]).toBe(0n);
  });

  it('218,5224 ₮ — это 2 185 224 минорных единицы, а не 21 852 (ошибка в сто раз)', () => {
    // Разбор и проводка — одна цепочка: именно так сумма попадает из формы в леджер.
    const parsed = parseAmountMinor('218,5224', 4);
    expect(parsed).toBe(AMOUNT);
    const tx = buildCurrencyPayoutHoldTx({ amountMinor: parsed!, currency: TARGET, accounts: { merchantSettlement: SETTLEMENT, merchantHold: HOLD } });
    expect(tx.entries.find((e) => e.accountId === HOLD)!.amountMinor).toBe(2_185_224n);
  });
});

describe('валютная выплата: выдача', () => {
  it('гасит «ожидает выплаты» и отдаёт ту же сумму с нашего ностро', () => {
    const tx = buildCurrencyPayoutReleaseTx({ amountMinor: AMOUNT, currency: TARGET, accounts: { merchantHold: HOLD, source: NOSTRO } });
    expect(tx.entries.find((e) => e.accountId === HOLD)!.amountMinor).toBe(-2_185_224n);
    // Актив уходит в плюс, когда деньги с него ушли — знак как у проверенной ноги заявки.
    expect(tx.entries.find((e) => e.accountId === NOSTRO)!.amountMinor).toBe(2_185_224n);
  });

  it('🔴 газ НЕ уменьшает выплату: он отдельной парой ног в валюте сети, Σ=0 по каждой валюте', () => {
    const release = buildCurrencyPayoutReleaseTx({ amountMinor: AMOUNT, currency: TARGET, accounts: { merchantHold: HOLD, source: NOSTRO } });
    const gas = [
      { accountId: 'acc-373-trx', amountMinor: -135_000n, currency: 'TRX' }, // 13,5 TRX расходом
      { accountId: 'acc-230-trx', amountMinor: 135_000n, currency: 'TRX' },
    ];
    const all = [...release.entries, ...gas];
    const sums = sumEntriesByCurrency(all);
    expect(sums[TARGET]).toBe(0n);
    expect(sums.TRX).toBe(0n);
    // Главное: мерчанту ушло ровно столько, сколько заказали, — газ на его сумме не отразился.
    expect(all.find((e) => e.accountId === NOSTRO)!.amountMinor).toBe(2_185_224n);
    expect(() => assertBalancedByCurrency(all)).not.toThrow();
  });
});

describe('валютная выплата: разворот при провале', () => {
  it('возвращает мерчанту ТУ ЖЕ сумму — ни курса, ни удержаний по дороге', () => {
    const hold = buildCurrencyPayoutHoldTx({ amountMinor: AMOUNT, currency: TARGET, accounts: { merchantSettlement: SETTLEMENT, merchantHold: HOLD } });
    const back = buildCurrencyPayoutReversalTx({ amountMinor: AMOUNT, currency: TARGET, accounts: { merchantSettlement: SETTLEMENT, merchantHold: HOLD } });
    // Сумма удержания и разворота по каждому счёту — ноль: деньги там, где были.
    for (const acc of [SETTLEMENT, HOLD]) {
      const net = [...hold.entries, ...back.entries].filter((e) => e.accountId === acc).reduce((s, e) => s + e.amountMinor, 0n);
      expect(net, `нетто по ${acc}`).toBe(0n);
    }
    expect(back.entries.find((e) => e.accountId === SETTLEMENT)!.amountMinor).toBe(2_185_224n);
  });
});

describe('валютная выплата: чего проводка не допускает', () => {
  it('ноль и минус — не сумма выплаты', () => {
    const accounts = { merchantSettlement: SETTLEMENT, merchantHold: HOLD };
    expect(() => buildCurrencyPayoutHoldTx({ amountMinor: 0n, currency: TARGET, accounts })).toThrow(/положительной/);
    expect(() => buildCurrencyPayoutHoldTx({ amountMinor: -1n, currency: TARGET, accounts })).toThrow(/положительной/);
  });

  it('счёт сам себе источником не бывает — иначе проводка «сходится» ничего не сделав', () => {
    expect(() => buildCurrencyPayoutReleaseTx({ amountMinor: AMOUNT, currency: TARGET, accounts: { merchantHold: HOLD, source: HOLD } })).toThrow(/совпадают/);
  });

  it('несведённая валюта не проходит проверку', () => {
    expect(() => assertBalancedByCurrency([
      { accountId: HOLD, amountMinor: -2_185_224n, currency: TARGET },
      { accountId: NOSTRO, amountMinor: 21_852n, currency: TARGET }, // та самая ошибка в сто раз
    ])).toThrow(/Σ по USDT-TRC20 ≠ 0/);
  });
});

describe('разбор введённой суммы — по знакам ВАЛЮТЫ', () => {
  it('четыре знака у тезера принимаются целиком', () => {
    expect(parseAmountMinor('218,5224', 4)).toBe(2_185_224n);
    expect(parseAmountMinor('218.5224', 4)).toBe(2_185_224n);
    expect(parseAmountMinor('218,52', 4)).toBe(2_185_200n); // недобор знаков — дополняем нулями
    expect(parseAmountMinor('218', 4)).toBe(2_180_000n);
  });

  it('рубль остаётся двузначным, и «218,5224» для него — не сумма', () => {
    expect(parseAmountMinor('1234,50', 2)).toBe(123_450n);
    expect(parseAmountMinor('218,5224', 2)).toBeNull();
  });

  it('лишний знак — отказ, а не тихое округление', () => {
    expect(parseAmountMinor('218,52245', 4)).toBeNull();
    expect(parseAmountMinor('', 4)).toBeNull();
    expect(parseAmountMinor('-5', 4)).toBeNull();
    expect(parseAmountMinor('218,5,2', 4)).toBeNull();
  });
});
