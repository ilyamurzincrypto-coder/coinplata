import { describe, expect, it } from 'vitest';
import { createCurrencySchema, currencyCodeSchema, formDigit, parseCurrencyCode, SEED_CURRENCY_NUM } from './currencies';
import { accountNumber } from './account-number';

describe('currencies — код, сеть, форма', () => {
  it('код: фиат (3 буквы) и крипта (база-сеть) валидны', () => {
    for (const c of ['RUB', 'USD', 'EUR', 'USDT-TRC20', 'USDC-ERC20', 'TRX', 'ETH']) {
      expect(currencyCodeSchema.safeParse(c).success).toBe(true);
    }
    for (const c of ['rub1', 'USDT_TRC20', 'US', 'USDT-SOLANA', '']) {
      expect(currencyCodeSchema.safeParse(c).success).toBe(false);
    }
  });

  it('сеть — часть кода (принцип эксперта)', () => {
    expect(parseCurrencyCode('USDT-TRC20')).toEqual({ base: 'USDT', network: 'TRC20' });
    expect(parseCurrencyCode('USDT-ERC20')).toEqual({ base: 'USDT', network: 'ERC20' });
    expect(parseCurrencyCode('RUB')).toEqual({ base: 'RUB', network: null });
    // TRC20 ≠ ERC20 — разные валюты
    expect(parseCurrencyCode('USDT-TRC20').network).not.toBe(parseCurrencyCode('USDT-ERC20').network);
  });

  it('форма — цифра номера (нал 01, безнал 02, служебный 00)', () => {
    expect(formDigit('cash')).toBe('01');
    expect(formDigit('cashless')).toBe('02');
    expect(formDigit(null)).toBe('00');
  });

  it('accountNumber понимает крипто-валюту по numCode из справочника (13xx, 4-значный)', () => {
    // SEED крипты — из диапазона 1300–1399 (13xx вне ISO): USDT-TRC20 = 1301.
    expect(SEED_CURRENCY_NUM['USDT-TRC20']).toBe('1301');
    expect(accountNumber({ kind: 'position', ownerType: 'platform', ownerSerial: 1, currency: 'USDT-TRC20', numCode: SEED_CURRENCY_NUM['USDT-TRC20'] })).toBe('352-P0001-1301-00');
    expect(accountNumber({ kind: 'position', ownerType: 'platform', ownerSerial: 1, currency: 'USDT-TRC20' })).toBe('352-P0001-1301-00');
    // фиат 0-паддинг: RUB 643 → 0643
    expect(accountNumber({ kind: 'position', ownerType: 'platform', ownerSerial: 1, currency: 'RUB' })).toBe('352-P0001-0643-00');
  });

  it('createCurrencySchema: токен требует контракт+сеть; нативная — запрещает контракт; 13xx-констрейнт', () => {
    // токен с контрактом+сетью — ок
    const tok = createCurrencySchema.safeParse({ code: 'usdt-trc20', title: 'Tether', symbol: '₮', minorUnits: 2, kind: 'crypto', isNative: false, network: 'TRC20', contractAddress: 'TR7NHqjeKQ...' });
    expect(tok.success).toBe(true);
    if (tok.success) expect(tok.data.code).toBe('USDT-TRC20');
    // токен без контракта — отбой
    expect(createCurrencySchema.safeParse({ code: 'USDT-BEP20', title: 'Tether', symbol: '₮', minorUnits: 2, kind: 'crypto', isNative: false, network: 'BEP20' }).success).toBe(false);
    // нативная монета (TRX) — БЕЗ контракта ок
    expect(createCurrencySchema.safeParse({ code: 'TRX', title: 'TRON', symbol: 'TRX', minorUnits: 6, kind: 'crypto', isNative: true }).success).toBe(true);
    // нативная С контрактом — отбой (у монеты контракта нет)
    expect(createCurrencySchema.safeParse({ code: 'TRX', title: 'TRON', symbol: 'TRX', minorUnits: 6, kind: 'crypto', isNative: true, contractAddress: '0xdead' }).success).toBe(false);
    // фиат с крипто-кодом (1350) — отбой; ISO йены 0392 в 03xx больше НЕ коллизирует (крипта=13xx)
    expect(createCurrencySchema.safeParse({ code: 'EUR', title: 'Евро', symbol: '€', minorUnits: 2, kind: 'fiat', numCode: '1350' }).success).toBe(false);
    expect(createCurrencySchema.safeParse({ code: 'JPY', title: 'Йена', symbol: '¥', minorUnits: 0, kind: 'fiat', numCode: '0392' }).success).toBe(true);
  });
});
