import { describe, expect, it } from 'vitest';
import {
  parseIsoDay,
  periodToQuery,
  resolvePeriod,
  toIsoDay,
  utcDayStart,
} from './period';

// Фиксированный «сейчас»: 2026-07-10 13:37 UTC (среда).
const NOW = new Date('2026-07-10T13:37:00Z');
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe('resolvePeriod — пресеты (границы по UTC-суткам)', () => {
  it('today = сутки [10 июля, 11 июля)', () => {
    const p = resolvePeriod({ period: 'today' }, { now: NOW });
    expect(p.preset).toBe('today');
    expect(p.from).toEqual(day('2026-07-10'));
    expect(p.to).toEqual(day('2026-07-11'));
    expect(p.label).toBe('Сегодня');
  });

  it('yesterday = [9 июля, 10 июля)', () => {
    const p = resolvePeriod({ period: 'yesterday' }, { now: NOW });
    expect(p.from).toEqual(day('2026-07-09'));
    expect(p.to).toEqual(day('2026-07-10'));
  });

  it('7d = 7 календарных суток включая сегодня [4 июля, 11 июля)', () => {
    const p = resolvePeriod({ period: '7d' }, { now: NOW });
    expect(p.from).toEqual(day('2026-07-04'));
    expect(p.to).toEqual(day('2026-07-11'));
  });

  it('month = [1 июля, 1 августа)', () => {
    const p = resolvePeriod({ period: 'month' }, { now: NOW });
    expect(p.from).toEqual(day('2026-07-01'));
    expect(p.to).toEqual(day('2026-08-01'));
  });

  it('prevmonth = [1 июня, 1 июля)', () => {
    const p = resolvePeriod({ period: 'prevmonth' }, { now: NOW });
    expect(p.from).toEqual(day('2026-06-01'));
    expect(p.to).toEqual(day('2026-07-01'));
  });

  it('prevmonth через границу года (январь → декабрь)', () => {
    const p = resolvePeriod({ period: 'prevmonth' }, { now: new Date('2026-01-15T10:00:00Z') });
    expect(p.from).toEqual(day('2025-12-01'));
    expect(p.to).toEqual(day('2026-01-01'));
  });
});

describe('resolvePeriod — произвольный', () => {
  it('from+to включительно, to → начало след. суток', () => {
    const p = resolvePeriod({ from: '2026-03-01', to: '2026-03-31' }, { now: NOW });
    expect(p.preset).toBe('custom');
    expect(p.from).toEqual(day('2026-03-01'));
    expect(p.to).toEqual(day('2026-04-01'));
  });

  it('один день: from == to → сутки', () => {
    const p = resolvePeriod({ from: '2026-03-05', to: '2026-03-05' }, { now: NOW });
    expect(p.from).toEqual(day('2026-03-05'));
    expect(p.to).toEqual(day('2026-03-06'));
    expect(p.label).toBe('5 марта 2026');
  });

  it('обратный ввод (from > to) — меняет местами', () => {
    const p = resolvePeriod({ from: '2026-03-31', to: '2026-03-01' }, { now: NOW });
    expect(p.from).toEqual(day('2026-03-01'));
    expect(p.to).toEqual(day('2026-04-01'));
  });

  it('битый произвольный → дефолт (месяц)', () => {
    const p = resolvePeriod({ from: 'не-дата' }, { now: NOW });
    expect(p.preset).toBe('month');
  });
});

describe('resolvePeriod — дефолты и мусор', () => {
  it('пусто → дефолтный пресет «месяц»', () => {
    expect(resolvePeriod({}, { now: NOW }).preset).toBe('month');
  });
  it('переопределённый дефолт', () => {
    expect(resolvePeriod({}, { now: NOW, defaultPreset: '7d' }).preset).toBe('7d');
  });
  it('неизвестный пресет → дефолт', () => {
    expect(resolvePeriod({ period: 'quarter' }, { now: NOW }).preset).toBe('month');
  });
});

describe('parseIsoDay / toIsoDay', () => {
  it('валидная дата', () => {
    expect(parseIsoDay('2026-07-10')).toEqual(day('2026-07-10'));
  });
  it('переполнение отсекается (31 февраля)', () => {
    expect(parseIsoDay('2026-02-31')).toBeNull();
  });
  it('мусор', () => {
    expect(parseIsoDay('10.07.2026')).toBeNull();
    expect(parseIsoDay(undefined)).toBeNull();
  });
  it('round-trip', () => {
    expect(toIsoDay(day('2026-07-10'))).toBe('2026-07-10');
  });
});

describe('periodToQuery — URL round-trip', () => {
  it('пресет → period=…', () => {
    expect(periodToQuery(resolvePeriod({ period: '7d' }, { now: NOW }))).toEqual({ period: '7d' });
  });

  it('произвольный → from/to (включительно) и round-trip через resolvePeriod', () => {
    const q = periodToQuery(resolvePeriod({ from: '2026-03-01', to: '2026-03-31' }, { now: NOW }));
    expect(q).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    const back = resolvePeriod(q, { now: NOW });
    expect(back.from).toEqual(day('2026-03-01'));
    expect(back.to).toEqual(day('2026-04-01'));
  });
});

describe('utcDayStart', () => {
  it('обнуляет время', () => {
    expect(utcDayStart(new Date('2026-07-10T23:59:59Z'))).toEqual(day('2026-07-10'));
  });
});
