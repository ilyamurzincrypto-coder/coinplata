import { describe, expect, it } from 'vitest';
import { resolveNativeCoin } from './crypto-gas';

/**
 * (Волна 4 №1) Резолв нативной монеты сети для газа: кейс созвона — токен USDT-TRC20 в
 * сети TRON (gas_currency TRX), нативная монета заведена ошибочно как «TRX-TRC20». Резолвер
 * обязан найти её по БАЗЕ кода, а при наличии чистого «TRX» — предпочесть точный код.
 */
const TRON = { id: 'net-tron', gasCurrency: 'TRX' };

describe('resolveNativeCoin — газовая нативная монета сети', () => {
  it('TRX-TRC20 находит TRON по базе кода (когда чистого TRX нет)', () => {
    const coins = [{ code: 'TRX-TRC20', networkId: null, enabled: false }];
    expect(resolveNativeCoin(coins, TRON)?.code).toBe('TRX-TRC20');
  });

  it('при дубле TRX (точный код) выигрывает у TRX-TRC20 (база)', () => {
    const coins = [
      { code: 'TRX-TRC20', networkId: null, enabled: false },
      { code: 'TRX', networkId: null, enabled: false },
    ];
    expect(resolveNativeCoin(coins, TRON)?.code).toBe('TRX');
  });

  it('привязка network_id бьёт и точный код', () => {
    const coins = [
      { code: 'TRX', networkId: null, enabled: false },
      { code: 'TRXX', networkId: 'net-tron', enabled: false },
    ];
    expect(resolveNativeCoin(coins, TRON)?.code).toBe('TRXX');
  });

  it('среди равных совпадений enabled выигрывает у disabled', () => {
    const coins = [
      { code: 'TRX', networkId: null, enabled: false },
      { code: 'TRX', networkId: null, enabled: true },
    ];
    expect(resolveNativeCoin(coins, TRON)?.enabled).toBe(true);
  });

  it('нет совпадений → undefined (гейт скажет «сначала заведите TRX»)', () => {
    expect(resolveNativeCoin([{ code: 'ETH', networkId: null, enabled: true }], TRON)).toBeUndefined();
    expect(resolveNativeCoin([{ code: 'TRX', networkId: null, enabled: true }], { id: 'x', gasCurrency: null })).toBeUndefined();
  });
});
