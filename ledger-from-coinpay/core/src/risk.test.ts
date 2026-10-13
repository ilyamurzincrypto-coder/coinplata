import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_RULES,
  type RiskOp,
  type RiskRuleConfig,
  evaluateRule,
  evaluateShop,
} from './risk';

const NOW = new Date('2026-07-12T12:00:00.000Z');
const SHOP = 'shop-1';

function op(over: Partial<RiskOp> & { orderId: string; at: string }): RiskOp {
  return {
    invoiceId: `inv-${over.orderId}`,
    orderId: over.orderId,
    shopId: over.shopId ?? SHOP,
    amountMinor: over.amountMinor ?? 500000n,
    ip: over.ip ?? null,
    payer: over.payer ?? null,
    createdAt: new Date(over.at),
  };
}

/** Минут назад от NOW — ISO-строка. */
function minAgo(m: number): string {
  return new Date(NOW.getTime() - m * 60_000).toISOString();
}
function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 86_400_000).toISOString();
}

const RULE = (code: RiskRuleConfig['code']): RiskRuleConfig =>
  DEFAULT_RISK_RULES.find((r) => r.code === code)!;

describe('velocity_point', () => {
  it('срабатывает на всплеске операций по тихой точке', () => {
    // 9 операций за последний час, истории нет → baselineAvg=0, порог=3 → 9≥8 и 9≥3.
    const ops = [5, 12, 20, 28, 35, 40, 45, 50, 55].map((m, i) => op({ orderId: `V${i}`, at: minAgo(m) }));
    const found = evaluateRule(RULE('velocity_point'), ops, NOW);
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe('velocity_point');
    expect(found[0]!.severity).toBe('high');
    expect(found[0]!.details.count).toBe(9);
    // Снапшот параметров сохранён (объяснимость после тюнинга порогов).
    expect(found[0]!.details.paramsSnapshot).toEqual(RULE('velocity_point').params);
  });

  it('не срабатывает ниже минимума операций', () => {
    // 6 операций (< minOps=8) — не всплеск по правилу.
    const ops = [10, 20, 30, 40, 50, 55].map((m, i) => op({ orderId: `v${i}`, at: minAgo(m) }));
    expect(evaluateRule(RULE('velocity_point'), ops, NOW)).toHaveLength(0);
  });

  it('не срабатывает, когда всплеск ниже множителя относительно базовой линии', () => {
    // Дневное окно: база 30 операций за 7 дней (avg≈4.3/сутки), сегодня 10 → порог≈12.9 > 10.
    const rule: RiskRuleConfig = {
      code: 'velocity_point',
      severity: 'high',
      params: { windowH: 24, spikeFactor: 3, baselineDays: 7, minOps: 5 },
    };
    const today = Array.from({ length: 10 }, (_, i) => op({ orderId: `t${i}`, at: minAgo(30 + i * 60) }));
    const base = Array.from({ length: 30 }, (_, i) =>
      op({ orderId: `b${i}`, at: daysAgo(1 + (i % 6)) }),
    );
    expect(evaluateRule(rule, [...today, ...base], NOW)).toHaveLength(0);
  });
});

describe('structuring', () => {
  it('ловит кластер близких сумм в узком окне', () => {
    // 5 операций ~5000 ₽ (±10%) за 12 минут.
    const amounts = [500000n, 495000n, 505000n, 498000n, 502000n];
    const ops = amounts.map((a, i) => op({ orderId: `S${i}`, amountMinor: a, at: minAgo(20 - i * 2) }));
    const found = evaluateRule(RULE('structuring'), ops, NOW);
    expect(found).toHaveLength(1);
    expect(found[0]!.details.count).toBe(5);
    expect(found[0]!.severity).toBe('medium');
  });

  it('не считает дроблением далёкие суммы или растянутые во времени', () => {
    const farAmounts = [100000n, 900000n, 300000n, 700000n, 500000n].map((a, i) =>
      op({ orderId: `f${i}`, amountMinor: a, at: minAgo(20 - i * 2) }),
    );
    expect(evaluateRule(RULE('structuring'), farAmounts, NOW)).toHaveLength(0);
    // Близкие суммы, но за 2 часа (шире окна 15 мин).
    const spread = [500000n, 500000n, 500000n, 500000n, 500000n].map((a, i) =>
      op({ orderId: `w${i}`, amountMinor: a, at: minAgo(i * 30) }),
    );
    expect(evaluateRule(RULE('structuring'), spread, NOW)).toHaveLength(0);
  });
});

describe('repeat_payer', () => {
  it('срабатывает на 5+ операций с одного IP за час и кладёт контекст', () => {
    const ops = Array.from({ length: 5 }, (_, i) =>
      op({ orderId: `R${i}`, ip: '203.0.113.5', payer: `payer-${i % 2}`, at: minAgo(i * 5) }),
    );
    const found = evaluateRule(RULE('repeat_payer'), ops, NOW);
    expect(found).toHaveLength(1);
    expect(found[0]!.details.ip).toBe('203.0.113.5');
    expect(found[0]!.details.count).toBe(5);
    // Контекст для dismiss: 2 уникальных плательщика + полный список операций.
    expect(found[0]!.details.uniquePayers).toBe(2);
    expect((found[0]!.details.operations as unknown[]).length).toBe(5);
  });

  it('не срабатывает при разных IP', () => {
    const ops = Array.from({ length: 5 }, (_, i) =>
      op({ orderId: `d${i}`, ip: `203.0.113.${i}`, at: minAgo(i * 5) }),
    );
    expect(evaluateRule(RULE('repeat_payer'), ops, NOW)).toHaveLength(0);
  });
});

describe('off_hours', () => {
  it('срабатывает на активность в исторически пустой час', () => {
    const now = new Date('2026-07-12T03:30:00.000Z');
    const nowMs = now.getTime();
    // История только в 14:00 UTC последние 7 дней.
    const hist = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(nowMs - (i + 1) * 86_400_000);
      d.setUTCHours(14, 0, 0, 0);
      return op({ orderId: `h${i}`, at: d.toISOString() });
    });
    // Сейчас 3 операции в 03:xx — час 3 исторически пуст.
    const current = [5, 10, 15].map((m, i) =>
      op({ orderId: `o${i}`, at: new Date(nowMs - m * 60_000).toISOString() }),
    );
    const found = evaluateRule(RULE('off_hours'), [...hist, ...current], now);
    expect(found).toHaveLength(1);
    expect(found[0]!.details.hourUtc).toBe(3);
    expect(found[0]!.severity).toBe('low');
  });
});

describe('evaluateShop / детерминизм', () => {
  it('тихая точка не даёт находок', () => {
    const ops = [op({ orderId: 'q0', at: daysAgo(3) }), op({ orderId: 'q1', at: daysAgo(5) })];
    expect(evaluateShop(DEFAULT_RISK_RULES, ops, NOW)).toHaveLength(0);
  });

  it('повторный прогон по тем же данным даёт те же dedupKey (идемпотентность)', () => {
    const ops = [5, 12, 20, 28, 35, 40, 45, 50, 55].map((m, i) => op({ orderId: `V${i}`, at: minAgo(m) }));
    const a = evaluateShop(DEFAULT_RISK_RULES, ops, NOW).map((f) => f.dedupKey);
    const b = evaluateShop(DEFAULT_RISK_RULES, ops, NOW).map((f) => f.dedupKey);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
