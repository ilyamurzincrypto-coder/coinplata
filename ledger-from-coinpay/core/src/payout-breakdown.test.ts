import { describe, expect, it } from 'vitest';
import {
  buildPayoutBreakdown, buildPlatformEarnings, effectiveRateBp, merchantEarningOnInvoice, spreadBpFromRates,
  type PayoutBreakdownInput,
} from './payout-breakdown';

/**
 * (Б2-2) Разложение обязано воспроизводить БОЕВУЮ операцию и сходиться на экране.
 * Эталон — единственная боевая конверсия 25.08.2026: счёт 1000,00 $, клиент 87 452,19 ₽,
 * удержано 2 186,30 ₽, зачислено 975,00 $. Все числа взяты из проводок прода.
 */
const PROD: PayoutBreakdownInput = {
  amountMinor: 8_745_219n,
  feeMinor: 218_630n,
  display: { currency: 'USD', amountMinor: 100_000n, rateE6: 87_452_190n },
  conversion: { currency: 'USD', targetMinor: 97_500n, dealRateE6: 87_452_190n },
};

describe('effectiveRateBp — ставка из УДЕРЖАННОГО, не из справочника', () => {
  it('боевая пара 2 186,30 / 87 452,19 даёт ровно 250 bp', () => {
    expect(effectiveRateBp(218_630n, 8_745_219n)).toBe(250);
  });

  it('та же сумма по действующему тарифу дала бы 500 bp — источники различимы', () => {
    expect(effectiveRateBp(437_260n, 8_745_219n)).toBe(500);
  });

  it('половина округляется вверх, комиссии нет → null', () => {
    expect(effectiveRateBp(2_505n, 100_000n)).toBe(251); // 2,505 % → 251 bp
    expect(effectiveRateBp(0n, 100_000n)).toBeNull();
    expect(effectiveRateBp(100n, 0n)).toBeNull();
  });
});

describe('Б2-2: разложение боевой конверсии', () => {
  const b = buildPayoutBreakdown(PROD);

  it('три шага в порядке «выставлено → тариф → к выплате»', () => {
    expect(b.rows.map((r) => r.step)).toEqual(['issued', 'fee', 'payout']);
  });

  it('выставлено — в валюте счёта, с рублями и курсом рядом', () => {
    const [issued] = b.rows;
    expect(issued).toMatchObject({ minor: 100_000n, currency: 'USD', alsoMinor: 8_745_219n, alsoCurrency: 'RUB', rateE6: 87_452_190n });
  });

  it('🔴 тариф показан фактом: 2 186,30 ₽ = 250 bp, а не действующие 500', () => {
    expect(b.rows[1]).toMatchObject({ minor: 218_630n, currency: 'RUB' });
    expect(b.effectiveRateBp).toBe(250);
  });

  it('🔴 комиссия в валюте — РАЗНОСТЬ фактов, поэтому цепочка сходится точно', () => {
    // 1000,00 − 25,00 = 975,00 ровно. Пересчёт делением дал бы 24,99 и трёх сходящихся чисел не было бы.
    expect(b.rows[1]!.alsoMinor).toBe(2_500n);
    expect(b.rows[0]!.minor - b.rows[1]!.alsoMinor!).toBe(b.rows[2]!.minor);
  });

  it('к выплате — 975,00 $ из проводки, зеркало распознано, цепочка сходится', () => {
    expect(b.rows[2]).toMatchObject({ minor: 97_500n, currency: 'USD' });
    expect(b.mirror).toBe(true);
    expect(b.converges).toBe(true);
  });

  it('деление вместо разности показало бы 24,99 — ровно то, чего мы избегаем', () => {
    const byDivision = (218_630n * 1_000_000n) / 87_452_190n; // усечение, как сделал бы наивный экран
    expect(byDivision).toBe(2_499n);
    expect(100_000n - byDivision).toBe(97_501n); // ≠ 97 500 — экран противоречил бы проводке
  });
});

