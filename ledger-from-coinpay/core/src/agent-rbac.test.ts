import { describe, expect, it } from 'vitest';
import {
  ACCENT_PALETTE,
  DEFAULT_ACCENT_H,
  agentCan,
  isAgentRole,
  isAllowedAccentH,
  resolveAccentH,
} from './agent-rbac';

describe('agent-rbac', () => {
  it('owner — всё, включая брендинг', () => {
    for (const a of ['portfolio.view', 'finance.view', 'branding.manage'] as const) {
      expect(agentCan('owner', a)).toBe(true);
    }
  });
  it('staff — только чтение, без брендинга', () => {
    expect(agentCan('staff', 'portfolio.view')).toBe(true);
    expect(agentCan('staff', 'finance.view')).toBe(true);
    expect(agentCan('staff', 'branding.manage')).toBe(false);
  });
  it('undefined → false', () => {
    expect(agentCan(undefined, 'portfolio.view')).toBe(false);
  });
  it('isAgentRole', () => {
    expect(isAgentRole('owner')).toBe(true);
    expect(isAgentRole('operator')).toBe(false);
  });
});

describe('палитра акцента', () => {
  it('дефолт василёк 233 в палитре', () => {
    expect(DEFAULT_ACCENT_H).toBe(233);
    expect(isAllowedAccentH(233)).toBe(true);
  });
  it('терракота ~18 исключена (близка к danger)', () => {
    expect(isAllowedAccentH(18)).toBe(false);
    expect(ACCENT_PALETTE.some((o) => o.h === 18)).toBe(false);
  });
  it('розовый 330 в палитре', () => {
    expect(isAllowedAccentH(330)).toBe(true);
  });
  it('resolveAccentH: неразрешённый → дефолт', () => {
    expect(resolveAccentH(999)).toBe(233);
    expect(resolveAccentH(190)).toBe(190);
    expect(resolveAccentH(null)).toBe(233);
  });
});
