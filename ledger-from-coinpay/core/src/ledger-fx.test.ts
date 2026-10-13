import { describe, expect, it } from 'vitest';
import { assertBalanced, buildFxTopupTx } from './ledger';
import { accountNumber } from './account-number';

describe('assertBalanced — per-currency (F2a)', () => {
  it('одновалютная (без currency) — как раньше', () => {
    expect(() => assertBalanced([{ accountId: 'a', amountMinor: 100n }, { accountId: 'b', amountMinor: -100n }])).not.toThrow();
    expect(() => assertBalanced([{ accountId: 'a', amountMinor: 100n }, { accountId: 'b', amountMinor: -99n }])).toThrow();
  });

  it('обмен: нога RUB и нога USD балансируются в ноль независимо', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'clientRub', amountMinor: -9_180_000n, currency: 'RUB' },
        { accountId: 'posRub', amountMinor: 9_180_000n, currency: 'RUB' },
        { accountId: 'posUsd', amountMinor: -100_000n, currency: 'USD' },
        { accountId: 'clientUsd', amountMinor: 100_000n, currency: 'USD' },
      ]),
    ).not.toThrow();
  });

  it('несбалансированная валютная нога — ошибка по этой валюте', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'r1', amountMinor: -100n, currency: 'RUB' },
        { accountId: 'r2', amountMinor: 100n, currency: 'RUB' },
        { accountId: 'u1', amountMinor: -100n, currency: 'USD' },
        { accountId: 'u2', amountMinor: 99n, currency: 'USD' },
      ]),
    ).toThrow(/USD/);
  });

  it('пустой набор — ошибка', () => {
    expect(() => assertBalanced([])).toThrow();
  });
});

describe('buildFxTopupTx (без комиссии — спред = доход)', () => {
  const acc = { platformNostro: 'nostro', clientSettlement: 'client' };

  it('2 проводки, клиенту вся сумма, баланс 0', () => {
    const tx = buildFxTopupTx({ amount: 500000n, accounts: acc });
    expect(tx.kind).toBe('fx_topup');
    expect(tx.entries).toHaveLength(2);
    expect(tx.entries.reduce((s, e) => s + e.amountMinor, 0n)).toBe(0n);
    expect(tx.entries.find((e) => e.accountId === 'client')?.amountMinor).toBe(500000n);
    expect(tx.entries.find((e) => e.accountId === 'nostro')?.amountMinor).toBe(-500000n);
  });

  it('отрицательная сумма — ошибка', () => {
    expect(() => buildFxTopupTx({ amount: -1n, accounts: acc })).toThrow();
  });
});

describe('accountNumber — владелец counterparty (C)', () => {
  it('клиентский счёт контрагента #5 USD безнал', () => {
    expect(accountNumber({ kind: 'settlement', ownerType: 'counterparty', ownerSerial: 5, currency: 'USD', form: 'cashless' })).toBe(
      '140-C0005-0840-02',
    );
  });
  it('касса платформы RUB (легаси kind cash_desk — формат номера, валютный сегмент 4-значный)', () => {
    expect(accountNumber({ kind: 'cash_desk', ownerType: 'platform', ownerSerial: 0, currency: 'RUB', form: 'cash' })).toBe(
      '220-P0000-0643-01',
    );
  });
});
