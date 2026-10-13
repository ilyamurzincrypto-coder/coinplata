import { describe, expect, it } from 'vitest';
import { buildFormConversionTx, presentBalanceMinor } from './manual-ops';

/**
 * Ворота-2 (спека владельца): инкассация 50 000 → нал-грань ВНИЗ на 50 000,
 * безнал-грань ВВЕРХ на 50 000, агрегат валюты НЕ меняется, Σ=0. Знаки в проводке
 * проверяются здесь; если грань «ловит обратное движение» — знаки в builder перевернуть.
 */
const ACC = { cashDesk: 'kassa', nostro: 'nostro', cashPosition: 'pos-cash', cashlessPosition: 'pos-cashless' };
const X = 50_000n;

/** Сырая дельта счёта в проводке — то, что реально ляжет в леджер. */
function rawDelta(tx: ReturnType<typeof buildFormConversionTx>, accountId: string): bigint {
  return tx.entries.filter((e) => e.accountId === accountId).reduce((s, e) => s + e.amountMinor, 0n);
}

/** presented-дельта счёта в проводке (сумма его ног, презентованная по kind). */
function presentedDelta(tx: ReturnType<typeof buildFormConversionTx>, accountId: string, kind: string): bigint {
  return presentBalanceMinor(kind, rawDelta(tx, accountId));
}

describe('конверсия формы — 4 ноги, грани по спеке', () => {
  it('инкассация: касса↓ ностро↑ нал-грань↓ безнал-грань↑, Σ=0', () => {
    const tx = buildFormConversionTx({ amount: X, currency: 'RUB', direction: 'incassation', ...ACC });
    expect(tx.entries.reduce((s, e) => s + e.amountMinor, 0n)).toBe(0n); // Σ=0
    expect(presentedDelta(tx, ACC.cashDesk, 'cash_desk')).toBe(-X); // касса наличие ВНИЗ
    expect(presentedDelta(tx, ACC.nostro, 'nostro')).toBe(X); // ностро наличие ВВЕРХ
    expect(presentedDelta(tx, ACC.cashPosition, 'position')).toBe(-X); // нал-экспозиция ВНИЗ
    expect(presentedDelta(tx, ACC.cashlessPosition, 'position')).toBe(X); // безнал-экспозиция ВВЕРХ
    // агрегат валюты (нал+безнал экспозиция) НЕ меняется
    expect(presentedDelta(tx, ACC.cashPosition, 'position') + presentedDelta(tx, ACC.cashlessPosition, 'position')).toBe(0n);

    /**
     * 🔴 СЫРЫЕ знаки позиций закреплены отдельно — именно они разъезжались.
     *
     * Прежний тест проверял только презентованное значение, а презентер для позиции делал флип.
     * Флип и перевёрнутый знак в проводке гасили друг друга, тест был зелёный — но живые экраны
     * (дерево, ОСВ, выписка) печатают капитал СЫРЫМ знаком, и на них инкассация читалась наоборот.
     * Плюс на позиции = длинная позиция (так же, как в обмене), значит после сдачи наличных
     * наличная позиция обязана уменьшиться.
     */
    expect(rawDelta(tx, ACC.cashPosition), 'нал-позиция в леджере уменьшается').toBe(-X);
    expect(rawDelta(tx, ACC.cashlessPosition), 'безнал-позиция в леджере растёт').toBe(X);
  });

  it('подкрепление кассы — зеркально', () => {
    const tx = buildFormConversionTx({ amount: X, currency: 'RUB', direction: 'reinforcement', ...ACC });
    expect(tx.entries.reduce((s, e) => s + e.amountMinor, 0n)).toBe(0n);
    expect(presentedDelta(tx, ACC.cashDesk, 'cash_desk')).toBe(X); // касса наличие ВВЕРХ
    expect(presentedDelta(tx, ACC.nostro, 'nostro')).toBe(-X); // ностро наличие ВНИЗ
    expect(presentedDelta(tx, ACC.cashPosition, 'position')).toBe(X); // нал-экспозиция ВВЕРХ
    expect(presentedDelta(tx, ACC.cashlessPosition, 'position')).toBe(-X); // безнал-экспозиция ВНИЗ
    expect(rawDelta(tx, ACC.cashPosition), 'нал-позиция в леджере растёт').toBe(X);
    expect(rawDelta(tx, ACC.cashlessPosition), 'безнал-позиция в леджере уменьшается').toBe(-X);
  });

  /**
   * Сквозной пример, который ловил ошибку на данных: клиент внёс 100 ₽ налом и обменял —
   * позиция RUB·нал = +100 (честно, деньги в кассе). Инкассация 100 ₽ по-старому делала её
   * +200 при ПУСТОЙ кассе, а RUB·безнал −100 при 100 ₽ на ностро. Ошибка на 2×X за операцию.
   */
  it('🔴 после обмена и инкассации наличная позиция обнуляется, а не удваивается', () => {
    const afterExchange = { cash: 100_00n, cashless: 0n }; // клиент отдал 100 ₽ налом: raw +100
    const tx = buildFormConversionTx({ amount: 100_00n, currency: 'RUB', direction: 'incassation', ...ACC });
    const cash = afterExchange.cash + rawDelta(tx, ACC.cashPosition);
    const cashless = afterExchange.cashless + rawDelta(tx, ACC.cashlessPosition);
    expect(cash, 'касса пуста — наличной экспозиции нет').toBe(0n);
    expect(cashless, 'деньги в банке — вся экспозиция безналичная').toBe(100_00n);
    expect(cash + cashless, 'агрегат по валюте не изменился').toBe(100_00n);
  });
});
