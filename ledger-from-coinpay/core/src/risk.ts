/**
 * Движок риск-правил — ЧИСТЫЕ функции: на вход операции одной точки (shop)
 * + конфиг правила, на выход находки (RiskFinding). Никаких БД/времени внутри:
 * `now` передаётся явно, что делает правила детерминированно тестируемыми.
 *
 * Пороги правил живут в БД (risk_rules.params) и редактируются из админки —
 * здесь только дефолты и алгоритмы. Каждая находка несёт СНАПШОТ параметров,
 * при которых сработала (paramsSnapshot), чтобы событие оставалось объяснимым
 * даже после тюнинга порогов, и стабильный dedupKey для идемпотентности прогонов.
 */

export type RuleCode = 'velocity_point' | 'structuring' | 'repeat_payer' | 'off_hours';

export type RiskSeverity = 'low' | 'medium' | 'high';

export interface RiskRuleConfig {
  code: RuleCode;
  severity: RiskSeverity;
  params: Record<string, number>;
}

/** Операция (счёт) для анализа. Деньги — только копейки (bigint). */
export interface RiskOp {
  invoiceId: string;
  orderId: string;
  shopId: string;
  amountMinor: bigint;
  ip: string | null;
  /** Идентификатор плательщика (email/телефон) — для repeat_payer. PII, в логи не пишем. */
  payer: string | null;
  createdAt: Date;
}

export interface RiskFinding {
  code: RuleCode;
  shopId: string;
  /** Представительная операция находки (для ссылки из карточки события). */
  invoiceId: string | null;
  severity: RiskSeverity;
  /** Стабильный ключ: тот же вход + тот же now → тот же ключ (дедуп прогонов). */
  dedupKey: string;
  details: Record<string, unknown>;
}

export const RULE_CODES: readonly RuleCode[] = [
  'velocity_point',
  'structuring',
  'repeat_payer',
  'off_hours',
];

export const RISK_RULE_LABELS: Record<RuleCode, string> = {
  velocity_point: 'Всплеск операций по точке',
  structuring: 'Дробление платежей',
  repeat_payer: 'Повторный плательщик / IP',
  off_hours: 'Нетипичное время',
};

/** Человеческое описание каждого параметра — для редактора порогов. */
export const RISK_PARAM_LABELS: Record<string, string> = {
  windowH: 'Окно, часов',
  windowMin: 'Окно, минут',
  spikeFactor: 'Множитель всплеска (×базовая линия)',
  baselineDays: 'База: дней истории',
  minOps: 'Минимум операций в окне',
  minCount: 'Минимум операций',
  tolerancePct: 'Близость сумм, %',
};

/** Дефолтные правила-старт (подтверждены на A5). Пороги затем правятся из админки. */
export const DEFAULT_RISK_RULES: readonly RiskRuleConfig[] = [
  { code: 'velocity_point', severity: 'high', params: { windowH: 1, spikeFactor: 3, baselineDays: 7, minOps: 8 } },
  { code: 'structuring', severity: 'medium', params: { minCount: 5, windowMin: 15, tolerancePct: 10 } },
  { code: 'repeat_payer', severity: 'medium', params: { minCount: 5, windowH: 1 } },
  { code: 'off_hours', severity: 'low', params: { minOps: 3, baselineDays: 7 } },
];

// ── Утилиты ────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function num(params: Record<string, number>, key: string, def: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** |a−base| ≤ tolPct% от base (сравнение сумм в bigint без потери точности). */
function withinTolerance(a: bigint, base: bigint, tolPct: number): boolean {
  if (base <= 0n) return a === base;
  return absBig(a - base) * 100n <= BigInt(Math.max(0, Math.round(tolPct))) * base;
}

// ── Правило: всплеск операций по точке (velocity) ────────────────────────────