describe('Б2-2: прочие формы сделки', () => {
  it('рублёвый мерчант без конверсии: выставлено − тариф = к выплате', () => {
    const b = buildPayoutBreakdown({ amountMinor: 8_745_219n, feeMinor: 218_630n, display: null, conversion: null });
    expect(b.rows.map((r) => [r.currency, r.minor])).toEqual([['RUB', 8_745_219n], ['RUB', 218_630n], ['RUB', 8_526_589n]]);
    expect(b.mirror).toBe(false);
    expect(b.converges).toBe(true);
    expect(b.rows[1]!.alsoMinor).toBeUndefined(); // валюты нет — второй колонки тоже
  });

  it('счёт в валюте, но зачислены рубли: тариф и выплата в ₽', () => {
    const b = buildPayoutBreakdown({ ...PROD, conversion: null });
    expect(b.mirror).toBe(false);
    expect(b.rows[0]).toMatchObject({ currency: 'USD', minor: 100_000n });
    expect(b.rows[2]).toMatchObject({ currency: 'RUB', minor: 8_526_589n });
    expect(b.converges).toBe(true);
  });

  it('незеркальная конверсия (рублёвый счёт → валюта): сходимость через курс сделки', () => {
    // нетто 85 265,89 ₽ ÷ 87,452190 = 975,000054 → вниз → 975,00 $
    const b = buildPayoutBreakdown({
      amountMinor: 8_745_219n, feeMinor: 218_630n, display: null,
      conversion: { currency: 'USD', targetMinor: 97_500n, dealRateE6: 87_452_190n },
    });
    expect(b.mirror).toBe(false);
    expect(b.converges).toBe(true);
    expect(b.rows[1]!.alsoMinor).toBeUndefined(); // без зеркала точного тождества в валюте нет — не выдумываем
  });

  it('🔴 подложная выплата ломает сходимость — экран обязан это показать, а не сгладить', () => {
    const b = buildPayoutBreakdown({ ...PROD, conversion: { currency: 'USD', targetMinor: 90_000n, dealRateE6: 87_452_190n } });
    expect(b.converges).toBe(false);
  });

  it('счёт без комиссии: ставки нет, цепочка всё равно сходится', () => {
    const b = buildPayoutBreakdown({ amountMinor: 500_000n, feeMinor: 0n, display: null, conversion: null });
    expect(b.effectiveRateBp).toBeNull();
    expect(b.rows[2]!.minor).toBe(500_000n);
    expect(b.converges).toBe(true);
  });

  it('отрицательные суммы — отбой, а не молчаливый минус на экране', () => {
    expect(() => buildPayoutBreakdown({ amountMinor: -1n, feeMinor: 0n, display: null, conversion: null })).toThrow(/отрицательными/);
  });
});

describe('Б2-2: наценка мерчанта не ломает сходимость', () => {
  /**
   * У мерчанта своя наценка клиентам, поэтому курс СЧЁТА выше нашего курса сделки.
   * Комиссия в валюте округлена до целого цента — обратный пересчёт в рубли законно
   * расходится на доли цента. Это не дефект операции, и экран не должен кричать.
   */
  it('курс счёта выше курса сделки — цепочка всё равно сходится', () => {
    const b = buildPayoutBreakdown({
      amountMinor: 9_161_658n, // 1000,00 $ по курсу с наценкой 91,61658
      feeMinor: 229_041n, // 2,5 %
      display: { currency: 'USD', amountMinor: 100_000n, rateE6: 91_616_580n },
      conversion: { currency: 'USD', targetMinor: 97_381n, dealRateE6: 87_452_190n },
    });
    expect(b.mirror).toBe(true);
    expect(b.rows[1]!.alsoMinor).toBe(2_619n); // 26,19 $
    expect(b.rows[0]!.minor - b.rows[1]!.alsoMinor!).toBe(b.rows[2]!.minor); // 1000 − 26,19 = 973,81
    expect(b.converges).toBe(true);
  });

  it('но подмену выплаты допуск НЕ прощает', () => {
    const b = buildPayoutBreakdown({
      amountMinor: 9_161_658n, feeMinor: 229_041n,
      display: { currency: 'USD', amountMinor: 100_000n, rateE6: 91_616_580n },
      conversion: { currency: 'USD', targetMinor: 95_000n, dealRateE6: 87_452_190n },
    });
    expect(b.converges).toBe(false);
  });
});

