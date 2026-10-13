import { describe, expect, it } from 'vitest';
import {
  impliedMarkupBp, payoutMinorForRub, pointClientRateE6, pointEarningUsdtMinor, pointPlatformRateE6, pointPrice,
  rubForPayoutMinor, sheetRowClientRateE6, sheetRowMarkupBp, sheetRowPayoutCurrency, sheetUnitsPerUsdtE6,
} from './qr-point-price';
import { clientUsdtRateE6 } from './point-rate-sheet';
import { merchantUsdtRateE6, providerRateE6, rubToUsdtMinor, usdtToRubMinor } from './qr-provider';

/**
 * Цена клиенту в пункте: цепочка ЦБ → провайдер → платформа → надбавка пункта.
 *
 * Проверяем то, что стоит денег: цепочка считает одинаково для всех четырёх валют, тезер
 * по-прежнему повторяет прежние функции кассы (иначе волна тихо поменяла бы цену ₮), пол
 * «ниже платформы не продаём» держится, и процент пункта выводится из утреннего листа ровно тот,
 * который в нём написан.
 */
const CB_USD = 84_236_200n; // 84,2362 ₽ за $ (и за ₮ — тезер по курсу доллара ЦБ)
const CB_TRY = 1_731_350n; // 1,73135 ₽ за ₺
const CB_EUR = 96_667_100n; // 96,6671 ₽ за €
const PROVIDER_BP = 300; // надбавка провайдера, 3 %
const PLATFORM_BP = 200; // наценка платформы, 2 %

const platform = (cb: bigint) => pointPlatformRateE6({ cbRubPerUnitE6: cb, providerMarkupBp: PROVIDER_BP, platformPriceBp: PLATFORM_BP });
const price = (currency: 'TRY' | 'USD' | 'EUR' | 'USDT', cb: bigint, markupBp: number) =>
  pointPrice({ currency, cbRubPerUnitE6: cb, providerMarkupBp: PROVIDER_BP, platformPriceBp: PLATFORM_BP, markupBp });

describe('курс платформы пункта', () => {
  it('та же цепочка и те же функции, что у кассы при выбивании QR', () => {
    expect(platform(CB_USD)).toBe(merchantUsdtRateE6(providerRateE6(CB_USD, PROVIDER_BP), PLATFORM_BP));
  });

  it('курс платформы выше курса ЦБ у каждой валюты — надбавки только вверх', () => {
    for (const cb of [CB_USD, CB_TRY, CB_EUR]) expect(platform(cb)).toBeGreaterThan(cb);
  });

  it('дешёвая валюта не теряет точность: у лиры курс платформы считается в тех же e6', () => {
    // 1,73135 × 1,03 × 1,02 ≈ 1,8190 ₽ за ₺ — не ноль и не единица.
    expect(platform(CB_TRY)).toBeGreaterThan(1_800_000n);
    expect(platform(CB_TRY)).toBeLessThan(1_840_000n);
  });
});

describe('цена клиенту = курс платформы + надбавка пункта', () => {
  it('надбавка ноль — цена ровно по себестоимости, это законно', () => {
    const p = price('TRY', CB_TRY, 0)!;
    expect(p.clientRateE6).toBe(p.platformRateE6);
  });

  it('надбавка поднимает цену вверх (клиент платит больше рублей за единицу)', () => {
    const p = price('TRY', CB_TRY, 121)!;
    expect(p.clientRateE6).toBeGreaterThan(p.platformRateE6);
    // 1,21 % от курса платформы — с точностью до округления вверх.
    expect(p.clientRateE6 - p.platformRateE6).toBe((p.platformRateE6 * 121n + 9_999n) / 10_000n);
  });

  it('🔴 отрицательная надбавка — цены нет: пункт продавал бы себе в убыток', () => {
    expect(price('USD', CB_USD, -1)).toBeNull();
    expect(pointClientRateE6(platform(CB_USD), -50)).toBeNull();
  });

  it('нет курса ЦБ — цены нет, а не «ноль»', () => {
    expect(price('EUR', 0n, 100)).toBeNull();
  });

  it('все четыре валюты считаются одной функцией и дают три числа цепочки', () => {
    const rows = [price('TRY', CB_TRY, 121)!, price('USD', CB_USD, 70)!, price('EUR', CB_EUR, 90)!, price('USDT', CB_USD, 300)!];
    for (const r of rows) {
      expect(r.clientRateE6).toBeGreaterThanOrEqual(r.platformRateE6);
      expect(r.platformRateE6).toBeGreaterThan(0n);
    }
    // Доллар и тезер стоят на одном курсе ЦБ — курс платформы у них совпадает (₮ = доллар ЦБ).
    expect(rows[1]!.platformRateE6).toBe(rows[3]!.platformRateE6);
  });

  it('🔴 тезер считается ровно тем же числом, что и прежней ценой кассы', () => {
    const p = price('USDT', CB_USD, 300)!;
    expect(p.clientRateE6).toBe(clientUsdtRateE6(p.platformRateE6, { from: 'RUB', to: 'USDT', kind: 'pct', bp: 300 }));
  });
});

