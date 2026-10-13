import { describe, expect, it } from 'vitest';
import { isValidInn, isValidOgrn, isValidOgrnAny, isValidOgrnip } from './ru-ids';

describe('ИНН — контрольные суммы', () => {
  it('валидный 10-значный ИНН юрлица', () => {
    expect(isValidInn('7707083893')).toBe(true); // Сбербанк
  });
  it('валидный 12-значный ИНН физлица/ИП', () => {
    expect(isValidInn('500100732259')).toBe(true);
  });
  it('битая контрольная цифра — отказ', () => {
    expect(isValidInn('7707083894')).toBe(false);
    expect(isValidInn('500100732258')).toBe(false);
  });
  it('неверная длина / нецифры — отказ', () => {
    expect(isValidInn('123')).toBe(false);
    expect(isValidInn('77070838931')).toBe(false); // 11 знаков
    expect(isValidInn('77070838ab')).toBe(false);
    expect(isValidInn('')).toBe(false);
  });
});

describe('ОГРН / ОГРНИП — контрольная цифра', () => {
  it('валидный ОГРН (13)', () => {
    expect(isValidOgrn('1027700132195')).toBe(true);
    expect(isValidOgrnAny('1027700132195')).toBe(true);
  });
  it('валидный ОГРНИП (15)', () => {
    expect(isValidOgrnip('304500116000157')).toBe(true);
    expect(isValidOgrnAny('304500116000157')).toBe(true);
  });
  it('битая контрольная цифра — отказ', () => {
    expect(isValidOgrn('1027700132194')).toBe(false);
    expect(isValidOgrnip('304500116000158')).toBe(false);
  });
  it('неверная длина — отказ', () => {
    expect(isValidOgrn('102770013219')).toBe(false); // 12
    expect(isValidOgrnAny('123')).toBe(false);
    expect(isValidOgrnAny('30450011600015')).toBe(false); // 14
  });
});
