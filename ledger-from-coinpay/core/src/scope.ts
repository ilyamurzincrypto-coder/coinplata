/**
 * Изоляция данных по дереву platform → agent → merchant → shop.
 * Сотрудник платформы видит всё, агент — только своё поддерево.
 */

export interface Actor {
  type: 'employee' | 'agent';
  id: string;
  role?: string;
  agentId?: string;
}

export type ScopeFilter = { kind: 'all' } | { kind: 'agent'; agentId: string };

export function resolveScope(actor: Actor): ScopeFilter {
  if (actor.type === 'employee') {
    return { kind: 'all' };
  }
  return { kind: 'agent', agentId: actor.id };
}

export function canAccessMerchant(
  actor: Actor,
  merchant: { agentId: string | null },
): boolean {
  if (actor.type === 'employee') return true;
  return merchant.agentId !== null && merchant.agentId === actor.id;
}

export function assertCanAccessMerchant(
  actor: Actor,
  merchant: { agentId: string | null },
): void {
  if (!canAccessMerchant(actor, merchant)) {
    throw new Error(
      `Доступ запрещён: актор ${actor.type}:${actor.id} не имеет прав на этого мерчанта`,
    );
  }
}
