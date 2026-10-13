import { describe, expect, it } from 'vitest';
import {
  type KybSignals,
  type ScoringRule,
  kybCanTransition,
  kybIsTerminal,
  requiresApproveOverride,
  runScoring,
} from './kyb';

const RULES: ScoringRule[] = [
  { code: 'sanctions', title: 'Санкции', points: 100, enabled: true },
  { code: 'pep', title: 'ПЭП', points: 40, enabled: true },
  { code: 'mass_registration', title: 'Массовая регистрация', points: 25, enabled: true },
  { code: 'prohibited_category', title: 'Запрещённая категория', points: 30, enabled: true },
  { code: 'no_site', title: 'Нет сайта', points: 15, enabled: true },
  { code: 'documents_missing', title: 'Нет документов', points: 10, enabled: true },
];

const clean: KybSignals = {
  sanctionsHit: false,
  pepHit: false,
  massRegistration: false,
  prohibitedCategorySuspected: false,
  noSite: false,
  legalEntityInactive: false,
  documentsMissing: false,
  highRiskMcc: false,
};

describe('kyb переходы статусов', () => {
  it('допустимые переходы', () => {
    expect(kybCanTransition('new', 'in_review')).toBe(true);
    expect(kybCanTransition('in_review', 'approved')).toBe(true);
    expect(kybCanTransition('docs_requested', 'in_review')).toBe(true);
  });
  it('недопустимые', () => {
    expect(kybCanTransition('new', 'approved')).toBe(false);
    expect(kybCanTransition('approved', 'in_review')).toBe(false);
  });
  it('терминальные', () => {
    expect(kybIsTerminal('approved')).toBe(true);
    expect(kybIsTerminal('declined')).toBe(true);
    expect(kybIsTerminal('new')).toBe(false);
  });
});

describe('runScoring', () => {
  it('чистые сигналы → 0, зелёный, всё hit=false', () => {
    const r = runScoring(clean, RULES);
    expect(r.score).toBe(0);
    expect(r.recommendation).toBe('green');
    expect(r.breakdown.every((b) => !b.hit)).toBe(true);
    expect(r.breakdown.length).toBe(RULES.length);
  });

  it('жёлтый по порогу (25 баллов)', () => {
    const r = runScoring({ ...clean, massRegistration: true }, RULES);
    expect(r.score).toBe(25);
    expect(r.recommendation).toBe('yellow');
  });

  it('красный по сумме баллов (25+30=55 ≥ 50)', () => {
    const r = runScoring(
      { ...clean, massRegistration: true, prohibitedCategorySuspected: true },
      RULES,
    );
    expect(r.score).toBe(55);
    expect(r.recommendation).toBe('red');
  });

  it('жёсткий красный: ПЭП (40 < 50) всё равно красный', () => {
    const r = runScoring({ ...clean, pepHit: true }, RULES);
    expect(r.score).toBe(40);
    expect(r.recommendation).toBe('red');
  });

  it('жёсткий красный: санкции', () => {
    const r = runScoring({ ...clean, sanctionsHit: true }, RULES);
    expect(r.recommendation).toBe('red');
  });

  it('выключенное правило не учитывается', () => {
    const rules = RULES.map((r) =>
      r.code === 'mass_registration' ? { ...r, enabled: false } : r,
    );
    const r = runScoring({ ...clean, massRegistration: true }, rules);
    expect(r.score).toBe(0);
    expect(r.recommendation).toBe('green');
  });

  it('неизвестный код правила пропускается', () => {
    const r = runScoring(clean, [{ code: 'unknown_rule', title: 'X', points: 99, enabled: true }]);
    expect(r.breakdown.length).toBe(0);
    expect(r.score).toBe(0);
  });
});

describe('requiresApproveOverride', () => {
  it('красный → нужен override (maker-checker)', () => {
    expect(requiresApproveOverride('red')).toBe(true);
  });
  it('жёлтый/зелёный/нет — одноэтапно', () => {
    expect(requiresApproveOverride('yellow')).toBe(false);
    expect(requiresApproveOverride('green')).toBe(false);
    expect(requiresApproveOverride(null)).toBe(false);
  });
});
