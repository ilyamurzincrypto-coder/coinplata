import { describe, expect, it } from 'vitest';
import { agentCan } from './agent-rbac';
import { agentTariffAllowed, isBackdated } from './tariff';

describe('коридор тарифа агента', () => {
  it('ставка не ниже базовой — допустима, ниже — нет', () => {
    expect(agentTariffAllowed(150, 260)).toBe(true);
    expect(agentTariffAllowed(150, 150)).toBe(true); // равно базовой — можно
    expect(agentTariffAllowed(150, 149)).toBe(false);
    expect(agentTariffAllowed(150, 0)).toBe(false);
  });
  it('верхней границы нет', () => {
    expect(agentTariffAllowed(150, 5000)).toBe(true);
  });
});

describe('тариф только «с даты»', () => {
  const now = new Date('2026-07-14T10:00:00Z'); // 13:00 по Москве, 14 июля
  it('вчерашний вечер — задним числом (отказ)', () => {
    expect(isBackdated(new Date('2026-07-13T20:59:00Z'), now)).toBe(true); // 23:59 МСК 13 июля
  });
  it('начало деловых суток и будущее — не задним числом', () => {
    expect(isBackdated(new Date('2026-07-13T21:00:00Z'), now)).toBe(false); // 00:00 МСК 14 июля
    expect(isBackdated(new Date('2026-07-20T00:00:00Z'), now)).toBe(false);
  });
  it('UTC-полночь того же дня проходит — её шлёт кабинет агента', () => {
    expect(isBackdated(new Date('2026-07-14T00:00:00Z'), now)).toBe(false);
  });

  /**
   * 🔴 Граница суток — ДЕЛОВАЯ, и запрос её не двигает.
   *
   * Живой случай, ради которого правило переписано: в 10:00 МСК момент «сегодня, 00:00 МСК» —
   * это 21:00Z вчерашнего дня. Форма предлагает его нижней границей, и сервер обязан принимать
   * ровно его (прежняя UTC-полночь резала). Но брать смещение ИЗ ЗАПРОСА нельзя: заявленным
   * «+14:00» ту же границу уводят почти на сутки назад.
   */
  describe('граница — деловые часы, а не пояс из запроса', () => {
    const at10Msk = new Date('2026-09-16T07:00:00Z'); // 10:00 по Москве
    const mskMidnight = new Date('2026-09-15T21:00:00Z'); // 16.09, 00:00 по Москве

    it('полночь деловых суток принимается (прежнее UTC-правило её резало)', () => {
      expect(isBackdated(mskMidnight, at10Msk)).toBe(false);
      // Как было до фикса: UTC-полночь 16.09 наступает позже, и момент считался прошлым.
      expect(mskMidnight.getTime()).toBeLessThan(Date.UTC(2026, 8, 16));
    });

    it('минута до начала деловых суток — отказ', () => {
      expect(isBackdated(new Date('2026-09-15T20:59:00Z'), at10Msk)).toBe(true);
    });

    it('🔴 момент, собранный с заявленным «+14:00», отбивается как прошлое', () => {
      // «2026-09-16T00:00:00+14:00» = 15.09, 10:00Z — почти на сутки раньше деловой полуночи.
      const hostile = new Date('2026-09-16T00:00:00+14:00');
      expect(hostile.getTime()).toBeLessThan(mskMidnight.getTime());
      expect(isBackdated(hostile, at10Msk)).toBe(true);
    });
  });
});

describe('RBAC агента (M5)', () => {
  it('owner может заводить мерчантов и менять тариф; staff — нет', () => {
    expect(agentCan('owner', 'merchant.onboard')).toBe(true);
    expect(agentCan('owner', 'tariff.manage')).toBe(true);
    expect(agentCan('staff', 'merchant.onboard')).toBe(false);
    expect(agentCan('staff', 'tariff.manage')).toBe(false);
    expect(agentCan('staff', 'portfolio.view')).toBe(true);
  });
});
