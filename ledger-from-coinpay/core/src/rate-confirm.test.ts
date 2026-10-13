import { describe, expect, it } from 'vitest';
import { checkRateGate, needsRateConfirmation, type RateFacts } from './rate-confirm';

const TODAY = '2026-09-07';
const manualToday: RateFacts = { manual: true, date: TODAY, rateE6: 83_000_000n };
const manualOld: RateFacts = { manual: true, date: '2026-09-05', rateE6: 83_000_000n };
const autoOld: RateFacts = { manual: false, date: '2026-09-05', rateE6: 84_282_000n };

describe('needsRateConfirmation — порог «не сегодняшний день»', () => {
  it('ручной курс сегодняшнего дня — подтверждать не надо', () => {
    expect(needsRateConfirmation(manualToday, TODAY)).toBe(false);
  });
  it('🔴 ручной курс вчерашний и старше — надо', () => {
    expect(needsRateConfirmation(manualOld, TODAY)).toBe(true);
    expect(needsRateConfirmation({ manual: true, date: '2026-01-01' }, TODAY)).toBe(true);
  });
  it('автоматический курс не спрашиваем никогда — его освежает синк', () => {
    expect(needsRateConfirmation(autoOld, TODAY)).toBe(false);
  });
});

describe('checkRateGate', () => {
  it('свежий ручной и любой авто проходят без подтверждения', () => {
    expect(checkRateGate(manualToday, null, TODAY)).toEqual({ ok: true });
    expect(checkRateGate(autoOld, null, TODAY)).toEqual({ ok: true });
  });

  it('🔴 устаревший ручной без подтверждения — сделка не идёт', () => {
    expect(checkRateGate(manualOld, null, TODAY)).toEqual({ ok: false, kind: 'needs_confirmation' });
  });

  it('подтверждён ИМЕННО тот курс — проходит', () => {
    expect(checkRateGate(manualOld, { date: '2026-09-05', rateE6: 83_000_000n }, TODAY)).toEqual({ ok: true });
  });

  it('🔴 подтверждено другое значение — отбой: показывали устаревшее окно', () => {
    expect(checkRateGate(manualOld, { date: '2026-09-05', rateE6: 99_000_000n }, TODAY))
      .toEqual({ ok: false, kind: 'stale_confirmation' });
  });

  it('🔴 подтверждена другая дата — тоже отбой', () => {
    expect(checkRateGate(manualOld, { date: '2026-09-01', rateE6: 83_000_000n }, TODAY))
      .toEqual({ ok: false, kind: 'stale_confirmation' });
  });

  it('🔴 «подтверждаю всё подряд» защиту не обходит: сверяется курс, а не факт нажатия', () => {
    // Клиент, который всегда шлёт одно и то же, промахнётся при любой смене курса.
    const always = { date: '2026-09-05', rateE6: 83_000_000n };
    expect(checkRateGate(manualOld, always, TODAY)).toEqual({ ok: true });
    const changed: RateFacts = { manual: true, date: '2026-09-06', rateE6: 84_000_000n };
    expect(checkRateGate(changed, always, TODAY)).toEqual({ ok: false, kind: 'stale_confirmation' });
  });
});
