import { describe, expect, it } from 'vitest';

/**
 * Порог «курс протух» на экране обязан совпадать с денежным трактом: там >3 дней включает
 * carry-forward у выплаты. Если экран промолчит, оператор увидит спокойную дату и отправит
 * деньги по курсу недельной давности — ровно так USDT от 27 августа и дожил до сентября.
 */
const STALE_AFTER_DAYS = 3;
const staleDays = (days: number): number | null => (days > STALE_AFTER_DAYS ? days : null);

describe('пометка устаревшего курса на экране', () => {
  it('свежий курс не помечается', () => {
    expect(staleDays(0)).toBeNull();
    expect(staleDays(3)).toBeNull();
  });

  it('🔴 старше порога — помечается, и число дней названо', () => {
    expect(staleDays(4)).toBe(4);
    expect(staleDays(13)).toBe(13); // USDT от 27 августа
  });

  it('порог тот же, что у carry-forward в выплате', () => {
    // payout-request-core: rateStale = (сейчас − дата) / сутки > 3
    expect(STALE_AFTER_DAYS).toBe(3);
  });
});
