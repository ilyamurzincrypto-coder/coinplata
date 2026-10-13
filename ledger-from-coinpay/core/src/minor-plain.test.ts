import { describe, expect, it } from 'vitest';
import { minorToPlain, parseAmountMinor } from './money';

/**
 * 🔴 Сумма ходит через границу действия СТРОКОЙ, а не числом. `Number(minor)/100` — тот самый
 * float, из-за которого «100.555» принималось как 100,56 ₽, а `Infinity` давал 500 вместо отказа.
 * Круговой путь «минорные → строка → минорные» обязан быть точным при любой длине числа.
 */
describe('minorToPlain', () => {
  it('рубли: два знака', () => {
    expect(minorToPlain(123456n, 2)).toBe('1234.56');
    expect(minorToPlain(5n, 2)).toBe('0.05');
    expect(minorToPlain(0n, 2)).toBe('0.00');
  });

  it('🔴 тезер: четыре знака, ни одного не теряем', () => {
    expect(minorToPlain(2185224n, 4)).toBe('218.5224');
    expect(minorToPlain(1n, 4)).toBe('0.0001');
  });

  it('знаков ноль — целое без точки', () => {
    expect(minorToPlain(42n, 0)).toBe('42');
  });

  it('минус сохраняется', () => {
    expect(minorToPlain(-12797000n, 2)).toBe('-127970.00');
  });

  /**
   * Главное свойство: то, что ушло, тем и вернулось. Проверяем на суммах, которых float уже не
   * держит точно (больше 2^53 минорных единиц он врёт).
   */
  it('🔴 круговой путь точен, включая суммы за пределами точности float', () => {
    for (const [minor, units] of [[123456n, 2], [2185224n, 4], [1n, 4], [0n, 2], [99999999999999999n, 2]] as const) {
      expect(parseAmountMinor(minorToPlain(minor, units), units), `${minor}/${units}`).toBe(minor);
    }
  });

  it('число знаков вне диапазона — ошибка, а не молчаливая подстановка', () => {
    expect(() => minorToPlain(1n, -1)).toThrow();
    expect(() => minorToPlain(1n, 19)).toThrow();
  });
});
