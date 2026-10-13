/**
 * RBAC кабинета мерчанта — ОТДЕЛЬНАЯ матрица от платформенного rbac.ts.
 * owner — всё; operator — счета и возвраты, БЕЗ выплат, ключей и настроек.
 * Порог возврата из кабинета — уровень приложения (REFUND_DUAL_CONTROL_THRESHOLD_MINOR).
 */

export type MerchantRole = 'owner' | 'operator';

export type MerchantAction =
  | 'invoice.view'
  | 'invoice.create'
  | 'invoice.reissue'
  | 'refund.create'
  | 'payouts.view'
  | 'settings.view'
  | 'keys.view'
  | 'keys.manage'
  | 'team.manage'
  | 'profile.manage';

const OPERATOR_ACTIONS: ReadonlyArray<MerchantAction> = [
  'invoice.view',
  'invoice.create',
  'invoice.reissue',
  'refund.create',
];

const OWNER_ACTIONS: ReadonlyArray<MerchantAction> = [
  ...OPERATOR_ACTIONS,
  'payouts.view',
  'settings.view',
  'keys.view',
  'keys.manage',
  'team.manage',
  'profile.manage',
];

const MERCHANT_MATRIX: Record<MerchantRole, ReadonlyArray<MerchantAction>> = {
  owner: OWNER_ACTIONS,
  operator: OPERATOR_ACTIONS,
};

export function merchantCan(role: MerchantRole | undefined, action: MerchantAction): boolean {
  if (!role) return false;
  return MERCHANT_MATRIX[role].includes(action);
}

export function isMerchantRole(v: string): v is MerchantRole {
  return v === 'owner' || v === 'operator';
}
