import { describe, expect, it } from 'vitest';
import { isStaticNspkLink, staticQrWithAmount } from './static-qr';

const BASE = 'https://qr.nspk.ru/BS2A004J1LES5ESS88QBA6CDMDFJDIR3';

describe('статический QR СБП + сумма', () => {
  it('100 ₽ → sum=10000&cur=RUB', () => {
    expect(staticQrWithAmount(BASE, 10_000n)).toBe(`${BASE}?sum=10000&cur=RUB`);
  });
  it('копейки не теряются', () => {
    expect(staticQrWithAmount(BASE, 885_550n)).toBe(`${BASE}?sum=885550&cur=RUB`);
  });
  it('имеющиеся параметры сохраняются, sum/cur перезаписываются', () => {
    expect(staticQrWithAmount(`${BASE}?type=01&sum=1`, 500n)).toBe(`${BASE}?type=01&sum=500&cur=RUB`);
  });
  it('принимает только https://qr.nspk.ru/<id>', () => {
    expect(isStaticNspkLink(BASE)).toBe(true);
    expect(isStaticNspkLink('http://qr.nspk.ru/BS2A004J1LES5ESS88QBA6CDMDFJDIR3')).toBe(false);
    expect(isStaticNspkLink('https://evil.ru/BS2A004J1LES5ESS88QBA6CDMDFJDIR3')).toBe(false);
    expect(isStaticNspkLink('не ссылка')).toBe(false);
  });
  it('сумма ≤ 0 и чужая ссылка — ошибка', () => {
    expect(() => staticQrWithAmount(BASE, 0n)).toThrow();
    expect(() => staticQrWithAmount('https://evil.ru/x', 100n)).toThrow();
  });
});
