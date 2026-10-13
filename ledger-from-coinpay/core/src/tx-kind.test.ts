import { describe, expect, it } from 'vitest';
import { txKindLabel } from './tx-kind';
import { accountKindLabel } from './account-name';

/** (Волна Д2) Единый язык: все виды проводок и счетов имеют человеческие названия (не сырой enum). */
describe('единый финансовый язык — txKindLabel / accountKindLabel', () => {
  const TX_KINDS = ['capture', 'fx_topup', 'fee', 'agent_fee', 'refund', 'payout', 'reserve_hold', 'reserve_release', 'adjustment', 'deposit', 'withdrawal', 'transfer', 'exchange', 'storno', 'revaluation', 'incassation', 'reinforcement'];
  const ACC_KINDS = ['settlement', 'hold', 'reserve', 'payable', 'fee_income', 'nostro', 'cash_desk', 'position', 'countervalue', 'reval_pnl', 'bank_fees', 'network_fees'];

  it('каждый вид проводки → человеческое русское название (не сырой enum)', () => {
    for (const k of TX_KINDS) {
      const label = txKindLabel(k);
      expect(label).not.toBe(k); // не сырой
      expect(/[А-Яа-я]/.test(label)).toBe(true); // по-русски
    }
  });
  it('каждый вид счёта → человеческое русское название (не сырой enum)', () => {
    for (const k of ACC_KINDS) {
      const label = accountKindLabel(k);
      expect(label).not.toBe(k);
      expect(/[А-Яа-я]/.test(label)).toBe(true);
    }
  });
  it('единый канон: конкретные примеры (одно слово везде)', () => {
    expect(txKindLabel('capture')).toBe('Оплата по QR');
    expect(txKindLabel('fx_topup')).toBe('Пополнение по QR');
    expect(txKindLabel('reserve_hold')).toBe('Удержание резерва');
    expect(accountKindLabel('settlement')).toBe('Расчётный счёт');
    expect(accountKindLabel('fee_income')).toBe('Доход платформы');
  });
  it('неизвестный вид — как есть (сигнал разработчику, не падаем)', () => {
    expect(txKindLabel('whatever')).toBe('whatever');
    expect(accountKindLabel('whatever')).toBe('whatever');
  });
});
