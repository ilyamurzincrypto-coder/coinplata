import { describe, expect, it } from 'vitest';
import { walletGate } from './crypto-gas';

/** (Волна 4 ж) Гейт кошелька: крипта требует custody + сеть валюты; фиат — не кошелёк. */
describe('walletGate — реквизиты кошелька', () => {
  it('фиат → ok (банк, не кошелёк)', () => {
    expect(walletGate({ kind: 'fiat', networkId: null }, null)).toEqual({ ok: true });
  });
  it('крипта без custody → отказ', () => {
    const r = walletGate({ kind: 'crypto', networkId: 'net-tron' }, null);
    expect(r.ok).toBe(false);
  });
  it('крипта без сети → отказ (кошелёк без сети непроводим)', () => {
    const r = walletGate({ kind: 'crypto', networkId: null }, 'exchange');
    expect(r.ok).toBe(false);
  });
  it('крипта + custody + сеть → ok (сеть берётся из валюты, совпадение гарантировано)', () => {
    expect(walletGate({ kind: 'crypto', networkId: 'net-tron' }, 'cold')).toEqual({ ok: true });
  });
});
