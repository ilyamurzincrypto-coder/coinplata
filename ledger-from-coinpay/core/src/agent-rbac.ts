/**
 * RBAC кабинета агента + фиксированная палитра акцента брендинга.
 * owner — всё (включая брендинг); staff — только чтение.
 */

export type AgentRole = 'owner' | 'staff';

export type AgentAction =
  | 'portfolio.view'
  | 'finance.view'
  | 'branding.manage'
  | 'merchant.onboard'
  | 'tariff.manage';

const STAFF_ACTIONS: ReadonlyArray<AgentAction> = ['portfolio.view', 'finance.view'];
// Действия над поддеревом (M5) — только owner: заведение мерчанта (подача KYB) и смена тарифа.
const OWNER_ACTIONS: ReadonlyArray<AgentAction> = [
  ...STAFF_ACTIONS,
  'branding.manage',
  'merchant.onboard',
  'tariff.manage',
];

const AGENT_MATRIX: Record<AgentRole, ReadonlyArray<AgentAction>> = {
  owner: OWNER_ACTIONS,
  staff: STAFF_ACTIONS,
};

export function agentCan(role: AgentRole | undefined, action: AgentAction): boolean {
  if (!role) return false;
  return AGENT_MATRIX[role].includes(action);
}

export function isAgentRole(v: string): v is AgentRole {
  return v === 'owner' || v === 'staff';
}

/**
 * Фиксированная палитра акцента (hue при 72% 61%). Терракота исключена
 * (близка к danger), зелёные исключены (деньги). Дефолт — василёк 233.
 */
export interface AccentOption {
  h: number;
  name: string;
}

export const ACCENT_PALETTE: ReadonlyArray<AccentOption> = [
  { h: 233, name: 'Василёк' },
  { h: 190, name: 'Бирюза' },
  { h: 285, name: 'Слива' },
  { h: 330, name: 'Розовый' },
  { h: 255, name: 'Индиго' },
  { h: 210, name: 'Сталь' },
];

export const DEFAULT_ACCENT_H = 233;

export function isAllowedAccentH(h: number): boolean {
  return ACCENT_PALETTE.some((o) => o.h === h);
}

/** Нормализует hue из brand к разрешённому (иначе дефолт). */
export function resolveAccentH(h: number | undefined | null): number {
  return typeof h === 'number' && isAllowedAccentH(h) ? h : DEFAULT_ACCENT_H;
}