describe('Б2-2b: слои курса — зеркало подписывается честно', () => {
  it('🔴 спред выводится из пары база/наш курс, хотя в exchange_details у зеркала записан 0', () => {
    const b = buildPayoutBreakdown({
      ...PROD,
      display: { currency: 'USD', amountMinor: 100_000n, rateE6: 87_452_190n, baseRateE6: 83_287_800n, ourRateE6: 87_452_190n },
    });
    expect(b.rateLayers).toEqual({
      baseRateE6: 83_287_800n, spreadBp: 500, ourRateE6: 87_452_190n,
      merchantMarkupBp: 0, finalRateE6: 87_452_190n,
    });
    // Именно это позволяет писать «зашит в курс, 5 %» вместо «спред 0 %».
    expect(b.mirror).toBe(true);
  });

  it('наценка мерчанта видна отдельным слоем и не путается со спредом', () => {
    const b = buildPayoutBreakdown({
      amountMinor: 9_161_658n, feeMinor: 229_041n,
      display: { currency: 'USD', amountMinor: 100_000n, rateE6: 91_616_580n, baseRateE6: 83_287_800n, ourRateE6: 87_452_190n },
      conversion: { currency: 'USD', targetMinor: 97_381n, dealRateE6: 87_452_190n },
    });
    expect(b.rateLayers!.spreadBp).toBe(500); // наш спред — от базы ЦБ
    // 🔴 Слои УМНОЖАЮТСЯ, а не складываются: курс счёта здесь = база × 1,10, но наценка мерчанта
    // считается поверх НАШЕГО курса, то есть 1,10 / 1,05 − 1 = 4,76 %, а не 5 %. Это не ошибка
    // округления — так устроен курс, и подпись на экране обязана говорить именно про свой слой.
    expect(b.rateLayers!.merchantMarkupBp).toBe(476);
  });

  it('рублёвый инвойс — слоёв нет, ничего не выдумываем', () => {
    const b = buildPayoutBreakdown({ amountMinor: 8_745_219n, feeMinor: 218_630n, display: null, conversion: null });
    expect(b.rateLayers).toBeNull();
  });

  it('spreadBpFromRates: половина вверх, обратный порядок → 0', () => {
    expect(spreadBpFromRates(83_287_800n, 87_452_190n)).toBe(500);
    expect(spreadBpFromRates(100n, 100n)).toBe(0);
    expect(spreadBpFromRates(87_452_190n, 83_287_800n)).toBe(0); // не бывает отрицательного спреда
    expect(spreadBpFromRates(0n, 100n)).toBe(0);
  });
});

describe('Б2-2b: второе тождество — заработок платформы', () => {
  // Боевые числа: клиент 87 452,19 · эквайринг 2 186,30 · спред 4 060,29 · банк 1 224,33 ·
  // 975,00 $ по ЦБ 83,2878 = 81 205,60 (нога позиции пишется усечением).
  const e = buildPlatformEarnings({
    clientPaidMinor: 8_745_219n, acquiringMinor: 218_630n, spreadMinor: 406_029n,
    bankFeeMinor: 122_433n, payoutBaseValueMinor: 8_120_560n,
  });

  it('чистыми 5 022,26 ₽ = эквайринг + спред − банк', () => {
    expect(e.netMinor).toBe(502_226n);
  });

  it('валовая маржа 6 246,59 сходится с суммой двух заработков', () => {
    expect(e.grossMarginMinor).toBe(624_659n);
    expect(e.acquiringMinor + e.spreadMinor).toBe(624_659n);
    expect(e.converges).toBe(true);
  });

  it('🔴 банк НЕ входит в валовую маржу — он вычитается из доли платформы', () => {
    // Если бы банк считался удержанием с мерчанта, тождество разъехалось бы на 1 224,33.
    expect(e.grossMarginMinor - e.bankFeeMinor).not.toBe(e.acquiringMinor + e.spreadMinor);
    expect(e.netMinor).toBe(e.grossMarginMinor - e.bankFeeMinor);
  });

  it('подложенный спред ломает сходимость', () => {
    const bad = buildPlatformEarnings({
      clientPaidMinor: 8_745_219n, acquiringMinor: 218_630n, spreadMinor: 100_000n,
      bankFeeMinor: 122_433n, payoutBaseValueMinor: 8_120_560n,
    });
    expect(bad.converges).toBe(false);
  });
});