function detectVelocity(rule: RiskRuleConfig, ops: readonly RiskOp[], now: Date): RiskFinding[] {
  const windowH = num(rule.params, 'windowH', 1);
  const spike = num(rule.params, 'spikeFactor', 3);
  const baselineDays = num(rule.params, 'baselineDays', 7);
  const minOps = num(rule.params, 'minOps', 5);

  const nowMs = now.getTime();
  const windowMs = Math.max(windowH, 0.0001) * HOUR_MS;
  const winStart = nowMs - windowMs;

  const inWindow = ops.filter((o) => {
    const t = o.createdAt.getTime();
    return t > winStart && t <= nowMs;
  });
  const count = inWindow.length;
  if (count < minOps) return [];

  const baseStart = nowMs - baselineDays * DAY_MS;
  const baseOps = ops.filter((o) => {
    const t = o.createdAt.getTime();
    return t >= baseStart && t <= winStart;
  });
  const windowsInBaseline = Math.max((baselineDays * 24) / windowH, 1);
  const baselineAvg = baseOps.length / windowsInBaseline;
  // Пол базовой линии = 1, иначе на тихой точке любой всплеск бесконечно кратен.
  const threshold = spike * Math.max(baselineAvg, 1);
  if (count < threshold) return [];

  const shopId = inWindow[0]!.shopId;
  // Суточный бакет: одно активное velocity-событие на точку в сутки. Устойчив к
  // сдвигу времени между прогонами (seed → cron) — не плодит дубли того же всплеска.
  const bucket = Math.floor(nowMs / DAY_MS);
  return [
    {
      code: 'velocity_point',
      shopId,
      invoiceId: inWindow[inWindow.length - 1]!.invoiceId,
      severity: rule.severity,
      dedupKey: `velocity_point:${shopId}:${bucket}`,
      details: {
        windowH,
        count,
        baselineAvgPerWindow: round2(baselineAvg),
        spikeFactor: spike,
        threshold: round2(threshold),
        paramsSnapshot: rule.params,
      },
    },
  ];
}

// ── Правило: дробление платежей (structuring) ────────────────────────────────

function detectStructuring(rule: RiskRuleConfig, ops: readonly RiskOp[], _now: Date): RiskFinding[] {
  const minCount = num(rule.params, 'minCount', 5);
  const windowMin = num(rule.params, 'windowMin', 15);
  const tol = num(rule.params, 'tolerancePct', 10);
  const windowMs = windowMin * 60_000;

  const sorted = [...ops].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const used = new Set<string>();
  const findings: RiskFinding[] = [];

  for (const anchor of sorted) {
    if (used.has(anchor.invoiceId)) continue;
    const t0 = anchor.createdAt.getTime();
    const cluster = sorted.filter((o) => {
      if (used.has(o.invoiceId)) return false;
      const t = o.createdAt.getTime();
      return t >= t0 && t <= t0 + windowMs && withinTolerance(o.amountMinor, anchor.amountMinor, tol);
    });
    if (cluster.length < minCount) continue;

    for (const o of cluster) used.add(o.invoiceId);
    const amounts = cluster.map((o) => o.amountMinor);
    let min = amounts[0]!;
    let max = amounts[0]!;
    for (const a of amounts) {
      if (a < min) min = a;
      if (a > max) max = a;
    }
    findings.push({
      code: 'structuring',
      shopId: anchor.shopId,
      invoiceId: anchor.invoiceId,
      severity: rule.severity,
      dedupKey: `structuring:${anchor.shopId}:${anchor.invoiceId}`,
      details: {
        count: cluster.length,
        windowMin,
        tolerancePct: tol,
        minAmountMinor: min.toString(),
        maxAmountMinor: max.toString(),
        orderIds: cluster.map((o) => o.orderId),
        paramsSnapshot: rule.params,
      },
    });
  }
  return findings;
}

// ── Правило: повторный плательщик / IP (repeat_payer) ────────────────────────