describe('рубли ↔ выдача: округление в пользу платформы', () => {
  const p = price('TRY', CB_TRY, 121)!;

  it('клиент платит — вверх', () => {
    const cash = 200_000n; // 2 000,00 ₺
    expect(rubForPayoutMinor(cash, p.clientRateE6, 'TRY')).toBe((cash * p.clientRateE6 + 999_999n) / 1_000_000n);
  });

  it('клиент получает — вниз', () => {
    const rub = 368_194n;
    expect(payoutMinorForRub(rub, p.clientRateE6, 'TRY')).toBe((rub * 1_000_000n) / p.clientRateE6);
  });

  it('🔴 тезер (4 знака) считается теми же числами, что и прежние функции кассы', () => {
    const rate = platform(CB_USD);
    expect(rubForPayoutMinor(500_000n, rate, 'USDT')).toBe(usdtToRubMinor(500_000n, rate, 'ceil'));
    expect(payoutMinorForRub(4_400_000n, rate, 'USDT')).toBe(rubToUsdtMinor(4_400_000n, rate));
  });

  it('туда-обратно клиент не выигрывает: выдача по рублям не больше набранной', () => {
    const cash = 200_000n;
    const rub = rubForPayoutMinor(cash, p.clientRateE6, 'TRY');
    expect(payoutMinorForRub(rub, p.clientRateE6, 'TRY')).toBeLessThanOrEqual(cash + 1n);
  });
});

describe('утренний лист → процент пункта', () => {
  const platformUsdt = platform(CB_USD);
  const platformTry = platform(CB_TRY);
  const platformEur = platform(CB_EUR);

  it('лира: «USDT -> TRY 48,05» читается как лиры за тезер', () => {
    expect(sheetUnitsPerUsdtE6({ from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 48_050_000n })).toBe(48_050_000n);
  });

  it('евро котируется наоборот — тезеров за евро', () => {
    // 1,15 ₮ за 1 € → 0,8695… € за 1 ₮.
    const units = sheetUnitsPerUsdtE6({ from: 'USDT', to: 'EUR', kind: 'abs', rateE6: 1_150_000n })!;
    expect(units).toBeGreaterThan(860_000n);
    expect(units).toBeLessThan(880_000n);
  });

  it('доллар процентом: «−0,70 %» — клиент получает на 0,7 % меньше долларов', () => {
    expect(sheetUnitsPerUsdtE6({ from: 'USDT', to: 'USD', kind: 'pct', bp: -70 })).toBe(993_000n);
  });

  it('🔴 «USDT -> TRY 48,05» при кроссе 48,63 даёт надбавку около 1,2 %', () => {
    // Кросс платформы: ₽/₮ ÷ ₽/₺ = сколько лир за тезер мы сами считаем (≈48,63).
    const bp = sheetRowMarkupBp({ from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 48_050_000n }, { usdtRateE6: platformUsdt, currencyRateE6: platformTry })!;
    expect(bp).toBeGreaterThanOrEqual(115);
    expect(bp).toBeLessThanOrEqual(125);
  });

  it('доллар −0,70 % даёт надбавку около 0,70 %', () => {
    const bp = sheetRowMarkupBp({ from: 'USDT', to: 'USD', kind: 'pct', bp: -70 }, { usdtRateE6: platformUsdt, currencyRateE6: platformUsdt })!;
    expect(bp).toBeGreaterThanOrEqual(69);
    expect(bp).toBeLessThanOrEqual(71);
  });

  it('евро: цена из листа выше курса платформы — надбавка положительна', () => {
    const row = { from: 'USDT', to: 'EUR', kind: 'abs', rateE6: 1_150_000n } as const;
    const client = sheetRowClientRateE6(row, platformUsdt)!;
    expect(client).toBeGreaterThan(platformEur);
    expect(sheetRowMarkupBp(row, { usdtRateE6: platformUsdt, currencyRateE6: platformEur })).toBe(impliedMarkupBp(client, platformEur));
  });

  it('🔴 процент тезера берётся как написан, без вывода из цены', () => {
    expect(sheetRowMarkupBp({ from: 'RUB', to: 'USDT', kind: 'pct', bp: 300 }, { usdtRateE6: platformUsdt, currencyRateE6: platformUsdt })).toBe(300);
  });

  it('цена тезера руками: надбавка выводится из курса платформы', () => {
    const client = platformUsdt + platformUsdt / 100n; // ≈ +1 %
    const bp = sheetRowMarkupBp({ from: 'RUB', to: 'USDT', kind: 'abs', rateE6: client }, { usdtRateE6: platformUsdt, currencyRateE6: platformUsdt })!;
    expect(bp).toBeGreaterThanOrEqual(99);
    expect(bp).toBeLessThanOrEqual(100);
  });

  it('🔴 цена ниже курса платформы в надбавку не превращается', () => {
    // 50 лир за тезер при кроссе 48,63 — клиент получал бы больше лир, чем мы сами считаем.
    expect(sheetRowMarkupBp({ from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 50_000_000n }, { usdtRateE6: platformUsdt, currencyRateE6: platformTry })).toBeNull();
    expect(impliedMarkupBp(platformTry - 1n, platformTry)).toBeNull();
  });

  it('надбавка округляется ВНИЗ — вставка не поднимает цену выше присланной', () => {
    expect(impliedMarkupBp(platformTry * 2n - 1n, platformTry)).toBe(9_999);
  });

  it('приёмные строки листа ценой клиенту не являются', () => {
    expect(sheetRowPayoutCurrency({ from: 'USD', to: 'USDT', kind: 'pct', bp: -30 })).toBeNull();
    expect(sheetRowClientRateE6({ from: 'USD', to: 'USDT', kind: 'pct', bp: -30 }, platformUsdt)).toBeNull();
    expect(sheetRowPayoutCurrency({ from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 48_050_000n })).toBe('TRY');
    expect(sheetRowPayoutCurrency({ from: 'RUB', to: 'USDT', kind: 'pct', bp: 300 })).toBe('USDT');
  });
});

