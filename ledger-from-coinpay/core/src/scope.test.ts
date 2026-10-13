import { describe, it, expect } from 'vitest';
import {
  resolveScope,
  canAccessMerchant,
  assertCanAccessMerchant,
  type Actor,
} from './scope';

const employee: Actor = { type: 'employee', id: 'emp-1', role: 'admin' };
const agentA: Actor = { type: 'agent', id: 'agent-A' };
const agentB: Actor = { type: 'agent', id: 'agent-B' };

describe('resolveScope', () => {
  it('сотрудник платформы видит всё', () => {
    expect(resolveScope(employee)).toEqual({ kind: 'all' });
  });

  it('агент видит только своё поддерево', () => {
    expect(resolveScope(agentA)).toEqual({ kind: 'agent', agentId: 'agent-A' });
  });
});

describe('canAccessMerchant', () => {
  it('агент A НЕ имеет доступа к мерчанту агента B', () => {
    expect(canAccessMerchant(agentA, { agentId: 'agent-B' })).toBe(false);
    expect(canAccessMerchant(agentB, { agentId: 'agent-A' })).toBe(false);
  });

  it('агент имеет доступ к своему мерчанту', () => {
    expect(canAccessMerchant(agentA, { agentId: 'agent-A' })).toBe(true);
  });

  it('агент не имеет доступа к прямому мерчанту (agentId = null)', () => {
    expect(canAccessMerchant(agentA, { agentId: null })).toBe(false);
  });

  it('сотрудник платформы имеет доступ к любому мерчанту', () => {
    expect(canAccessMerchant(employee, { agentId: 'agent-A' })).toBe(true);
    expect(canAccessMerchant(employee, { agentId: null })).toBe(true);
  });
});

describe('assertCanAccessMerchant', () => {
  it('бросает при отказе', () => {
    expect(() => assertCanAccessMerchant(agentA, { agentId: 'agent-B' })).toThrow();
  });

  it('не бросает при доступе', () => {
    expect(() => assertCanAccessMerchant(agentA, { agentId: 'agent-A' })).not.toThrow();
    expect(() => assertCanAccessMerchant(employee, { agentId: null })).not.toThrow();
  });
});
