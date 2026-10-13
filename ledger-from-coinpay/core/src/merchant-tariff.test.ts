import { describe, expect, it } from 'vitest';
import {
  clientRubMinorForDisplay,
  finalMerchantRateE6,
  merchantEarningMinor,
  MARKUP_FLOOR_ERROR,
  resolveConversionTariff,
  resolveMerchantMarkup,
  validateMarkupBp,
  type ConversionTariffRow,
} from './merchant-tariff';

const d = (s: string) => new Date(s);
const rows: ConversionTariffRow[] = [
  { currency: 'USD', channel: 'cash', priceBp: 450, validFrom: d('2026-01-01') },
  { currency: 'USD', channel: 'cash', priceBp: 500, validFrom: d('2026-06-01') }, // новее — перекрывает
  { currency: 'USD', channel: null, priceBp: 600, validFrom: d('2026-01-01') }, // «любой канал»
  { currency: 'USDT', channel: 'crypto', priceBp: 420, validFrom: d('2026-01-01') },
];

describe('Волна10a resolveConversionTariff', () => {
  it('точное совпадение currency+channel, берёт новее по valid_from', () => {
    const r = resolveConversionTariff({ rows, currency: 'USD', channel: 'cash', at: d('2026-07-31'), fallbackBp: 200 });
    expect(r).toEqual({ priceBp: 500, matched: 'exact' });
  });

  it('«с даты»: до valid_from новой строки действует старая', () => {
    const r = resolveConversionTariff({ rows, currency: 'USD', channel: 'cash', at: d('2026-03-01'), fallbackBp: 200 });
    expect(r).toEqual({ priceBp: 450, matched: 'exact' });
  });

  it('fallback канала: нет точного channel → строка channel=null', () => {
    const r = resolveConversionTariff({ rows, currency: 'USD', channel: 'crypto', at: d('2026-07-31'), fallbackBp: 200 });
    expect(r).toEqual({ priceBp: 600, matched: 'any-channel' });
  });

  it('другая валюта по своему тарифу', () => {
    const r = resolveConversionTariff({ rows, currency: 'USDT', channel: 'crypto', at: d('2026-07-31'), fallbackBp: 200 });
    expect(r).toEqual({ priceBp: 420, matched: 'exact' });
  });

  it('нет тарифа → дефолт платформы', () => {
    const r = resolveConversionTariff({ rows, currency: 'EUR', channel: 'cash', at: d('2026-07-31'), fallbackBp: 200 });
    expect(r).toEqual({ priceBp: 200, matched: 'default' });
  });

  it('тариф из будущего не применяется', () => {
    const future: ConversionTariffRow[] = [{ currency: 'GBP', channel: 'cash', priceBp: 300, validFrom: d('2027-01-01') }];
    const r = resolveConversionTariff({ rows: future, currency: 'GBP', channel: 'cash', at: d('2026-07-31'), fallbackBp: 200 });
    expect(r.matched).toBe('default');
  });
});

describe('Волна10b итоговый курс мерчанта', () => {
  // Базовый курс дня $ = 78,7080 ₽ → rubEquivE6 = 78_708_000.
  const base = 78_708_000n;

  it('наш курс = базовый × (1 + price_bp), округл. вверх', () => {
    // price 4,5% (450 bp): 78_708_000 × 10450 / 10000 = 82_249_860 → ₽/ед ×1e6.
    expect(finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 450, clientMarkupBp: 0 })).toBe(82_249_860n);
  });

  it('итог клиенту = базовый × (1 + price_bp + client_markup_bp)', () => {
    // price 450 + наценка 150 = 600 bp: 78_708_000 × 10600 / 10000 = 83_430_480.
    expect(finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 450, clientMarkupBp: 150 })).toBe(83_430_480n);
  });

  it('округление ВВЕРХ (в пользу платформы/мерчанта), а не вниз', () => {
    // base=1 (×1e6), 1 bp суммарно: 1_000_000 × 10001 / 10000 = 1_000_100.0 → тут ровно.
    // Возьмём остаток: base=333, bp=+1 → 333 × 10001 / 10000 = 333.033 → ceil = 334.
    expect(finalMerchantRateE6({ baseRubPerUnitE6: 333n, priceBp: 1, clientMarkupBp: 0 })).toBe(334n);
  });

  it('markup=0 совпадает с «нашим» курсом', () => {
    const our = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 450, clientMarkupBp: 0 });
    const final0 = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 450, clientMarkupBp: 0 });
    expect(our).toBe(final0);
  });

  it('bp должны быть целыми ≥ 0', () => {
    expect(() => finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: -1, clientMarkupBp: 0 })).toThrow();
    expect(() => finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 1.5, clientMarkupBp: 0 })).toThrow();
  });

  it('«клиент платит» ₽ = сумма-валюта × итог-курс, округл. вверх', () => {
    // 100 $ = 10000 центов; курс 80,15 ₽ = 80_150_000. → 10000 × 80_150_000 / 1e6 = 801_500 копеек = 8015 ₽.
    expect(clientRubMinorForDisplay(10_000n, 80_150_000n)).toBe(801_500n);
  });

  it('«клиент платит» округляется вверх при дробном остатке', () => {
    // 1 валют-цент × курс 80_150_001 (₽/ед ×1e6) / 1e6 = 80.150001 копейки → ceil = 81 копейка.
    expect(clientRubMinorForDisplay(1n, 80_150_001n)).toBe(81n);
  });

  it('POS-валюта БЕЗ тарифа мерчанта → matched=default → в переключателе disabled', () => {
    // Правило страницы POS: enabled ⇔ есть курс дня И matched !== "default".
    const r = resolveConversionTariff({ rows, currency: 'EUR', channel: 'cash', at: d('2026-07-31'), fallbackBp: 200 });
    const enabled = r.matched !== 'default';
    expect(enabled).toBe(false);
  });
});