function detectRepeatPayer(rule: RiskRuleConfig, ops: readonly RiskOp[], now: Date): RiskFinding[] {
  const minCount = num(rule.params, 'minCount', 5);
  const windowH = num(rule.params, 'windowH', 1);
  const nowMs = now.getTime();
  const winStart = nowMs - windowH * HOUR_MS;

  const byIp = new Map<string, RiskOp[]>();
  for (const o of ops) {
    if (!o.ip) continue;
    const t = o.createdAt.getTime();
    if (t > winStart && t <= nowMs) pushInto(byIp, o.ip, o);
  }

  // Суточный бакет: одно активное событие на (точка, IP) в сутки — устойчиво к
  // сдвигу времени между прогонами.
  const bucket = Math.floor(nowMs / DAY_MS);
  const findings: RiskFinding[] = [];
  for (const [ip, list] of byIp) {
    if (list.length < minCount) continue;
    const uniquePayers = new Set(list.map((o) => o.payer ?? 'неизвестен')).size;
    findings.push({
      code: 'repeat_payer',
      shopId: list[0]!.shopId,
      invoiceId: list[list.length - 1]!.invoiceId,
      severity: rule.severity,
      dedupKey: `repeat_payer:${list[0]!.shopId}:${ip}:${bucket}`,
      // Контекст для быстрого dismiss: офисный Wi-Fi даёт много операций с одного IP,
      // но много уникальных плательщиков → норма. Кладём список и число плательщиков.
      details: {
        ip,
        count: list.length,
        windowH,
        uniquePayers,
        operations: list.map((o) => ({
          orderId: o.orderId,
          payer: o.payer,
          at: o.createdAt.toISOString(),
        })),
        paramsSnapshot: rule.params,
      },
    });
  }
  return findings;
}

// ── Правило: нетипичное время (off_hours) ────────────────────────────────────

function detectOffHours(rule: RiskRuleConfig, ops: readonly RiskOp[], now: Date): RiskFinding[] {
  const minOps = num(rule.params, 'minOps', 3);
  const baselineDays = num(rule.params, 'baselineDays', 7);
  const nowMs = now.getTime();
  const winStart = nowMs - HOUR_MS;
  const baseStart = nowMs - baselineDays * DAY_MS;

  const historicalHours = new Set<number>();
  for (const o of ops) {
    const t = o.createdAt.getTime();
    if (t >= baseStart && t <= winStart) historicalHours.add(o.createdAt.getUTCHours());
  }

  const byHour = new Map<number, RiskOp[]>();
  for (const o of ops) {
    const t = o.createdAt.getTime();
    if (t > winStart && t <= nowMs) pushInto(byHour, o.createdAt.getUTCHours(), o);
  }

  const dayBucket = Math.floor(nowMs / DAY_MS);
  const findings: RiskFinding[] = [];
  for (const [hour, list] of byHour) {
    if (historicalHours.has(hour) || list.length < minOps) continue;
    findings.push({
      code: 'off_hours',
      shopId: list[0]!.shopId,
      invoiceId: list[list.length - 1]!.invoiceId,
      severity: rule.severity,
      dedupKey: `off_hours:${list[0]!.shopId}:${dayBucket}:${hour}`,
      details: {
        hourUtc: hour,
        count: list.length,
        historicalOpsInHour: 0,
        baselineDays,
        paramsSnapshot: rule.params,
      },
    });
  }
  return findings;
}

// ── Диспетчер ────────────────────────────────────────────────────────────────

export function evaluateRule(rule: RiskRuleConfig, ops: readonly RiskOp[], now: Date): RiskFinding[] {
  switch (rule.code) {
    case 'velocity_point':
      return detectVelocity(rule, ops, now);
    case 'structuring':
      return detectStructuring(rule, ops, now);
    case 'repeat_payer':
      return detectRepeatPayer(rule, ops, now);
    case 'off_hours':
      return detectOffHours(rule, ops, now);
  }
}

/** Прогнать все включённые правила по операциям одной точки. */
export function evaluateShop(
  rules: readonly RiskRuleConfig[],
  ops: readonly RiskOp[],
  now: Date,
): RiskFinding[] {
  return rules.flatMap((rule) => evaluateRule(rule, ops, now));
}
