import { describe, expect, it } from 'vitest';
import { buildGasLegs, buildTokenTransferWithGas, sumByCurrency } from './crypto-gas';

/**
 * (Правка 3б) Тест владельца: перевод 1000 USDT-TRC20, газ 13 TRX → 4 ноги,
 * Σ USDT-TRC20 = 0 И Σ TRX = 0 (газовая пара в нативной валюте, основная в токене).
 */
describe('crypto-gas — газовая проводка, Σ=0 по каждой валюте', () => {
  const USDT = 1000_000000n; // 1000 USDT (6 знаков)
  const GAS = 13_000000n; // 13 TRX (6 знаков)

  it('перевод 1000 USDT-TRC20 + газ 13 TRX → 4 ноги, Σ USDT=0, Σ TRX=0', () => {
    const legs = buildTokenTransferWithGas({
      tokenCurrency: 'USDT-TRC20',
      tokenMinor: USDT,
      fromTokenAccountId: 'token-from',
      toTokenAccountId: 'token-to',
      gas: { gasCurrency: 'TRX', gasMinor: GAS, gasPositionAccountId: 'trx-pos', networkFeesAccountId: 'net-fees-trx' },
    });
    expect(legs).toHaveLength(4);
    const sums = sumByCurrency(legs);
    expect(sums['USDT-TRC20']).toBe(0n); // основная пара замкнута
    expect(sums['TRX']).toBe(0n); // газовая пара замкнута
    // Газ — отдельной парой в TRX: кредит позиции + дебет network_fees.
    const trxLegs = legs.filter((l) => l.currency === 'TRX');
    expect(trxLegs).toHaveLength(2);
    expect(trxLegs.find((l) => l.accountId === 'trx-pos')!.amountMinor).toBe(GAS); // TRX ушли (кредит)
    expect(trxLegs.find((l) => l.accountId === 'net-fees-trx')!.amountMinor).toBe(-GAS); // расход (дебет)
  });

  it('газовая пара сама по себе Σ TRX = 0', () => {
    const legs = buildGasLegs({ gasCurrency: 'TRX', gasMinor: GAS, gasPositionAccountId: 'p', networkFeesAccountId: 'f' });
    expect(sumByCurrency(legs)['TRX']).toBe(0n);
  });
});
