import { describe, expect, it } from 'vitest';
import { activationNotice, pickActive, resolveActivation } from './tariff-activation';

/** Числа — из боевого случая 25.08.2026 («Мерчант RUB-QR в ЦБ+5% USDT»). */
const PROVISION = new Date('2026-08-25T11:38:28.550Z'); // провизия при одобрении KYB, 2,5 %
const MIDNIGHT = new Date('2026-08-25T00:00:00.000Z'); // что дало поле «дата» оператору

describe('боевой случай: правка оператора съедалась провизией', () => {
  it('правка «с сегодня» сдвигается за провизию на секунду и становится действующей', () => {
    const r = resolveActivation({ requested: MIDNIGHT, activeValidFrom: PROVISION });
    expect(r.shifted).toBe(true);
    expect(r.validFrom.toISOString()).toBe('2026-08-25T11:38:29.550Z');
    expect(r.validFrom.getTime()).toBeGreaterThan(PROVISION.getTime()); // теперь побеждает
  });

  it('оператор узнаёт реальное время активации, а не думает, что «с 00:00»', () => {
    const r = resolveActivation({ requested: MIDNIGHT, activeValidFrom: PROVISION });
    expect(activationNotice(r, '25.08.2026 11:38:29')).toContain('25.08.2026 11:38:29');
  });

  it('повторное сохранение в тот же момент тоже сдвигается — дубль невозможен', () => {
    const first = resolveActivation({ requested: MIDNIGHT, activeValidFrom: PROVISION });
    const second = resolveActivation({ requested: MIDNIGHT, activeValidFrom: first.validFrom });
    expect(second.validFrom.getTime()).toBeGreaterThan(first.validFrom.getTime());
    expect(second.shifted).toBe(true);
  });
});

describe('обычные случаи не ломаются', () => {
  it('первый тариф идёт как есть', () => {
    const r = resolveActivation({ requested: MIDNIGHT, activeValidFrom: null });
    expect(r.shifted).toBe(false);
    expect(r.validFrom).toBe(MIDNIGHT);
  });

  it('дата в будущем не сдвигается', () => {
    const future = new Date('2026-09-01T00:00:00.000Z');
    const r = resolveActivation({ requested: future, activeValidFrom: PROVISION });
    expect(r.shifted).toBe(false);
    expect(r.validFrom).toBe(future);
  });

  it('ровное совпадение с действующей — тоже сдвиг (одновременных активных быть не может)', () => {
    const r = resolveActivation({ requested: PROVISION, activeValidFrom: PROVISION });
    expect(r.shifted).toBe(true);
  });
});

describe('выбор действующей записи детерминирован', () => {
  const at = new Date('2026-08-25T12:00:00.000Z');
  const row = (id: string, valid: string, created: string) => ({ id, validFrom: new Date(valid), createdAt: new Date(created) });

  it('берётся самая поздняя по valid_from', () => {
    const rows = [row('a', '2026-08-25T00:00:00Z', '2026-08-25T11:48:00Z'), row('b', '2026-08-25T11:38:00Z', '2026-08-25T11:38:00Z')];
    expect(pickActive(rows, at)!.id).toBe('b');
  });

  it('при равном valid_from спор решает время создания, а не случай', () => {
    const rows = [row('early', '2026-08-25T00:00:00Z', '2026-08-25T11:47:00Z'), row('late', '2026-08-25T00:00:00Z', '2026-08-25T11:48:00Z')];
    expect(pickActive(rows, at)!.id).toBe('late');
    expect(pickActive([...rows].reverse(), at)!.id).toBe('late'); // порядок входа не влияет
  });

  it('при равных valid_from и created_at спор решает id — результат всё равно один', () => {
    const rows = [row('aaa', '2026-08-25T00:00:00Z', '2026-08-25T11:47:00Z'), row('zzz', '2026-08-25T00:00:00Z', '2026-08-25T11:47:00Z')];
    expect(pickActive(rows, at)!.id).toBe('zzz');
    expect(pickActive([...rows].reverse(), at)!.id).toBe('zzz');
  });

  it('будущие записи не действуют', () => {
    const rows = [row('now', '2026-08-25T11:38:00Z', '2026-08-25T11:38:00Z'), row('later', '2026-09-01T00:00:00Z', '2026-08-25T11:50:00Z')];
    expect(pickActive(rows, at)!.id).toBe('now');
  });

  it('нет подходящих — null, а не случайная запись', () => {
    expect(pickActive([row('f', '2026-09-01T00:00:00Z', '2026-08-25T11:50:00Z')], at)).toBeNull();
  });
});
