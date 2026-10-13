import { describe, expect, it } from 'vitest';
import { assertBalanced } from './ledger';
import {
  PAYOUT_DUAL_CONTROL_THRESHOLD_MINOR,
  buildPayoutHoldTx,
  buildPayoutReversalTx,
  buildReserveReleaseTx,
  classifyBalanceDiscrepancy,
  classifyInvoiceDiscrepancy,
  payoutError,
  payoutRequiresDualControl,
  txImbalance,
} from './finance';

const ACC = { merchantSettlement: 'acc-settle', platformNostro: 'acc-nostro', platformPayable: 'acc-payable' };
const RES = { merchantSettlement: 'acc-settle', merchantHold: 'acc-hold' };

describe('порог двухэтапности выплаты (100 000 ₽, отдельный)', () => {
  it('на пороге и ниже — одношагово', () => {
    expect(PAYOUT_DUAL_CONTROL_THRESHOLD_MINOR).toBe(10_000_000n);
    expect(payoutRequiresDualControl(10_000_000n)).toBe(false);
    expect(payoutRequiresDualControl(9_999_999n)).toBe(false);
  });
  it('выше порога — maker-checker', () => {
    expect(payoutRequiresDualControl(10_000_001n)).toBe(true);
  });
});

describe('payoutError — гарды', () => {
  it('заморозка блокирует выплату В ЛЮБОМ размере (даже 1 копейка при достатке средств)', () => {
    expect(payoutError({ amountMinor: 1n, availableMinor: 10_000_000n, payoutsFrozen: true })).toMatch(
      /заморожены/,
    );
  });
  it('неположительная сумма — ошибка', () => {
    expect(payoutError({ amountMinor: 0n, availableMinor: 100n, payoutsFrozen: false })).toMatch(/положительной/);
  });
  it('сверх доступного — ошибка', () => {
    expect(payoutError({ amountMinor: 200n, availableMinor: 100n, payoutsFrozen: false })).toMatch(/Недостаточно/);
  });
  it('в пределах доступного и не заморожен — ok', () => {
    expect(payoutError({ amountMinor: 100n, availableMinor: 100n, payoutsFrozen: false })).toBeNull();
  });
});

describe('проводки выплат и резерва — балансируются в 0', () => {
  it('hold: settlement −amount, payable +amount', () => {
    const tx = buildPayoutHoldTx({ amountMinor: 50_000n, accounts: ACC });
    expect(tx.kind).toBe('payout');
    expect(() => assertBalanced(tx.entries)).not.toThrow();
    expect(txImbalance(tx.entries)).toBe(0n);
    const settle = tx.entries.find((e) => e.accountId === 'acc-settle');
    expect(settle?.amountMinor).toBe(-50_000n);
  });
  it('reversal — зеркало hold (payable −amount, settlement +amount)', () => {
    const tx = buildPayoutReversalTx({ amountMinor: 50_000n, accounts: ACC });
    expect(txImbalance(tx.entries)).toBe(0n);
    const settle = tx.entries.find((e) => e.accountId === 'acc-settle');
    expect(settle?.amountMinor).toBe(50_000n);
  });
  it('release резерва: hold −amount, settlement +amount', () => {
    const tx = buildReserveReleaseTx({ amountMinor: 12_345n, accounts: RES });
    expect(tx.kind).toBe('reserve_release');
    expect(txImbalance(tx.entries)).toBe(0n);
  });
});

describe('txImbalance — индикатор целостности', () => {
  it('сбалансированная tx → 0', () => {
    expect(txImbalance([{ amountMinor: 100n }, { amountMinor: -100n }])).toBe(0n);
  });
  it('битая tx → ненулевой остаток', () => {
    expect(txImbalance([{ amountMinor: 100n }, { amountMinor: -90n }])).toBe(10n);
  });
});

describe('классификация расхождений сверки', () => {
  const ours = { orderId: 'ORD-1', status: 'paid', amountMinor: 1000n };
  it('совпадение → null', () => {
    expect(classifyInvoiceDiscrepancy(ours, { ...ours })).toBeNull();
  });
  it('статус разошёлся', () => {
    const d = classifyInvoiceDiscrepancy(ours, { ...ours, status: 'pending' });
    expect(d?.kind).toBe('status_mismatch');
  });
  it('сумма разошлась', () => {
    const d = classifyInvoiceDiscrepancy(ours, { ...ours, amountMinor: 999n });
    expect(d?.kind).toBe('amount_mismatch');
  });
  it('нет у провайдера / нет у нас', () => {
    expect(classifyInvoiceDiscrepancy(ours, null)?.kind).toBe('missing_provider');
    expect(classifyInvoiceDiscrepancy(null, ours)?.kind).toBe('missing_local');
  });
  it('баланс: расхождение и совпадение', () => {
    expect(classifyBalanceDiscrepancy(100n, 100n)).toBeNull();
    expect(classifyBalanceDiscrepancy(100n, 90n)?.kind).toBe('balance_mismatch');
  });
});
