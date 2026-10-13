import { describe, expect, it } from 'vitest';
import {
  ceilDivBig,
  dealRateE6,
  floorDivBig,
  formatRateE6Exact,
  resolveMarkupBp,
  roundHalfEvenDiv,
  rubToPayForUsd,
  rubToReceiveForUsd,
  usdToReceiveForRub,
} from './fx';

describe('resolveMarkupBp — приоритет индивид > групп > дефолт', () => {
  it('индивидуальная перекрывает всё', () => {
    expect(resolveMarkupBp({ individual: 150, group: 300, fallback: 200 })).toBe(150);
  });
  it('группа при отсутствии индивидуальной', () => {
    expect(resolveMarkupBp({ individual: null, group: 300, fallback: 200 })).toBe(300);
  });
  it('дефолт при отсутствии обеих', () => {
    expect(resolveMarkupBp({ individual: null, group: null, fallback: 200 })).toBe(200);
  });
  it('индивидуальная 0 — это значение, не «нет»', () => {
    expect(resolveMarkupBp({ individual: 0, group: 300, fallback: 200 })).toBe(0);
  });
});

describe('ceil/floorDivBig', () => {
  it('точное деление', () => {
    expect(floorDivBig(100n, 4n)).toBe(25n);
    expect(ceilDivBig(100n, 4n)).toBe(25n);
  });
  it('с остатком', () => {
    expect(floorDivBig(101n, 4n)).toBe(25n);
    expect(ceilDivBig(101n, 4n)).toBe(26n);
  });
  it('делитель <= 0 — ошибка', () => {
    expect(() => floorDivBig(1n, 0n)).toThrow();
    expect(() => ceilDivBig(1n, -1n)).toThrow();
  });
});

describe('dealRateE6 — база × (1+наценка), ceil в пользу платформы', () => {
  it('база 90.00 + 2% = 91.80', () => {
    expect(dealRateE6(90_000000n, 200)).toBe(91_800000n);
  });
  it('наценка 0 → базовый курс', () => {
    expect(dealRateE6(90_123400n, 0)).toBe(90_123400n);
  });
  it('дробный результат округляется вверх', () => {
    // 90000001 × 10001 / 10000 = 90009001.0001 → ceil = 90009002
    expect(dealRateE6(90_000001n, 1)).toBe(90_009002n);
  });
});

describe('округление к выгоде платформы — краевой 0,005 $', () => {
  it('клиент покупает USD за 10000₽ по 91.80 → floor(10893.24)=10893 коп-USD (108,93 $)', () => {
    // 1000000 коп-RUB × 1e6 / 91800000 = 10893.24 → floor 10893
    expect(usdToReceiveForRub(1_000_000n, 91_800000n)).toBe(10893n);
  });
  it('rub за usd при покупке — ceil (клиент платит), при продаже — floor (получает)', () => {
    // 100.005 $ = 10000 копеек-USD... используем сумму, дающую дробную копейку RUB
    const usd = 3n; // 0,03 $
    const rate = 90_015000n; // 90.015 ₽/$
    // ровно: 3 × 90015000 / 1e6 = 270.045 → pay ceil 271, receive floor 270
    expect(rubToPayForUsd(usd, rate)).toBe(271n);
    expect(rubToReceiveForUsd(usd, rate)).toBe(270n);
  });
  it('точное деление: ceil==floor', () => {
    expect(rubToPayForUsd(100n, 90_000000n)).toBe(9000n);
    expect(rubToReceiveForUsd(100n, 90_000000n)).toBe(9000n);
  });
});

describe('roundHalfEvenDiv — банковское округление (дефолт обмена)', () => {
  it('половина → к чётному', () => {
    expect(roundHalfEvenDiv(5n, 2n)).toBe(2n); // 2.5 → 2 (чёт)
    expect(roundHalfEvenDiv(7n, 2n)).toBe(4n); // 3.5 → 4 (чёт)
    expect(roundHalfEvenDiv(3n, 2n)).toBe(2n); // 1.5 → 2 (чёт)
    expect(roundHalfEvenDiv(1n, 2n)).toBe(0n); // 0.5 → 0 (чёт)
  });
  it('краевой 0,005 на уровне копеек (×1000): 10893.5 → 10894, 10894.5 → 10894', () => {
    expect(roundHalfEvenDiv(21787n, 2n)).toBe(10894n); // 10893.5 → 10894 (чёт)
    expect(roundHalfEvenDiv(21789n, 2n)).toBe(10894n); // 10894.5 → 10894 (чёт)
  });
  it('не-половина округляется как обычно', () => {
    expect(roundHalfEvenDiv(101n, 4n)).toBe(25n); // 25.25 → 25
    expect(roundHalfEvenDiv(103n, 4n)).toBe(26n); // 25.75 → 26
  });
  it('делитель <= 0 — ошибка', () => {
    expect(() => roundHalfEvenDiv(1n, 0n)).toThrow();
  });
});

describe('formatRateE6Exact', () => {
  it('обрезает хвостовые нули', () => {
    expect(formatRateE6Exact(90_100000n)).toBe('90,1');
    expect(formatRateE6Exact(90_123400n)).toBe('90,1234');
    expect(formatRateE6Exact(91_800000n)).toBe('91,8');
  });
});
