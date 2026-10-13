import { describe, it, expect } from 'vitest';
import {
  assertBalanced,
  splitFee,
  buildCaptureTx,
  buildRefundTx,
  type EntryDraft,
  type TxDraft,
} from './ledger';

const ACCOUNTS = {
  merchantSettlement: 'acc_merchant_settlement',
  platformNostro: 'acc_platform_nostro',
  platformFeeIncome: 'acc_platform_fee_income',
  agentFeeIncome: 'acc_agent_fee_income',
} as const;

const sum = (tx: TxDraft): bigint =>
  tx.entries.reduce((acc, e) => acc + e.amountMinor, 0n);

const balanceOf = (tx: TxDraft, accountId: string): bigint =>
  tx.entries
    .filter((e) => e.accountId === accountId)
    .reduce((acc, e) => acc + e.amountMinor, 0n);

describe('assertBalanced', () => {
  it('пропускает сбалансированный набор', () => {
    const entries: EntryDraft[] = [
      { accountId: 'a', amountMinor: -100n },
      { accountId: 'b', amountMinor: 60n },
      { accountId: 'c', amountMinor: 40n },
    ];
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('бросает на несбалансированном массиве', () => {
    const entries: EntryDraft[] = [
      { accountId: 'a', amountMinor: -100n },
      { accountId: 'b', amountMinor: 99n },
    ];
    expect(() => assertBalanced(entries)).toThrow();
  });

  it('бросает на пустом массиве', () => {
    expect(() => assertBalanced([])).toThrow();
  });
});

describe('splitFee', () => {
  it('platform + agent = total', () => {
    const s = splitFee(1000000n, 250, 100, 0n);
    expect(s.total).toBe(25000n);
    expect(s.platform).toBe(10000n);
    expect(s.agent).toBe(15000n);
    expect(s.platform + s.agent).toBe(s.total);
  });

  it('min fee: агент получает разницу над базовой ставкой', () => {
    // 2.5% от 10.00 руб = 25 коп., минимум 5.00 руб → total = 500
    const s = splitFee(1000n, 250, 100, 500n);
    expect(s.total).toBe(500n);
    expect(s.platform).toBe(10n); // 1% от 1000
    expect(s.agent).toBe(490n);
    expect(s.platform + s.agent).toBe(s.total);
  });

  it('бросает при merchantRateBp < platformBaseRateBp', () => {
    // 1% мерчанта против базовых 2% платформы → agent < 0
    expect(() => splitFee(1000000n, 100, 200, 0n)).toThrow();
  });

  it('равные ставки → agent = 0n', () => {
    const s = splitFee(1000000n, 100, 100, 0n);
    expect(s.agent).toBe(0n);
    expect(s.platform).toBe(s.total);
  });
});

describe('buildCaptureTx', () => {
  it('sum(entries) = 0n с агентом', () => {
    const tx = buildCaptureTx({
      amount: 1000000n,
      merchantRateBp: 250,
      platformBaseRateBp: 100,
      minFeeMinor: 0n,
      accounts: ACCOUNTS,
      idempotencyKey: 'idem-1',
    });
    expect(tx.kind).toBe('capture');
    expect(tx.idempotencyKey).toBe('idem-1');
    expect(sum(tx)).toBe(0n);
    // Экономика: чистый settlement = amount - total
    expect(balanceOf(tx, ACCOUNTS.merchantSettlement)).toBe(1000000n - 25000n);
    expect(balanceOf(tx, ACCOUNTS.platformNostro)).toBe(-1000000n);
    expect(balanceOf(tx, ACCOUNTS.platformFeeIncome)).toBe(10000n);
    expect(balanceOf(tx, ACCOUNTS.agentFeeIncome)).toBe(15000n);
  });

  it('sum(entries) = 0n без агента — вся комиссия платформе', () => {
    const { agentFeeIncome: _omit, ...direct } = ACCOUNTS;
    const tx = buildCaptureTx({
      amount: 1000000n,
      merchantRateBp: 250,
      platformBaseRateBp: 100,
      minFeeMinor: 0n,
      accounts: direct,
    });
    expect(sum(tx)).toBe(0n);
    expect(balanceOf(tx, ACCOUNTS.platformFeeIncome)).toBe(25000n);
    expect(balanceOf(tx, ACCOUNTS.merchantSettlement)).toBe(975000n);
    expect(tx.entries.some((e) => e.accountId === ACCOUNTS.agentFeeIncome)).toBe(false);
  });

  it('min fee учитывается в проводках', () => {
    const tx = buildCaptureTx({
      amount: 1000n,
      merchantRateBp: 250,
      platformBaseRateBp: 100,
      minFeeMinor: 500n,
      accounts: ACCOUNTS,
    });
    expect(sum(tx)).toBe(0n);
    expect(balanceOf(tx, ACCOUNTS.merchantSettlement)).toBe(500n); // 1000 - 500
  });

  it('бросает на неположительной сумме', () => {
    expect(() =>
      buildCaptureTx({
        amount: 0n,
        merchantRateBp: 100,
        platformBaseRateBp: 100,
        minFeeMinor: 0n,
        accounts: ACCOUNTS,
      }),
    ).toThrow();
  });
});

describe('buildRefundTx', () => {
  it('sum(entries) = 0n, зеркало capture', () => {
    const tx = buildRefundTx({
      amount: 1000000n,
      feeTotal: 25000n,
      feePlatform: 10000n,
      feeAgent: 15000n,
      accounts: ACCOUNTS,
      idempotencyKey: 'idem-r1',
    });
    expect(tx.kind).toBe('refund');
    expect(sum(tx)).toBe(0n);
    expect(balanceOf(tx, ACCOUNTS.merchantSettlement)).toBe(-(1000000n - 25000n));
    expect(balanceOf(tx, ACCOUNTS.platformNostro)).toBe(1000000n);
    expect(balanceOf(tx, ACCOUNTS.platformFeeIncome)).toBe(-10000n);
    expect(balanceOf(tx, ACCOUNTS.agentFeeIncome)).toBe(-15000n);
  });

  it('capture + refund полностью обнуляют все счета', () => {
    const capture = buildCaptureTx({
      amount: 777777n,
      merchantRateBp: 300,
      platformBaseRateBp: 120,
      minFeeMinor: 100n,
      accounts: ACCOUNTS,
    });
    const refund = buildRefundTx({
      amount: 777777n,
      feeTotal: 23333n, // floor(777777*300/10000)
      feePlatform: 9333n, // floor(777777*120/10000)
      feeAgent: 14000n,
      accounts: ACCOUNTS,
    });
    for (const acc of Object.values(ACCOUNTS)) {
      expect(balanceOf(capture, acc) + balanceOf(refund, acc)).toBe(0n);
    }
  });

  it('бросает, если fee-компоненты не сходятся', () => {
    expect(() =>
      buildRefundTx({
        amount: 1000n,
        feeTotal: 100n,
        feePlatform: 50n,
        feeAgent: 40n,
        accounts: ACCOUNTS,
      }),
    ).toThrow();
  });

  it('бросает, если feeAgent > 0, а счёт агента не задан', () => {
    const { agentFeeIncome: _omit, ...direct } = ACCOUNTS;
    expect(() =>
      buildRefundTx({
        amount: 1000n,
        feeTotal: 100n,
        feePlatform: 60n,
        feeAgent: 40n,
        accounts: direct,
      }),
    ).toThrow();
  });
});
