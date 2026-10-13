import { describe, expect, it } from 'vitest';
import { buildAcquiringConversionTx, mirrorCommissionInTarget, mirrorCreditInTarget } from './acquiring-conversion';
import { clientRubMinorForDisplay, finalMerchantRateE6 } from './merchant-tariff';
import { sumEntriesByCurrency } from './payout-conversion';

const ACC = { merchantRub: 'mR', posRub: 'pR', posTarget: 'pT', exchangeIncome: '374', merchantTarget: 'mT' };

describe('С8-3 автоконвертация зачисления', () => {
  // Числа эксперта: RUB/USD база 82,606; спред 4,5% → наш курс 86,32 (вшит в quote_our_rate инвойса).
  const ourRateE6 = 86_320_000n; // 86,32 ₽ за 1$
  const baseRateE6 = 82_606_000n; // 82,606 ₽ за 1$
  const displayAmount = 100_000n; // инвойс 1000,00 $ (валюта выплаты = валюта инвойса → ЗЕРКАЛО)
  const amountRub = (displayAmount * ourRateE6) / 1_000_000n; // 86 320,00 ₽ — что заплатил покупатель
  const commissionRub = (amountRub * 150n) / 10_000n; // эквайринг 1,5% = 1294,80 ₽ (удержана в capture, 370)
  const netRub = amountRub - commissionRub; // 85 025,20 ₽ — «К выплате» в рублях

  it('ТОЖДЕСТВО зеркала: сумма инвойса = зачисление в валюте + комиссия (копейка-в-копейку)', () => {
    const commissionTarget = mirrorCommissionInTarget({ commissionRubMinor: commissionRub, ourRateE6, rounding: 'bankers', targetCurrency: 'USD' });
    const targetNet = displayAmount - commissionTarget; // зачисление в валюте
    const r = buildAcquiringConversionTx({ netRubMinor: netRub, ourRateE6, baseRateE6, targetCurrency: 'USD', targetMinorOverride: targetNet, rounding: 'bankers', accounts: ACC });
    // Тождество: инвойс (1000$) = зачисление + комиссия, точно.
    expect(r.targetMinor + commissionTarget).toBe(displayAmount);
    expect(r.targetMinor).toBe(98_500n); // 985,00 $ зачислено
    expect(commissionTarget).toBe(1_500n); // 15,00 $ комиссия
  });

  it('зеркало: Σ=0 обе валюты, курсовая маржа на 374 = спред', () => {
    const commissionTarget = mirrorCommissionInTarget({ commissionRubMinor: commissionRub, ourRateE6, rounding: 'bankers', targetCurrency: 'USD' });
    const r = buildAcquiringConversionTx({ netRubMinor: netRub, ourRateE6, baseRateE6, targetCurrency: 'USD', targetMinorOverride: displayAmount - commissionTarget, rounding: 'bankers', accounts: ACC });
    const sums = sumEntriesByCurrency(r.entries);
    expect(sums.RUB).toBe(0n);
    expect(sums.USD).toBe(0n);
    // Маржа = netRub − targetNet×base = 85 025,20 − 985,00×82,606 = 3658,29 ₽ на 374.
    expect(r.incomeRubMinor).toBe(365_829n);
    const inc = r.entries.find((e) => e.accountId === '374')!;
    expect(inc.amountMinor).toBe(365_829n);
    // Мерчант держит валюту (merchantTarget +), позиция отдаёт (posTarget −).
    expect(r.entries.find((e) => e.accountId === 'mT')!.amountMinor).toBe(98_500n);
    expect(r.entries.find((e) => e.accountId === 'pT')!.amountMinor).toBe(-98_500n);
    // Рублёвый счёт мерчанта обнуляется (−X).
    expect(r.entries.find((e) => e.accountId === 'mR')!.amountMinor).toBe(-netRub);
  });

  it('НЕЗЕРКАЛЬНО (рублёвый инвойс → $-выплата): target = X/наш_курс вниз, Σ=0, маржа на 374', () => {
    // Рублёвый инвойс: X = вся рублёвая нетто-сумма, курс дня×(1+markup). Нет override.
    const X = 100_000_00n; // 100 000,00 ₽
    const dayOur = 86_320_000n; // дневной наш курс
    const r = buildAcquiringConversionTx({ netRubMinor: X, ourRateE6: dayOur, baseRateE6, targetCurrency: 'USD', rounding: 'bankers', accounts: ACC });
    // Y = floor-ish(X/our) = 100000,00/86,32 = 1158,48$ (вниз, в пользу платформы).
    expect(r.targetMinor).toBe(115_848n); // 1158,48 $
    const sums = sumEntriesByCurrency(r.entries);
    expect(sums.RUB).toBe(0n);
    expect(sums.USD).toBe(0n);
    expect(r.incomeRubMinor).toBeGreaterThan(0n); // спред base<our → маржа >0
  });

  it('mirrorCommissionInTarget: вверх (в пользу платформы), 0 при нулевой комиссии', () => {
    expect(mirrorCommissionInTarget({ commissionRubMinor: 0n, ourRateE6, rounding: 'bankers', targetCurrency: 'USD' })).toBe(0n);
    // 1294,81 ₽ / 86,32 = 15,0000… чуть больше 15 → округление вверх до 15,01? проверим направление.
    const up = mirrorCommissionInTarget({ commissionRubMinor: 129_481n, ourRateE6, rounding: 'platform', targetCurrency: 'USD' });
    expect(up).toBeGreaterThanOrEqual(1_500n);
  });

  it('гейт: netRub ≤ 0 и target ≤ 0 → ошибка (не молча)', () => {
    expect(() => buildAcquiringConversionTx({ netRubMinor: 0n, ourRateE6, baseRateE6, targetCurrency: 'USD', rounding: 'bankers', accounts: ACC })).toThrow();
    expect(() => buildAcquiringConversionTx({ netRubMinor: 100n, ourRateE6, baseRateE6, targetCurrency: 'USD', targetMinorOverride: 0n, rounding: 'bankers', accounts: ACC })).toThrow();
  });
});