describe('(Пакет 5) заработок мерчанта на клиенте виден всегда', () => {
  // 100 $ по курсу счёта 90 ₽ = 9000 ₽ с клиента. Наш курс 85 ₽ → 8500 ₽.
  // Мерчант заработал 500 ₽, и это ЕГО деньги, а не платформы.
  const withMarkup = () =>
    buildPayoutBreakdown({
      amountMinor: 900_000n,
      feeMinor: 22_500n,
      display: { currency: 'USD', amountMinor: 10_000n, rateE6: 90_000_000n, baseRateE6: 80_000_000n, ourRateE6: 85_000_000n },
      conversion: null,
    });

  it('🔴 наценка есть → сумма в рублях и процент', () => {
    const b = withMarkup();
    expect(b.merchantEarning.minor).toBe(50_000n); // 500,00 ₽
    expect(b.merchantEarning.bp).toBe(588); // 90 / 85 − 1 ≈ 5,88 %
    expect(b.merchantEarning.basis).toBe('currency_invoice');
  });

  it('🔴 наценки нет → показываем НОЛЬ, а не прячем строку', () => {
    const b = buildPayoutBreakdown({
      amountMinor: 850_000n, feeMinor: 21_250n,
      display: { currency: 'USD', amountMinor: 10_000n, rateE6: 85_000_000n, baseRateE6: 80_000_000n, ourRateE6: 85_000_000n },
      conversion: null,
    });
    expect(b.merchantEarning.minor).toBe(0n);
    expect(b.merchantEarning.bp).toBe(0);
    expect(b.merchantEarning.basis).toBe('currency_invoice'); // валютный счёт, наценка нулевая
  });

  it('рублёвый счёт наценки не несёт вовсе — и это отдельное основание', () => {
    const b = buildPayoutBreakdown({ amountMinor: 500_000n, feeMinor: 12_500n, display: null, conversion: null });
    expect(b.merchantEarning.minor).toBe(0n);
    expect(b.merchantEarning.basis).toBe('ruble_invoice');
  });

  it('🔴 заработок мерчанта НЕ смешан с заработком платформы', () => {
    // Платформа зарабатывает на своём спреде (наш курс − ЦБ), мерчант — на своей наценке.
    // Числа обязаны быть разными: 8500 − 8000 = 500 у платформы, 9000 − 8500 = 500 у мерчанта,
    // но берутся они из РАЗНЫХ пар курсов и не имеют права подменять друг друга.
    const b = withMarkup();
    expect(b.rateLayers!.spreadBp).toBe(625); // 85 / 80 − 1
    expect(b.merchantEarning.bp).toBe(588); // 90 / 85 − 1
    expect(b.merchantEarning.bp).not.toBe(b.rateLayers!.spreadBp);
  });

  it('заработок считается разностью фактов, а не умножением на процент', () => {
    // Курс с длинным хвостом: «сумма × bp» дало бы третье число, не сходящееся с экраном.
    const b = buildPayoutBreakdown({
      amountMinor: 874_522n, feeMinor: 21_863n,
      display: { currency: 'USD', amountMinor: 10_000n, rateE6: 87_452_200n, baseRateE6: 83_287_800n, ourRateE6: 83_287_800n },
      conversion: null,
    });
    // 874 522 − 832 878 = 41 644, ровно как на экране.
    expect(b.merchantEarning.minor).toBe(41_644n);
  });
});

/**
 * (правка владельца 15.09.2026) Зеркало зачисляет наценку мерчанту. Разложение обязано показать её
 * строкой и сойтись: выставлено + наценка − тариф = к выплате. Старые сделки (без наценки в
 * зачислении) — показываются как были, без выдуманной строки.
 */
