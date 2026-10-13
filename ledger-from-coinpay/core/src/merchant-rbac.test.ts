import { describe, expect, it } from 'vitest';
import { isMerchantRole, merchantCan } from './merchant-rbac';

describe('merchant-rbac', () => {
  it('owner может всё', () => {
    for (const a of ['invoice.create', 'refund.create', 'payouts.view', 'keys.view', 'keys.manage', 'settings.view', 'team.manage', 'profile.manage'] as const) {
      expect(merchantCan('owner', a)).toBe(true);
    }
  });

  it('operator — счета и возвраты, но НЕ выплаты/ключи/настройки/команда/профиль', () => {
    expect(merchantCan('operator', 'invoice.create')).toBe(true);
    expect(merchantCan('operator', 'invoice.reissue')).toBe(true);
    expect(merchantCan('operator', 'refund.create')).toBe(true);
    expect(merchantCan('operator', 'payouts.view')).toBe(false);
    expect(merchantCan('operator', 'keys.view')).toBe(false);
    expect(merchantCan('operator', 'keys.manage')).toBe(false);
    expect(merchantCan('operator', 'settings.view')).toBe(false);
    expect(merchantCan('operator', 'team.manage')).toBe(false);
    expect(merchantCan('operator', 'profile.manage')).toBe(false);
  });

  it('undefined роль → всегда false', () => {
    expect(merchantCan(undefined, 'invoice.view')).toBe(false);
  });

  it('isMerchantRole', () => {
    expect(isMerchantRole('owner')).toBe(true);
    expect(isMerchantRole('operator')).toBe(true);
    expect(isMerchantRole('admin')).toBe(false);
  });
});