/**
 * (правка владельца 15.09.2026) Спред — только при обмене, один раз; наценка мерчанта — его.
 * Числа Кирилла: счёт 1000 €, база EUR 100, наш спред 5 %, наценка мерчанта 5 %, эквайринг 0.
 */
describe('зеркало с наценкой мерчанта', () => {
  const base = 100_000_000n; // 100 ₽ за 1 €
  const our = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 0 }); // 105
  const final = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 500 }); // 110
  const display = 100_000n; // 1000,00 €
  const amountRub = clientRubMinorForDisplay(display, final); // 110 000,00 ₽

  it('🔴 наценка остаётся мерчанту: зачислено 1047,61 €, в 374 только наш спред', () => {
    const c = mirrorCreditInTarget({ amountRubMinor: amountRub, commissionRubMinor: 0n, displayAmountMinor: display, ourRateE6: our, rounding: 'bankers', targetCurrency: 'EUR' });
    expect(c.markupRubMinor).toBe(500_000n); // 5 000 ₽ наценки
    expect(c.markupTargetMinor).toBe(4_762n); // 47,62 € по нашему курсу 105 (половина к чётному)
    expect(c.targetMinor).toBe(104_762n);
    const r = buildAcquiringConversionTx({ netRubMinor: amountRub, ourRateE6: our, baseRateE6: base, targetCurrency: 'EUR', targetMinorOverride: c.targetMinor, rounding: 'bankers', accounts: ACC });
    // Доход = 110 000 − 1047,62×100 = 5 238 ₽: спред 5 % со всех обменянных рублей, как у кросса.
    expect(r.incomeRubMinor).toBe(523_800n);
    // Раньше мерчант получал 1000 € и в 374 уходило 10 000 ₽ — спред вместе с его наценкой.
    expect(r.incomeRubMinor).toBeLessThan(1_000_000n);
    const sums = sumEntriesByCurrency(r.entries);
    expect(sums.RUB).toBe(0n);
    expect(sums.EUR).toBe(0n);
  });

  it('зеркало = кросс по тому же курсу: одна модель обмена на всех путях', () => {
    const c = mirrorCreditInTarget({ amountRubMinor: amountRub, commissionRubMinor: 0n, displayAmountMinor: display, ourRateE6: our, rounding: 'bankers', targetCurrency: 'EUR' });
    const cross = buildAcquiringConversionTx({ netRubMinor: amountRub, ourRateE6: our, baseRateE6: base, targetCurrency: 'EUR', rounding: 'bankers', accounts: ACC });
    const d = c.targetMinor - cross.targetMinor;
    expect(d >= -1n && d <= 1n).toBe(true);
  });

  it('без наценки зачисление совпадает с прежним «выставлено − комиссия»', () => {
    const ourUsd = 86_320_000n;
    const amt = (100_000n * ourUsd) / 1_000_000n;
    const comm = (amt * 150n) / 10_000n;
    const c = mirrorCreditInTarget({ amountRubMinor: amt, commissionRubMinor: comm, displayAmountMinor: 100_000n, ourRateE6: ourUsd, rounding: 'bankers', targetCurrency: 'USD' });
    expect(c.markupTargetMinor).toBe(0n);
    expect(c.targetMinor).toBe(100_000n - mirrorCommissionInTarget({ commissionRubMinor: comm, ourRateE6: ourUsd, rounding: 'bankers', targetCurrency: 'USD' }));
  });
});

/**
 * 🔴 МАСШТАБ ЧЕТЫРЁХЗНАЧНОЙ ВАЛЮТЫ. Всё выше проверено на USD и EUR — у них два знака, как у
 * рубля, поэтому масштабы сокращаются и ошибка «делим как рубль» не видна ни в одном числе.
 * Ровно поэтому дефект дожил до боевого тракта. Здесь каждая величина проверяется ПО ВЕЛИЧИНЕ на
 * тезере (четыре знака) — Σ=0 такие ошибки не ловит, обе ноги неверны одинаково.
 */