describe('зеркало: наценка мерчанта зачисляется ему', () => {
  const display = { currency: 'USD', amountMinor: 100_000n, rateE6: 91_616_580n, baseRateE6: 83_287_800n, ourRateE6: 87_452_190n };

  it('🔴 новая сделка: строка наценки 47,62 $, тариф 26,19 $, цепочка сходится', () => {
    const b = buildPayoutBreakdown({
      amountMinor: 9_161_658n, feeMinor: 229_041n, display,
      // 1000 + 47,62 − 26,19 = 1021,43 $ — ровно то, что зачисляет mirrorCreditInTarget.
      conversion: { currency: 'USD', targetMinor: 102_143n, dealRateE6: 87_452_190n },
    });
    expect(b.rows.map((r) => r.step)).toEqual(['issued', 'markup', 'fee', 'payout']);
    const markup = b.rows[1]!;
    expect(markup.minor).toBe(4_762n);
    expect(markup.alsoMinor).toBe(416_439n); // 4 164,39 ₽ — тот же заработок, что в сводке мерчанта
    expect(b.rows[2]!.alsoMinor).toBe(2_619n);
    expect(100_000n + markup.minor - b.rows[2]!.alsoMinor!).toBe(b.rows[3]!.minor);
    expect(b.converges).toBe(true);
    expect(b.merchantEarning.minor).toBe(416_439n);
  });

  it('старая сделка (наценка ушла в доход): строки наценки нет, цепочка как была', () => {
    const b = buildPayoutBreakdown({
      amountMinor: 9_161_658n, feeMinor: 229_041n, display,
      conversion: { currency: 'USD', targetMinor: 97_381n, dealRateE6: 87_452_190n },
    });
    expect(b.rows.map((r) => r.step)).toEqual(['issued', 'fee', 'payout']);
    expect(b.rows[1]!.alsoMinor).toBe(2_619n);
    expect(b.converges).toBe(true);
  });

  it('подмену зачисления допуск не прощает и с наценкой', () => {
    const b = buildPayoutBreakdown({
      amountMinor: 9_161_658n, feeMinor: 229_041n, display,
      conversion: { currency: 'USD', targetMinor: 110_000n, dealRateE6: 87_452_190n },
    });
    expect(b.converges).toBe(false);
  });
});


/**
 * 🔴 «Вы заработали» на ЧЕТЫРЁХЗНАЧНОЙ валюте. Дефект был замаскирован обрезанием в ноль: оценка
 * счёта по нашему курсу завышалась в сто раз, разность уходила в минус, и `diff > 0 ? diff : 0`
 * возвращал 0n ВСЕГДА. На экране это выглядело безобидно («наценки не было»), а в деньгах
 * означало, что наценка мерчанта не зачислялась ему, а доставалась доходу обмена
 * (`mirrorCreditInTarget` считает её этой же функцией).
 */
describe('merchantEarningOnInvoice — масштаб валюты счёта', () => {
  const our = 89_655_917n; // 89,655917 ₽ за 1 ₮
  const display = 2_260_000n; // счёт 226,0000 ₮
  const amountRub = 2_127_534n; // клиент заплатил 21 275,34 ₽ (наш курс + 5 % наценки мерчанта)

  it('🔴 тезер: наценка 1 013,11 ₽, а не ноль', () => {
    expect(merchantEarningOnInvoice({ amountMinor: amountRub, displayAmountMinor: display, ourRateE6: our, displayCurrency: 'USDT-TRC20' })).toBe(101_311n);
  });

  it('прежняя (двузначная) оценка того же счёта была 2 026 223,72 ₽ — отсюда вечный ноль', () => {
    const brokenAtOurRate = (display * our) / 1_000_000n;
    expect(brokenAtOurRate).toBe(202_622_372n); // 2 026 223,72 ₽ вместо 20 262,23 ₽
    expect(amountRub - brokenAtOurRate).toBeLessThan(0n);
    // Двузначный масштаб воспроизводит ровно прежнее поведение — ноль.
    expect(merchantEarningOnInvoice({ amountMinor: amountRub, displayAmountMinor: display, ourRateE6: our, displayCurrency: 'USDT-TRC20', displayMinorUnits: 2 })).toBe(0n);
  });

  it('двузначная валюта считается как прежде (регресс не внесён)', () => {
    // Боевая операция 25.08: 1000,00 $ по 83,2878 при уплаченных 87 452,19 ₽ → 4 164,41 ₽ наценки.
    expect(merchantEarningOnInvoice({ amountMinor: 8_745_219n, displayAmountMinor: 100_000n, ourRateE6: 83_287_800n, displayCurrency: 'USD' })).toBe(416_439n);
    // Курса нет / счёт рублёвый — ноль, как и было.
    expect(merchantEarningOnInvoice({ amountMinor: 8_745_219n, displayAmountMinor: null, ourRateE6: 83_287_800n, displayCurrency: 'USD' })).toBe(0n);
  });
});
