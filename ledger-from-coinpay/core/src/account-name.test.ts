import { describe, expect, it } from 'vitest';
import { accountPurposeName, accountRoleLabel, isPlaceholderName, resolveAccountName } from './account-name';

describe('account-name — имя = назначение, не форма', () => {
  it('распознаёт имена-заглушки', () => {
    for (const n of [null, undefined, '', '  ', 'безналичные', 'Наличные', 'НАЛИЧНЫЕ']) {
      expect(isPlaceholderName(n)).toBe(true);
    }
    for (const n of ['Касса Анталия', 'Точка ТЦ Анталия', 'К выплате', 'Расчётный счёт']) {
      expect(isPlaceholderName(n)).toBe(false);
    }
  });

  it('назначение по (ownerType, kind)', () => {
    expect(accountPurposeName('merchant', 'settlement')).toBe('К выплате');
    expect(accountPurposeName('merchant', 'hold')).toBe('Удержано (ожидает выплаты)');
    expect(accountPurposeName('merchant', 'reserve')).toBe('Резерв (rolling reserve)');
    expect(accountPurposeName('agent', 'fee_income')).toBe('Комиссионный доход агента');
    expect(accountPurposeName('platform', 'nostro')).toBe('Интейк СБП (банк-эквайер)');
    expect(accountPurposeName('platform', 'payable')).toBe('Требование к провайдеру');
    expect(accountPurposeName('platform', 'bank_fees')).toBe('Затраты банка/НСПК');
  });

  it('валюта — суффикс у settlement (разводит коллизию RUB/USD одного владельца)', () => {
    expect(accountPurposeName('counterparty', 'settlement', 'noncash', 'RUB')).toBe('Расчётный счёт RUB');
    expect(accountPurposeName('counterparty', 'settlement', 'noncash', 'USD')).toBe('Расчётный счёт USD');
    expect(accountPurposeName('merchant', 'settlement', null, 'USD')).toBe('К выплате USD');
    expect(accountPurposeName('counterparty', 'settlement', 'noncash')).toBe('Расчётный счёт');
  });

  it('resolveAccountName: пользовательское имя как есть, заглушку — назначением', () => {
    expect(resolveAccountName({ ownerType: 'platform', kind: 'cash_desk', name: 'Касса Анталия' })).toBe('Касса Анталия');
    expect(resolveAccountName({ ownerType: 'merchant', kind: 'settlement', name: 'безналичные' })).toBe('К выплате');
    expect(resolveAccountName({ ownerType: 'merchant', kind: 'hold', name: null })).toBe('Удержано (ожидает выплаты)');
    // ни при каких входах не возвращаем «безналичные»/«наличные»
    for (const kind of ['settlement', 'hold', 'reserve', 'fee_income']) {
      for (const owner of ['platform', 'merchant', 'agent', 'counterparty']) {
        const out = resolveAccountName({ ownerType: owner, kind, name: 'безналичные', form: 'noncash' }).toLowerCase();
        expect(out).not.toBe('безналичные');
        expect(out).not.toBe('наличные');
      }
    }
  });

  it('accountRoleLabel: убирает валюту/форму из имени (роль + чипы отдельно)', () => {
    expect(accountRoleLabel('Расчётный счёт RUB безнал', 'RUB')).toBe('Расчётный счёт');
    // Срезав валюту/форму, не оставляем висящий разделитель (было «Валютная позиция · безнал ·»).
    expect(accountRoleLabel('Валютная позиция · безнал · RUB', 'RUB')).toBe('Валютная позиция');
    expect(accountRoleLabel('Валютная позиция · нал', 'USD')).toBe('Валютная позиция');
    expect(accountRoleLabel('К выплате RUB', 'RUB')).toBe('К выплате');
    expect(accountRoleLabel('Расчётный счёт USD нал', 'USD')).toBe('Расчётный счёт');
    // без валюты/формы в имени — как есть
    expect(accountRoleLabel('Касса Анталия', 'RUB')).toBe('Касса Анталия');
    expect(accountRoleLabel('Удержано (ожидает выплаты)', 'RUB')).toBe('Удержано (ожидает выплаты)');
    expect(accountRoleLabel('Лара', 'RUB')).toBe('Лара');
    // пусто → валюта как запасной ярлык
    expect(accountRoleLabel(null, 'USD')).toBe('USD');
  });
});
