/**
 * Двухэтапные действия (maker-checker) над мерчантом.
 * Чистая логика: переходы статусов, право подтверждать, протухание.
 */

import type { Action, EmployeeRole } from './rbac';
import { can } from './rbac';

export const PENDING_TTL_HOURS = 72;

export type MerchantStatus =
  /** (Блок 1) Создан, правила не заданы, приём и выплаты выключены. Заморозка к нему неприменима. */
  | 'draft'
  | 'pending_kyb'
  | 'active'
  | 'frozen_payouts'
  | 'frozen_all'
  | 'terminated';

export type FreezeAction =
  | 'merchant.freeze_payouts'
  | 'merchant.freeze_all'
  | 'merchant.unfreeze'
  | 'merchant.terminate';

export interface EmployeeActor {
  id: string;
  role: EmployeeRole;
}

/** rbac-право, требуемое для действия. */
export function rbacActionFor(a: FreezeAction): Action {
  switch (a) {
    case 'merchant.freeze_payouts':
    case 'merchant.freeze_all':
      return 'merchant.freeze';
    case 'merchant.unfreeze':
      return 'merchant.unfreeze';
    case 'merchant.terminate':
      return 'merchant.terminate';
  }
}

/** Момент протухания pending: requested_at + 72ч. */
export function computeExpiresAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + PENDING_TTL_HOURS * 3600 * 1000);
}

/** pending старше срока — протух (не исполняется). */
export function isPendingExpired(
  p: { status: string; expiresAt: Date },
  now: Date,
): boolean {
  return p.status === 'pending' && now.getTime() > p.expiresAt.getTime();
}

/**
 * Целевой статус для действия из текущего. Бросает при недопустимом переходе.
 * Правила: unfreeze всегда → active и только из frozen_*; из terminated пути назад нет.
 */
export function targetStatusFor(a: FreezeAction, current: MerchantStatus): MerchantStatus {
  if (current === 'terminated') {
    throw new Error('Мерчант отключён (terminated) — действия недоступны');
  }
  switch (a) {
    case 'merchant.freeze_payouts':
      if (current !== 'active') {
        throw new Error(`Заморозка выплат возможна только из «active» (сейчас ${current})`);
      }
      return 'frozen_payouts';
    case 'merchant.freeze_all':
      if (current !== 'active' && current !== 'frozen_payouts') {
        throw new Error(`Заморозка приёма возможна из «active»/«frozen_payouts» (сейчас ${current})`);
      }
      return 'frozen_all';
    case 'merchant.unfreeze':
      if (current !== 'frozen_payouts' && current !== 'frozen_all') {
        throw new Error(`Разморозка возможна только из «frozen_*» (сейчас ${current})`);
      }
      return 'active';
    case 'merchant.terminate':
      return 'terminated';
  }
}

/** Какие действия доступны из текущего статуса — для набора кнопок в UI. */
export function availableFreezeActions(current: MerchantStatus): FreezeAction[] {
  if (current === 'terminated') return [];
  // (Блок 1) У draft замораживать нечего — приём и так выключен. Оставляем только отключение:
  // предложить «заморозить выплаты» мерчанту без правил значило бы делать вид, что он работает.
  if (current === 'draft') return ['merchant.terminate'];
  const out: FreezeAction[] = [];
  if (current === 'active') out.push('merchant.freeze_payouts');
  if (current === 'active' || current === 'frozen_payouts') out.push('merchant.freeze_all');
  if (current === 'frozen_payouts' || current === 'frozen_all') out.push('merchant.unfreeze');
  out.push('merchant.terminate');
  return out;
}

/** Может ли сотрудник инициировать действие (имеет право). */
export function canRequest(actor: EmployeeActor, a: FreezeAction): boolean {
  return can(actor.role, rbacActionFor(a));
}

/**
 * Может ли checker подтвердить запрос maker'а:
 * ДРУГОЙ человек И имеет право на действие. Self-confirm запрещён.
 */
export function canConfirm(makerId: string, checker: EmployeeActor, a: FreezeAction): boolean {
  if (checker.id === makerId) return false;
  return can(checker.role, rbacActionFor(a));
}
