import { describe, expect, it } from 'vitest';
import { bankAmountText, bankPollState, maxAmountSeq, qrAmountWithSeq, seqAmountMinor, uniqueAmountMinor } from './bank-poll';

/**
 * 🔴 Индикатор опроса банка. Ручка провайдера отвечает «был ли сегодня платёж на такую сумму» и
 * не даёт идентификатора — значит зелёное можно показывать только на ПЕРЕХОДЕ «нет» → «есть».
 */
describe('состояние индикатора опроса', () => {
  it('ещё не спрашивали и платежа нет — ждём', () => {
    expect(bankPollState({ firstAnswer: null, reachable: true, answer: 'absent' })).toBe('waiting');
  });

  it('🔴 ПЕРВЫЙ ответ «есть» — это чужой платёж, совпавший по сумме: зелёного не будет', () => {
    expect(bankPollState({ firstAnswer: null, reachable: true, answer: 'seen' })).toBe('ambiguous');
  });

  it('🔴 было «нет», стало «есть» — единственный случай зелёного', () => {
    expect(bankPollState({ firstAnswer: 'absent', reachable: true, answer: 'seen' })).toBe('seen');
  });

  it('🔴 однажды неоднозначный — неоднозначный навсегда, сколько ни спрашивай', () => {
    for (const answer of ['absent', 'seen'] as const) {
      expect(bankPollState({ firstAnswer: 'seen', reachable: true, answer })).toBe('ambiguous');
    }
  });

  it('провайдер не ответил — проверка недоступна, а не «платежа нет»', () => {
    expect(bankPollState({ firstAnswer: 'absent', reachable: false })).toBe('unavailable');
    expect(bankPollState({ firstAnswer: null, reachable: false })).toBe('unavailable');
  });
});

describe('сумма для провайдера — строка из копеек', () => {
  it('🔴 19 591,83 ₽ уходит как 19591.83, а не как float', () => {
    expect(bankAmountText(1_959_183n, 2)).toBe('19591.83');
    // Тот же случай через число дал бы хвост — проверяем, что мы его не воспроизводим.
    expect(bankAmountText(1_959_183n, 2)).not.toContain('0000000');
  });

  it('копейки дополняются нулями, целое не теряет разряд', () => {
    expect(bankAmountText(500_000n, 2)).toBe('5000.00');
    expect(bankAmountText(5n, 2)).toBe('0.05');
    expect(bankAmountText(50n, 2)).toBe('0.50');
  });

  it('тезер — четыре знака, рубль два: масштаб берётся из валюты, а не «по два всем»', () => {
    expect(bankAmountText(2_185_224n, 4)).toBe('218.5224');
    expect(bankAmountText(2_185_224n, 2)).toBe('21852.24');
  });
});

describe('копейки = номер оплаты за день', () => {
  it('🔴 ровная сумма получает номер прямо в копейки: 17-я оплата → 5 000,17', () => {
    expect(seqAmountMinor(500_000n, 17)).toBe(500_017n);
    expect(seqAmountMinor(500_000n, 1)).toBe(500_001n);
    expect(seqAmountMinor(500_000n, 99)).toBe(500_099n);
  });

  it('🔴 копейки уже заняты кассиром — переносим на следующий рубль, но ВВЕРХ и меньше чем на рубль', () => {
    // Просили 5 000,47 при номере 17: ближайшая сумма с копейками 17 не ниже запрошенной.
    expect(seqAmountMinor(500_047n, 17)).toBe(500_117n);
    const shift = 500_117n - 500_047n;
    expect(shift > 0n && shift < 100n, 'сдвиг вверх и меньше рубля').toBe(true);
  });

  it('сумма уже с нужными копейками не двигается вовсе', () => {
    expect(seqAmountMinor(500_017n, 17)).toBe(500_017n);
  });

  it('🔴 номер 0 запрещён: ровные «,00» означали бы «номера нет»', () => {
    expect(() => seqAmountMinor(500_000n, 0)).toThrow();
    expect(() => seqAmountMinor(500_000n, 100)).toThrow();
    expect(() => seqAmountMinor(500_000n, 1.5)).toThrow();
  });

  it('разрядность копеек задаёт потолок номеров', () => {
    expect(maxAmountSeq(2)).toBe(99);
    expect(maxAmountSeq(4)).toBe(9999);
    expect(seqAmountMinor(2_185_224n, 7, 4)).toBe(2_190_007n);
  });
});

describe('выбор итоговой суммы QR', () => {
  it('🔴 обычный случай: номер дня попадает в копейки', () => {
    expect(qrAmountWithSeq({ askedMinor: 500_000n, nextSeq: 17, taken: new Set() })).toEqual({ minor: 500_017n, seq: 17 });
  });

  it('🔴 номерная сумма занята — берём следующий НОМЕР, а не соседнюю копейку', () => {
    const r = qrAmountWithSeq({ askedMinor: 500_000n, nextSeq: 17, taken: new Set(['500017']) });
    expect(r).toEqual({ minor: 500_018n, seq: 18 });
  });

  it('🔴 номера кончились — запасной путь без номера, но сумма всё равно различима', () => {
    const taken = new Set(['500000']);
    const r = qrAmountWithSeq({ askedMinor: 500_000n, nextSeq: 100, taken });
    expect(r).toEqual({ minor: 500_001n, seq: null });
  });

  it('🔴 уникальность суммы следует из уникальности номера — переиспользования за день нет', () => {
    const seen = new Set<string>();
    for (let seq = 1; seq <= 99; seq += 1) {
      const r = qrAmountWithSeq({ askedMinor: 500_000n, nextSeq: seq, taken: seen });
      expect(r, `номер ${seq}`).not.toBeNull();
      seen.add(r!.minor.toString());
    }
    expect(seen.size, '99 номеров — 99 разных сумм').toBe(99);
  });
});

describe('запасной путь: ближайшая свободная', () => {
  it('свободная сумма остаётся как есть', () => {
    expect(uniqueAmountMinor(500_000n, new Set())).toBe(500_000n);
  });

  it('🔴 занятая сдвигается ВВЕРХ — занизить платёж мерчанту нельзя', () => {
    expect(uniqueAmountMinor(500_000n, new Set(['500000', '500001', '500002']))).toBe(500_003n);
  });

  it('подряд занято больше предела — честный отказ, а не увод суммы далеко', () => {
    const taken = new Set(Array.from({ length: 100 }, (_, i) => (500_000n + BigInt(i)).toString()));
    expect(uniqueAmountMinor(500_000n, taken)).toBeNull();
  });
});
