import { describe, expect, it } from 'vitest';
import {
  type EmployeeActor,
  availableFreezeActions,
  canConfirm,
  canRequest,
  computeExpiresAt,
  isPendingExpired,
  rbacActionFor,
  targetStatusFor,
} from './approvals';

const admin: EmployeeActor = { id: 'u-admin', role: 'admin' };
const risk: EmployeeActor = { id: 'u-risk', role: 'risk_officer' };
const finance: EmployeeActor = { id: 'u-fin', role: 'finance' };
const support: EmployeeActor = { id: 'u-sup', role: 'support' };

describe('rbacActionFor', () => {
  it('маппит действия на права', () => {
    expect(rbacActionFor('merchant.freeze_payouts')).toBe('merchant.freeze');
    expect(rbacActionFor('merchant.freeze_all')).toBe('merchant.freeze');
    expect(rbacActionFor('merchant.unfreeze')).toBe('merchant.unfreeze');
    expect(rbacActionFor('merchant.terminate')).toBe('merchant.terminate');
  });
});

describe('protuchanie (72ч)', () => {
  it('computeExpiresAt = +72ч', () => {
    const t = new Date('2026-07-10T00:00:00Z');
    expect(computeExpiresAt(t).toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });
  it('pending за сроком — протух', () => {
    const exp = new Date('2026-07-13T00:00:00Z');
    expect(isPendingExpired({ status: 'pending', expiresAt: exp }, new Date('2026-07-13T00:00:01Z'))).toBe(true);
    expect(isPendingExpired({ status: 'pending', expiresAt: exp }, new Date('2026-07-12T23:59:59Z'))).toBe(false);
  });
  it('не-pending не протухает', () => {
    const exp = new Date('2026-07-01T00:00:00Z');
    expect(isPendingExpired({ status: 'confirmed', expiresAt: exp }, new Date('2026-07-13T00:00:00Z'))).toBe(false);
  });
});

describe('targetStatusFor — переходы', () => {
  it('freeze_payouts: active → frozen_payouts', () => {
    expect(targetStatusFor('merchant.freeze_payouts', 'active')).toBe('frozen_payouts');
  });
  it('freeze_all: active/frozen_payouts → frozen_all', () => {
    expect(targetStatusFor('merchant.freeze_all', 'active')).toBe('frozen_all');
    expect(targetStatusFor('merchant.freeze_all', 'frozen_payouts')).toBe('frozen_all');
  });
  it('unfreeze всегда → active и только из frozen_*', () => {
    expect(targetStatusFor('merchant.unfreeze', 'frozen_payouts')).toBe('active');
    expect(targetStatusFor('merchant.unfreeze', 'frozen_all')).toBe('active');
    expect(() => targetStatusFor('merchant.unfreeze', 'active')).toThrow();
    expect(() => targetStatusFor('merchant.unfreeze', 'pending_kyb')).toThrow();
  });
  it('freeze_payouts недопустим из уже замороженного', () => {
    expect(() => targetStatusFor('merchant.freeze_payouts', 'frozen_payouts')).toThrow();
  });
  it('terminate из любого не-terminated', () => {
    expect(targetStatusFor('merchant.terminate', 'active')).toBe('terminated');
    expect(targetStatusFor('merchant.terminate', 'frozen_all')).toBe('terminated');
  });
  it('из terminated — любое действие бросает (пути назад нет)', () => {
    expect(() => targetStatusFor('merchant.unfreeze', 'terminated')).toThrow();
    expect(() => targetStatusFor('merchant.terminate', 'terminated')).toThrow();
  });
});

describe('availableFreezeActions', () => {
  it('active', () => {
    expect(availableFreezeActions('active')).toEqual([
      'merchant.freeze_payouts',
      'merchant.freeze_all',
      'merchant.terminate',
    ]);
  });
  it('frozen_payouts — есть разморозка', () => {
    expect(availableFreezeActions('frozen_payouts')).toContain('merchant.unfreeze');
    expect(availableFreezeActions('frozen_payouts')).not.toContain('merchant.freeze_payouts');
  });
  it('terminated — кнопок нет', () => {
    expect(availableFreezeActions('terminated')).toEqual([]);
  });
});

describe('dual-control: canConfirm / canRequest', () => {
  it('self-confirm запрещён даже с правом', () => {
    expect(canConfirm(admin.id, admin, 'merchant.freeze_payouts')).toBe(false);
  });
  it('другой сотрудник с правом — может подтвердить', () => {
    expect(canConfirm(admin.id, risk, 'merchant.freeze_payouts')).toBe(true);
    expect(canConfirm(risk.id, admin, 'merchant.unfreeze')).toBe(true);
  });
  it('другой сотрудник без права — не может', () => {
    expect(canConfirm(admin.id, finance, 'merchant.freeze_payouts')).toBe(false);
    expect(canConfirm(admin.id, support, 'merchant.terminate')).toBe(false);
  });
  it('минимум двое могут подтверждать заморозку (admin + risk_officer)', () => {
    expect(canRequest(admin, 'merchant.freeze_payouts')).toBe(true);
    expect(canRequest(risk, 'merchant.freeze_payouts')).toBe(true);
    // и они разные люди → maker/checker разводятся
    expect(canConfirm(admin.id, risk, 'merchant.freeze_payouts')).toBe(true);
    expect(canConfirm(risk.id, admin, 'merchant.freeze_payouts')).toBe(true);
  });
});