describe('per-валюта наценка + floor + заработок (Волна10b доработка)', () => {
  const markups = [
    { currency: 'USD', markupBp: 200 }, // своя 2%
    { currency: 'TRY', markupBp: 50 }, // своя 0,5%
  ];
  it('валюта со своей наценкой → own', () => {
    expect(resolveMerchantMarkup({ rows: markups, currency: 'USD', generalBp: 150 })).toEqual({ markupBp: 200, source: 'own' });
    expect(resolveMerchantMarkup({ rows: markups, currency: 'TRY', generalBp: 150 })).toEqual({ markupBp: 50, source: 'own' });
  });
  it('валюта без своей наценки → наследует общую (inherited)', () => {
    expect(resolveMerchantMarkup({ rows: markups, currency: 'EUR', generalBp: 150 })).toEqual({ markupBp: 150, source: 'inherited' });
  });
  it('отрицательная общая наценка нормализуется к 0 при наследовании', () => {
    expect(resolveMerchantMarkup({ rows: [], currency: 'EUR', generalBp: -50 })).toEqual({ markupBp: 0, source: 'inherited' });
  });

  it('floor: −1% (−100 bp) → отказ с текстом «в убыток»', () => {
    const r = validateMarkupBp(-100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(MARKUP_FLOOR_ERROR);
  });
  it('floor: 0% → допустимо (итог = наш курс ровно)', () => {
    expect(validateMarkupBp(0).ok).toBe(true);
    const base = 79_460_000n; // 79,46 ₽/$ ×1e6
    const our = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 0 });
    const at0 = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 0 });
    expect(at0).toBe(our); // 0% ⇔ ровно наш итог
  });
  it('floor: +1,5% → допустимо и строго выше нашего курса', () => {
    expect(validateMarkupBp(150).ok).toBe(true);
    const base = 79_460_000n;
    const our = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 0 });
    const fin = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 150 });
    expect(fin > our).toBe(true);
  });
  it('floor: сверх капа → отказ', () => {
    expect(validateMarkupBp(1500).ok).toBe(false); // >10%
  });

  it('заработок мерчанта = дельта его курса × сумма (его прибыль, 100% его)', () => {
    // 100 $ · база 79,46 · наша цена 5% · его наценка 1,5%
    const base = 79_460_000n;
    const our = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 0 }); // 83,44 ₽/$
    const fin = finalMerchantRateE6({ baseRubPerUnitE6: base, priceBp: 500, clientMarkupBp: 150 }); // 84,63 ₽/$
    const earn = merchantEarningMinor({ displayAmountMinor: 10_000n, finalRateE6: fin, ourRateE6: our });
    // его заработок = (клиент по его курсу) − (клиент по нашему курсу), копейки
    const client = clientRubMinorForDisplay(10_000n, fin);
    const ours = clientRubMinorForDisplay(10_000n, our);
    expect(earn).toBe(client - ours);
    expect(earn > 0n).toBe(true); // при наценке >0 он в плюсе
  });
});
