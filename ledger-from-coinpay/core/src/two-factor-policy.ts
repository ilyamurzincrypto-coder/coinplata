/**
 * Политика 2FA — ЧИСТЫЕ функции без node:crypto (в барреле @coincash/core,
 * безопасно для client/edge-бандлов). Крипто-TOTP — в @coincash/core/totp.
 */
export type PrincipalKind = 'employee' | 'merchant_user' | 'agent_user' | 'counterparty_user' | 'cabinet_user';

/**
 * Обязательна ли 2FA: все employees; owner агента. У МЕРЧАНТА — нет.
 *
 * Решение владельца: мерчант на первом входе упирался в «настройте Google Authenticator» и не мог
 * попасть в кабинет, пока не заведёт приложение. Для сотрудника платформы такой барьер оправдан —
 * он работает с чужими деньгами каждый день; для мерчанта это первое впечатление от продукта, и
 * оно останавливало его на пороге. Теперь мерчант входит сразу, а 2FA предлагается напоминанием
 * (см. `shouldRemind2fa`) — включает по своему решению.
 *
 * Операторская 2FA не тронута намеренно: снижать её — отдельный разговор, здесь его нет.
 *
 * Кабинет клиента обменки (counterparty_user) в v1 — read-only (без проведения операций),
 * 2FA не обязательна; включим вместе с денежными действиями клиента.
 */
export function is2faRequired(kind: PrincipalKind, role: string | undefined): boolean {
  if (kind === 'employee') return true;
  if (kind === 'agent_user') return role === 'owner';
  return false;
}

/**
 * Показывать ли напоминание о 2FA. Напоминаем тем, кому она НЕ обязательна, но полезна —
 * владельцу кабинета мерчанта, у которого она ещё не включена. Барьером это не является:
 * напоминание живёт внутри кабинета, куда человек уже вошёл.
 */
export function shouldRemind2fa(kind: PrincipalKind, role: string | undefined, enabled: boolean): boolean {
  if (enabled) return false;
  return kind === 'merchant_user' && role === 'owner';
}
