import { describe, expect, it } from 'vitest';
import { buildPostingRows, type PostingEntryInput } from './postings';

const ref = (id: string) => ({ accountId: id, number: `40-${id}-643`, ownerLabel: id });
const e = (id: string, amt: bigint, currency = 'RUB'): PostingEntryInput => ({ ref: ref(id), amountMinor: amt, currency });

describe('buildPostingRows — банковская раскладка Дт/Кт', () => {
  it('простая двунога: Дт — счёт с минусом, Кт — с плюсом, сумма положительна', () => {
    const rows = buildPostingRows([e('cash', -30000n), e('client', 30000n)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.debit.accountId).toBe('cash');
    expect(rows[0]!.credit.accountId).toBe('client');
    expect(rows[0]!.amountMinor).toBe(30000n);
    expect(rows[0]!.currency).toBe('RUB');
  });

  it('обмен: две валюты → по одной проводке на валюту, USD не смешивается с RUB', () => {
    const rows = buildPostingRows([
      e('clientRub', -90000n, 'RUB'),
      e('posRub', 90000n, 'RUB'),
      e('posUsd', -97399n, 'USD'),
      e('clientUsd', 97399n, 'USD'),
    ]);
    expect(rows).toHaveLength(2);
    const rub = rows.find((r) => r.currency === 'RUB')!;
    const usd = rows.find((r) => r.currency === 'USD')!;
    expect(rub.debit.accountId).toBe('clientRub');
    expect(rub.credit.accountId).toBe('posRub');
    expect(usd.debit.accountId).toBe('posUsd');
    expect(usd.credit.accountId).toBe('clientUsd');
  });

  it('составная проводка (1 кредит, 2 дебета) → поток разносит на 2 строки, суммы сходятся', () => {
    // Ностро −1000 (Дт) ↔ мерчант +900 (Кт) + доход +100 (Кт)  — знаки для теста потока.
    const rows = buildPostingRows([e('nostro', -1000n), e('merchant', 900n), e('feeIncome', 100n)]);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.amountMinor, 0n)).toBe(1000n);
    expect(rows.every((r) => r.debit.accountId === 'nostro')).toBe(true);
    expect(rows.map((r) => r.credit.accountId).sort()).toEqual(['feeIncome', 'merchant']);
  });

  it('нулевые ноги игнорируются', () => {
    const rows = buildPostingRows([e('a', 0n), e('b', -500n), e('c', 500n)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountMinor).toBe(500n);
  });
});