describe('USDT-TRC20: четыре знака, а не два', () => {
  const T = 'USDT-TRC20';
  const ourRateE6 = 89_655_917n; // 89,655917 ₽ за 1 ₮
  const baseRateE6 = 85_386_588n; // база (наш курс = база + 5 %)

  it('🔴 незеркально: нетто 18 612,24 ₽ по 89,655917 = 207,5963 ₮ (а не 2,0760 ₮)', () => {
    const r = buildAcquiringConversionTx({ netRubMinor: 1_861_224n, ourRateE6, baseRateE6, targetCurrency: T, rounding: 'bankers', accounts: ACC });
    expect(r.targetMinor).toBe(2_075_963n); // 207,5963 ₮
    // Прежняя формула (X × 1e6 / курс) давала 20 760 минорных единиц — 2,0760 ₮, в сто раз меньше.
    // (207,6023 из описания дефекта — это как раз сломанное число, умноженное на сто: оно несёт
    //  усечение старого деления. Точная величина на два сотых цента меньше.)
    const broken = (1_861_224n * 1_000_000n) / ourRateE6;
    expect(broken).toBe(20_759n); // 2,0759 ₮ — столько ложилось на счёт мерчанта
    expect(r.targetMinor).toBeGreaterThan(broken * 99n);
    const sums = sumEntriesByCurrency(r.entries);
    expect(sums.RUB).toBe(0n);
    expect(sums[T]).toBe(0n);
  });

  it('🔴 доход обмена считается от исправленной величины: 886,31 ₽ спреда, а не почти всё нетто', () => {
    const net = 1_861_224n;
    const r = buildAcquiringConversionTx({ netRubMinor: net, ourRateE6, baseRateE6, targetCurrency: T, rounding: 'bankers', accounts: ACC });
    // Маржа = нетто − зачисленное по БАЗЕ = 18 612,24 − 207,5963×85,386588 = 886,31 ₽.
    expect(r.incomeRubMinor).toBe(88_631n);
    expect(r.entries.find((e) => e.accountId === '374')!.amountMinor).toBe(88_631n);
    // Со сломанным масштабом рублёвая база target-ноги была почти нулевой, и в доход уходило ~всё нетто.
    expect(r.incomeRubMinor).toBeLessThan(net / 10n);
  });

  it('🔴 малое нетто больше не схлопывается в ноль (оплата не залипает в deferred)', () => {
    // 0,40 ₽: прежняя формула давала 0 минорных единиц → throw «зачисление ≤ 0» → вечный deferred.
    expect(() => buildAcquiringConversionTx({ netRubMinor: 40n, ourRateE6, baseRateE6, targetCurrency: T, targetMinorUnits: 2, rounding: 'bankers', accounts: ACC })).toThrow();
    const r = buildAcquiringConversionTx({ netRubMinor: 40n, ourRateE6, baseRateE6, targetCurrency: T, rounding: 'bankers', accounts: ACC });
    expect(r.targetMinor).toBe(45n); // 0,0045 ₮
  });

  it('🔴 зеркало: комиссия платформы в тезере — 10,7076 ₮, а не 0,1071 ₮', () => {
    // 960,00 ₽ эквайринга по курсу инвойса 89,655917.
    const c = mirrorCommissionInTarget({ commissionRubMinor: 96_000n, ourRateE6, rounding: 'bankers', targetCurrency: T });
    expect(c).toBe(107_076n); // 10,7076 ₮
    // Прежняя формула давала 1071 минорную единицу = 0,1071 ₮: платформа ДАРИЛА свою комиссию.
    expect((96_000n * 1_000_000n + ourRateE6 - 1n) / ourRateE6).toBe(1_071n);
  });

  it('🔴 зеркало целиком: выставлено + наценка − комиссия, всё в четырёх знаках', () => {
    const display = 2_260_000n; // счёт 226,0000 ₮
    const amountRub = 2_127_534n; // клиент заплатил 21 275,34 ₽ (курс счёта = наш + 5 % наценки)
    const c = mirrorCreditInTarget({ amountRubMinor: amountRub, commissionRubMinor: 96_000n, displayAmountMinor: display, ourRateE6, rounding: 'bankers', targetCurrency: T });
    // Наценка мерчанта = 21 275,34 − 226,0000×89,655917 = 1 013,11 ₽ → 11,3000 ₮ по нашему курсу.
    expect(c.markupRubMinor).toBe(101_311n);
    expect(c.markupTargetMinor).toBe(113_000n);
    expect(c.commissionTargetMinor).toBe(107_076n);
    expect(c.targetMinor).toBe(2_265_924n); // 226,5924 ₮
    // Прежде рублёвая оценка счёта завышалась в сто раз, разность уходила в минус и наценка
    // ОБНУЛЯЛАСЬ: мерчанту она не зачислялась, а доставалась доходу обмена.
    expect(c.markupRubMinor).toBeGreaterThan(0n);
  });

  it('знаки берутся из справочника: та же сделка на двух знаках даёт ровно сломанное число', () => {
    const two = buildAcquiringConversionTx({ netRubMinor: 1_861_224n, ourRateE6, baseRateE6, targetCurrency: T, targetMinorUnits: 2, rounding: 'bankers', accounts: ACC });
    expect(two.targetMinor).toBe(20_760n);
  });
});
