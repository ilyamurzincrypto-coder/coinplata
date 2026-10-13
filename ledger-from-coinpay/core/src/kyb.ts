/**
 * KYB: автоскоринг (правила-заглушки, пайплайн настоящий), переходы статусов
 * заявки и контракты внешних провайдеров (ЕГРЮЛ, скриншот сайта).
 */

export type KybStatus = 'new' | 'in_review' | 'docs_requested' | 'approved' | 'declined';
export type KybRecommendation = 'green' | 'yellow' | 'red';

// ── Переходы статусов заявки ──
const KYB_TRANSITIONS: Record<KybStatus, ReadonlyArray<KybStatus>> = {
  new: ['in_review', 'declined'],
  in_review: ['docs_requested', 'approved', 'declined'],
  docs_requested: ['in_review', 'approved', 'declined'],
  approved: [],
  declined: [],
};

export function kybCanTransition(from: KybStatus, to: KybStatus): boolean {
  return KYB_TRANSITIONS[from].includes(to);
}

export function kybIsTerminal(status: KybStatus): boolean {
  return status === 'approved' || status === 'declined';
}

// ── SLA и стартовый чек-лист (единый источник для agent- и direct-заявок) ──
export const KYB_SLA_HOURS = 48;

/** Дедлайн SLA заявки: создание + 48ч. Один хелпер и для агентских, и для прямых. */
export function kybSlaDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + KYB_SLA_HOURS * 60 * 60 * 1000);
}

/** Через сколько месяцев мерчанта пересматривают планово. */
export const KYB_REVIEW_MONTHS = 6;

/**
 * 🔴 СРОК ПЛАНОВОГО ПЕРЕСМОТРА — НЕ ДЕДЛАЙН ЗАЯВКИ.
 *
 * Две разные величины с похожими именами жили в двух местах: `kybSlaDueAt` (48 ЧАСОВ на
 * рассмотрение заявки) и локальная `reviewDate` в тракте одобрения (6 МЕСЯЦЕВ до следующего
 * пересмотра). Заведение мерчанта «сразу активен» писало в `next_review_at` первую — и через
 * двое суток мерчант всплывал во «Входящих» как «Плановый пересмотр KYB». Навсегда: закрыть
 * пересмотр интерфейсом было нельзя. Именно это и увидел владелец у CoinPoint.
 *
 * Теперь срок считает ОДНА функция, и перепутать её с дедлайном SLA уже не выйдет.
 */
export function kybNextReviewAt(from: Date): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + KYB_REVIEW_MONTHS);
  return d;
}

/** Стартовый чек-лист новой заявки. Ключи — конвенция, читаются на approve. */
export function initKybChecklist(): Record<string, boolean> {
  return { site_checked: false, prohibited_categories_checked: false, docs_complete: false };
}

// ── Автоскоринг ──

/** Сигналы для оценки — производные от заявки/скрининга. */
export interface KybSignals {
  sanctionsHit: boolean;
  pepHit: boolean;
  massRegistration: boolean;
  prohibitedCategorySuspected: boolean;
  noSite: boolean;
  legalEntityInactive: boolean;
  documentsMissing: boolean;
  highRiskMcc: boolean;
}

/** Правило скоринга (из БД): код + штрафные баллы + флаг включённости. */
export interface ScoringRule {
  code: string;
  title: string;
  points: number;
  enabled: boolean;
}

export interface ScoreBreakdownItem {
  code: string;
  title: string;
  points: number;
  hit: boolean;
}

export interface ScoringResult {
  score: number;
  recommendation: KybRecommendation;
  breakdown: ScoreBreakdownItem[];
}

/**
 * Предикаты правил — заглушки (какой сигнал считается срабатыванием).
 * Баллы и включённость приходят из БД (scoring_rules); логика — здесь.
 */
const RULE_PREDICATES: Record<string, (s: KybSignals) => boolean> = {
  sanctions: (s) => s.sanctionsHit,
  pep: (s) => s.pepHit,
  mass_registration: (s) => s.massRegistration,
  prohibited_category: (s) => s.prohibitedCategorySuspected,
  no_site: (s) => s.noSite,
  inactive_entity: (s) => s.legalEntityInactive,
  documents_missing: (s) => s.documentsMissing,
  high_risk_mcc: (s) => s.highRiskMcc,
};

/** Пороги штрафных баллов для рекомендации (конфигурируемы). */
export interface ScoringThresholds {
  yellowAt: number;
  redAt: number;
}

export const DEFAULT_THRESHOLDS: ScoringThresholds = { yellowAt: 20, redAt: 50 };

/** «Жёсткий красный» независимо от суммы баллов — санкции/ПЭП. */
const HARD_RED_CODES = new Set(['sanctions', 'pep']);

/**
 * Прогон скоринга: правила (из БД) × сигналы → штрафные баллы, разбивка,
 * рекомендация. Санкции/ПЭП дают красный сразу.
 */
export function runScoring(
  signals: KybSignals,
  rules: ScoringRule[],
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS,
): ScoringResult {
  const breakdown: ScoreBreakdownItem[] = [];
  let score = 0;
  let hardRed = false;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const predicate = RULE_PREDICATES[rule.code];
    if (!predicate) continue; // неизвестный код — пропускаем
    const hit = predicate(signals);
    breakdown.push({ code: rule.code, title: rule.title, points: rule.points, hit });
    if (hit) {
      score += rule.points;
      if (HARD_RED_CODES.has(rule.code)) hardRed = true;
    }
  }

  let recommendation: KybRecommendation;
  if (hardRed || score >= thresholds.redAt) recommendation = 'red';
  else if (score >= thresholds.yellowAt) recommendation = 'yellow';
  else recommendation = 'green';

  return { score, recommendation, breakdown };
}

/** Одобрение красной заявки требует двухэтапного подтверждения (override). */
export function requiresApproveOverride(recommendation: KybRecommendation | null): boolean {
  return recommendation === 'red';
}

// ── Контракты внешних провайдеров (в A3 — мок-реализация) ──

export interface CompanyInfo {
  inn: string;
  legalName: string;
  /** Статус юрлица: active | liquidating | liquidated | … */
  status: string;
  director: string;
  registeredAt: string;
}

export interface CompanyRegistryProvider {
  /** Запрос по ИНН → реквизиты или null, если не найдено. */
  lookup(inn: string): Promise<CompanyInfo | null>;
}

export interface SiteSnapshotResult {
  url: string;
  fileRef: string;
  capturedAt: string;
}

export interface SiteSnapshotProvider {
  /** URL → скриншот-снапшот (файл + дата). */
  capture(url: string): Promise<SiteSnapshotResult>;
}
