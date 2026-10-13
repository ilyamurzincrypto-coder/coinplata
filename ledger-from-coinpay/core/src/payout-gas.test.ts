import { describe, expect, it } from 'vitest';
import { describeGas, estimateGas, isGasRuleComplete, type GasRule } from './payout-gas';

/**
 * (Косяк 4) Газ — РАСХОД ПЛАТФОРМЫ. Функция отвечает на вопрос «сколько списать с кошелька»,
 * и ни при каких входных данных не трогает сумму, которую получит мерчант.
 */
const fixed = (minor: bigint): GasRule => ({ gasType: 'fixed', gasPercentBp: null, gasFixedMinor: minor });
const percent = (bp: number): GasRule => ({ gasType: 'percent', gasPercentBp: bp, gasFixedMinor: null });
const none: GasRule = { gasType: null, gasPercentBp: null, gasFixedMinor: null };

describe('estimateGas', () => {
  it('🔴 фикс — это расход, а не вычет: возвращается сумма газа и ничего про выплату', () => {
    const g = estimateGas(fixed(150n)); // 1,50 TRX
    expect(g).toEqual({ gasMinor: 150n, applies: true, problem: null });
    expect(Object.keys(g)).not.toContain('payoutMinor'); // поля «сколько на руки» больше нет
  });

  it('газ не зависит от суммы выплаты — сети всё равно, сколько токенов переводят', () => {
    expect(estimateGas(fixed(150n)).gasMinor).toBe(150n);
    // Функция вообще не принимает сумму выплаты: спутать модель нельзя даже случайно.
    expect(estimateGas.length).toBe(1);
  });

  it('ноль — осознанное «газа нет», а не незаполненное правило', () => {
    expect(estimateGas(fixed(0n))).toEqual({ gasMinor: 0n, applies: false, problem: null });
  });

  it('фиат без газа — ничего не применяем и не жалуемся', () => {
    expect(estimateGas(none)).toEqual({ gasMinor: 0n, applies: false, problem: null });
  });

  it('🔴 процент неисполним: газ в валюте сети, процент — от суммы выплаты, это разные валюты', () => {
    const g = estimateGas(percent(100));
    expect(g.applies).toBe(false);
    expect(g.gasMinor).toBe(0n);
    expect(g.problem).toMatch(/процентом/);
  });

  it('тип есть, значения нет — проблема названа, а не проглочена', () => {
    const g = estimateGas({ gasType: 'fixed', gasPercentBp: null, gasFixedMinor: null });
    expect(g.applies).toBe(false);
    expect(g.problem).toMatch(/не заполнена/);
  });

  it('отрицательная оценка — тоже проблема, а не «минус расход»', () => {
    expect(estimateGas(fixed(-1n)).problem).toMatch(/не заполнена/);
  });
});

describe('isGasRuleComplete / describeGas', () => {
  it('процент больше не считается заполненным правилом', () => {
    expect(isGasRuleComplete(percent(100))).toBe(false);
    expect(isGasRuleComplete(fixed(150n))).toBe(true);
    expect(isGasRuleComplete(none)).toBe(true);
  });

  it('подпись говорит про оценку и валюту СЕТИ', () => {
    expect(describeGas(fixed(150n), 'TRX', 2)).toBe('оценка газа 1,50 TRX');
    // 🔴 Те же 150 минорных единиц у ЧЕТЫРЁХзначной монеты — это 0,0150 TRX, а не «1,50».
    expect(describeGas(fixed(150n), 'TRX', 4)).toBe('оценка газа 0,0150 TRX');
    expect(describeGas(fixed(135_000n), 'TRX', 4)).toBe('оценка газа 13,5000 TRX');
    expect(describeGas(none, 'TRX', 4)).toBe('газ не задан');
    expect(describeGas(percent(100), 'TRX', 4)).toMatch(/неисполнимо/);
  });
});
