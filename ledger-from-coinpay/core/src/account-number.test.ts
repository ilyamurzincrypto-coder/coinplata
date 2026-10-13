import { describe, expect, it } from 'vitest';
import { accountNumber, pointNumber } from './account-number';

describe('accountNumber — маска {КЛАСС+ТИП}-{ВЛАДЕЛЕЦ}-{ВАЛЮТА}-{ФОРМА} (Волна 1)', () => {
  it('Лоро: клиент RUB нал и безнал — РАЗНЫЕ номера по форме', () => {
    expect(accountNumber({ kind: 'settlement', ownerType: 'counterparty', ownerSerial: 1, currency: 'RUB', form: 'cashless' })).toBe('140-C0001-0643-02');
    expect(accountNumber({ kind: 'settlement', ownerType: 'counterparty', ownerSerial: 1, currency: 'RUB', form: 'cash' })).toBe('140-C0001-0643-01');
  });
  it('Ностро-кассы: касса всегда 01, ностро всегда 02', () => {
    expect(accountNumber({ kind: 'cash_desk', ownerType: 'platform', ownerSerial: 1, currency: 'RUB', form: 'cash' })).toBe('220-P0001-0643-01');
    expect(accountNumber({ kind: 'nostro', ownerType: 'platform', ownerSerial: 1, currency: 'RUB', form: 'cashless' })).toBe('230-P0001-0643-02');
  });
  it('Капитал: позиция/контрвалюта/переоценка/доход — форма 00', () => {
    expect(accountNumber({ kind: 'position', ownerType: 'platform', ownerSerial: 1, currency: 'USD' })).toBe('352-P0001-0840-00');
    expect(accountNumber({ kind: 'countervalue', ownerType: 'platform', ownerSerial: 1, currency: 'RUB' })).toBe('353-P0001-0643-00');
    expect(accountNumber({ kind: 'reval_pnl', ownerType: 'platform', ownerSerial: 1, currency: 'RUB' })).toBe('371-P0001-0643-00');
    expect(accountNumber({ kind: 'fee_income', ownerType: 'platform', ownerSerial: 0, currency: 'RUB' })).toBe('370-P0000-0643-00');
  });
  it('Эквайринг: мерчант settlement/hold, платформа payable, агент fee', () => {
    expect(accountNumber({ kind: 'settlement', ownerType: 'merchant', ownerSerial: 3, currency: 'RUB' })).toBe('440-M0003-0643-00');
    expect(accountNumber({ kind: 'hold', ownerType: 'merchant', ownerSerial: 3, currency: 'RUB' })).toBe('445-M0003-0643-00');
    expect(accountNumber({ kind: 'payable', ownerType: 'platform', ownerSerial: 0, currency: 'RUB' })).toBe('447-P0000-0643-00');
    expect(accountNumber({ kind: 'fee_income', ownerType: 'agent', ownerSerial: 2, currency: 'RUB' })).toBe('470-A0002-0643-00');
  });
  it('USD → 840', () => {
    expect(accountNumber({ kind: 'nostro', ownerType: 'platform', ownerSerial: 0, currency: 'USD', form: 'cashless' })).toBe('230-P0000-0840-02');
  });

  it('детерминизм: одинаковый вход → одинаковый номер', () => {
    const inp = { kind: 'hold', ownerType: 'merchant', ownerSerial: 42, currency: 'RUB' } as const;
    expect(accountNumber(inp)).toBe(accountNumber(inp));
  });

  it('нет тип-кода для пары (вид, владелец) → ошибка', () => {
    expect(() => accountNumber({ kind: 'position', ownerType: 'counterparty', ownerSerial: 1, currency: 'RUB' })).toThrow();
  });
  it('неизвестная валюта / ординал вне диапазона → ошибка', () => {
    expect(() => accountNumber({ kind: 'settlement', ownerType: 'merchant', ownerSerial: 1, currency: 'GBP' })).toThrow();
    expect(() => accountNumber({ kind: 'settlement', ownerType: 'merchant', ownerSerial: 10000, currency: 'RUB' })).toThrow();
  });
});

describe('pointNumber — субсчёт-точка', () => {
  it('без формы — суффикс родителя сохраняется', () => {
    expect(pointNumber('140-C0001-0643-02', 1)).toBe('140-C0001.01-0643-02');
    expect(pointNumber('140-C0005-0643-01', 12)).toBe('140-C0005.12-0643-01');
  });
  it('форма у точки СВОЯ: касса (нал) в безнал-клиенте → .NN + -01', () => {
    expect(pointNumber('140-C0001-0643-02', 1, 'cash')).toBe('140-C0001.01-0643-01');
    expect(pointNumber('140-C0001-0840-02', 3, 'cashless')).toBe('140-C0001.03-0840-02');
  });
  it('ординал вне 1..99 / битый номер — ошибка', () => {
    expect(() => pointNumber('140-C0001-0643-02', 0)).toThrow();
    expect(() => pointNumber('140-C0001-0643-02', 100)).toThrow();
    expect(() => pointNumber('badnumber', 1)).toThrow();
  });
});
