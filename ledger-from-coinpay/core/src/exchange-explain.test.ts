import { describe, expect, it } from 'vitest';
import { applySpread } from './rates';
import { amountsAgree, explainExchangeRate } from './exchange-explain';

/**
 * (CP PAY, PR-B) Числа — из эталона `design/reference-merchant-rules.html`, экран 07,
 * и из боевых данных прода (единственная зеркальная конверсия на 25.08.2026).
 */

const CBR_USD = 85_130_000n; // 85,13 ₽ за $ — эталон
const PROD_BASE = 83_287_800n; // 83,2878 — прод, курс дня RUB/USD
const PROD_DEAL = 87_452_200n; // 87,4522 — прод, курс сделки зеркальной конверсии

describe('обычная конверсия: курс = база × (1 + спред)', () => {
  it('эталон 07: ЦБ 85,13 + спред 4,5 % → 88,96, и расшифровка сходится', () => {
    const deal = applySpread(CBR_USD, 450);
    expect(Number(deal) / 1e6).toBeCloseTo(88.9608, 4);
    const e = explainExchangeRate({ baseRateE6: CBR_USD, markupBp: 450, dealRateE6: deal, mirror: false });
    expect(e.kind).toBe('spread');
    if (e.kind !== 'spread') throw new Error('ожидали spread');
    expect(e.converges).toBe(true);
    expect(e.spreadBp).toBe(450);
  });

  it('эталон 06: спред 2,0 % даёт 86,83', () => {
    expect(Number(applySpread(CBR_USD, 200)) / 1e6).toBeCloseTo(86.8326, 4);
  });

  it('несходящуюся расшифровку помечаем, а не подгоняем', () => {
    const e = explainExchangeRate({ baseRateE6: CBR_USD, markupBp: 450, dealRateE6: 99_000_000n, mirror: false });
    if (e.kind !== 'spread') throw new Error('ожидали spread');
    expect(e.converges).toBe(false); // экран обязан сказать это прямо
  });
});

describe('зеркало: курс из инвойса, а не «спред 0 %»', () => {
  it('боевая зеркальная конверсия 25.08 — kind=mirror, спред не показывается', () => {
    const e = explainExchangeRate({ baseRateE6: PROD_BASE, markupBp: 0, dealRateE6: PROD_DEAL, mirror: true });
    expect(e.kind).toBe('mirror');
    expect(e).not.toHaveProperty('spreadBp');
  });

  it('зеркало остаётся зеркалом даже при НЕнулевом markup_bp — признак не в нуле', () => {
    const e = explainExchangeRate({ baseRateE6: PROD_BASE, markupBp: 500, dealRateE6: PROD_DEAL, mirror: true });
    expect(e.kind).toBe('mirror');
  });
});

describe('незеркальный нулевой спред — это флаг, а не норма', () => {
  it('markup_bp = 0 без зеркала → no-spread (валюту отдали по голой базе ЦБ)', () => {
    const e = explainExchangeRate({ baseRateE6: PROD_BASE, markupBp: 0, dealRateE6: PROD_BASE, mirror: false });
    expect(e.kind).toBe('no-spread');
  });

  it('тот же markup_bp = 0 в зеркале флагом НЕ считается', () => {
    expect(explainExchangeRate({ baseRateE6: PROD_BASE, markupBp: 0, dealRateE6: PROD_DEAL, mirror: true }).kind).toBe('mirror');
  });
});

describe('сходимость сумм: сумма / курс = сумма', () => {
  it('эталон 07: 86 736,00 ₽ / 88,96 = 975,00 $', () => {
    expect(amountsAgree(8_673_600n, 97_500n, 88_960_000n)).toBe(true);
  });

  it('копейка округления допускается', () => {
    expect(amountsAgree(8_673_601n, 97_500n, 88_960_000n)).toBe(true);
  });

  it('расхождение больше копейки — не сходится', () => {
    expect(amountsAgree(8_673_700n, 97_500n, 88_960_000n)).toBe(false);
  });

  it('нулевой курс не выдаём за сходимость', () => {
    expect(amountsAgree(100n, 100n, 0n)).toBe(false);
  });
});

describe('тариф эквайринга в курс НЕ входит', () => {
  it('курс зависит только от базы и спреда — тариф на него не влияет', () => {
    // 4,5 % — тариф эквайринга CENTR; спред USD у него 5,0 %. Курс обязан считаться по 5,0 %.
    const bySpread = applySpread(PROD_BASE, 500);
    const byTariff = applySpread(PROD_BASE, 450);
    expect(bySpread).not.toBe(byTariff);
    expect(Number(bySpread) / 1e6).toBeCloseTo(87.4522, 4); // совпало с боевым курсом сделки
  });
});

describe('допуск сходимости считается в масштабе курса', () => {
  it('🔴 боевой случай: 93 788,62 ₽ → 983,55 USDT по 95,3569 — это СХОДИТСЯ', () => {
    // Расхождение 35 копеек целиком объясняется округлением USDT до цента:
    // один цент USDT стоит 95,36 ₽, значит рублёвая сторона гуляет до ±48 ₽.
    expect(amountsAgree(9_378_862n, 98_355n, 95_356_900n)).toBe(true);
  });

  it('рублёвый обмен с копеечным курсом по-прежнему строг', () => {
    // Курс 1,00 → цена минорной единицы копейка, допуск ~1 копейка: настоящее расхождение видно.
    expect(amountsAgree(10_000n, 10_000n, 1_000_000n)).toBe(true);
    expect(amountsAgree(10_050n, 10_000n, 1_000_000n)).toBe(false);
  });

  it('🔴 настоящее расхождение не прячется: половина суммы мимо курса — не сходится', () => {
    expect(amountsAgree(4_689_431n, 98_355n, 95_356_900n)).toBe(false);
  });

  it('нулевые входы — не сходится, а не «ок по умолчанию»', () => {
    expect(amountsAgree(1_000n, 0n, 95_356_900n)).toBe(false);
    expect(amountsAgree(1_000n, 100n, 0n)).toBe(false);
  });
});