describe('заработок пункта на своей надбавке — в тезере', () => {
  const MARKUP_BP = 121;
  const usdt = price('USDT', CB_USD, 300)!;
  const lira = price('TRY', CB_TRY, MARKUP_BP)!;

  /** Одна оплата: клиент получил `cash`, мы зачислили пункту тезер по курсу платформы. */
  function payment(cash: bigint, p: { clientRateE6: bigint; platformRateE6: bigint; currency: 'TRY' | 'USDT' }) {
    const rub = rubForPayoutMinor(cash, p.clientRateE6, p.currency);
    const credited = payoutMinorForRub(rub, usdt.platformRateE6, 'USDT');
    return pointEarningUsdtMinor({
      payoutCurrency: p.currency,
      payoutMinor: cash,
      payoutPlatformRateE6: p.platformRateE6,
      merchantRateE6: usdt.platformRateE6,
      creditedUsdtMinor: credited,
    });
  }

  it('🔴 выдали лиры: заработок ≈ надбавка от суммы, в тезере', () => {
    const earned = payment(200_000n, { ...lira, currency: 'TRY' });
    // 2 000 ₺ ≈ 41,1 ₮ себестоимости; 1,21 % от них ≈ 0,497 ₮ (4 970 минорных единиц).
    expect(earned).toBeGreaterThan(4_900n);
    expect(earned).toBeLessThan(5_050n);
  });

  it('🔴 выдали тезер: заработок считается тем же правилом', () => {
    const earned = payment(500_000n, { ...usdt, currency: 'USDT' });
    // 50 ₮ с надбавкой 3 % → ≈1,5 ₮ заработка.
    expect(earned).toBeGreaterThan(14_500n);
    expect(earned).toBeLessThan(15_100n);
  });

  it('надбавки нет — заработка нет (и минуса тоже)', () => {
    const zero = price('TRY', CB_TRY, 0)!;
    expect(payment(200_000n, { ...zero, currency: 'TRY' })).toBe(0n);
  });

  it('рублёвый режим: клиент платит рубли и получает их же — заработка на курсе нет', () => {
    const earned = pointEarningUsdtMinor({
      payoutCurrency: 'RUB',
      payoutMinor: 500_000n,
      payoutPlatformRateE6: 1_000_000n,
      merchantRateE6: usdt.platformRateE6,
      creditedUsdtMinor: payoutMinorForRub(500_000n, usdt.platformRateE6, 'USDT'),
    });
    expect(earned).toBe(0n);
  });

  it('битые входы не дают выдуманного заработка', () => {
    const base = { payoutCurrency: 'TRY' as const, payoutMinor: 200_000n, payoutPlatformRateE6: lira.platformRateE6, merchantRateE6: usdt.platformRateE6, creditedUsdtMinor: 400_000n };
    expect(pointEarningUsdtMinor({ ...base, merchantRateE6: 0n })).toBe(0n);
    expect(pointEarningUsdtMinor({ ...base, creditedUsdtMinor: 0n })).toBe(0n);
    expect(pointEarningUsdtMinor({ ...base, payoutMinor: 0n })).toBe(0n);
  });
});
