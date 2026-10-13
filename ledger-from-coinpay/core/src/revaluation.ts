/**
 * Переоценка валютной позиции (F2c) — чистая математика.
 * Модель: платформа держит USD-позицию; её RUB-оценка (контрвалюта) переоценивается
 * по текущему курсу. Курсовая разница — проводкой в RUB (обе ноги RUB, USD НЕ
 * двигается → инвариант держится без исключений). Контрвалюта отслеживает
 * накопленную оценку → пропущенный день догоняется дельтой «new − current» без
 * задвоения (идемпотентность/догон обеспечиваются кумулятивностью контрвалюты).
 */

import type { Minor } from './money';
import { assertBalanced, type EntryDraft, type TxDraft } from './ledger';
import { roundHalfEvenDiv, floorDivBig, ceilDivBig } from './fx';
import type { RoundingMode } from './exchange';

const E6 = 1_000_000n;

function roundSigned(numer: bigint, denom: bigint, mode: RoundingMode): bigint {
  if (mode === 'bankers') return roundHalfEvenDiv(numer, denom);
  // platform: к нулю (усечение) — нейтрально для переоценки.
  return numer >= 0n ? floorDivBig(numer, denom) : ceilDivBig(numer, denom);
}

export interface BuildRevaluationParams {
  /** USD-позиция платформы (копейки USD, знак — может быть отрицательной). */
  usdPositionMinor: Minor;
  /** Текущая RUB-оценка позиции (копейки RUB) — из контрвалютного счёта. */
  currentCountervalueMinor: Minor;
  /** Курс RUB за 1 USD ×10⁶. */
  rateE6: bigint;
  accounts: { countervalue: string; revalPnl: string };
  rounding?: RoundingMode;
  idempotencyKey?: string;
}

export interface RevaluationResult {
  /** null, если дельта = 0 (курс/позиция не изменились → нет проводки, идемпотентно). */
  tx: TxDraft | null;
  deltaMinor: Minor;
  newCountervalueMinor: Minor;
}

/**
 * Переоценка: новая RUB-оценка = USD-позиция × курс; дельта относительно текущей
 * контрвалюты → проводка контрвалюта ↔ reval_pnl (обе RUB, Σ=0). Дельта=0 → tx=null.
 */
export function buildRevaluationTx(p: BuildRevaluationParams): RevaluationResult {
  if (p.rateE6 <= 0n) throw new Error('buildRevaluationTx: курс > 0');
  const rounding = p.rounding ?? 'bankers';
  const newCountervalueMinor = roundSigned(p.usdPositionMinor * p.rateE6, E6, rounding);
  const deltaMinor = newCountervalueMinor - p.currentCountervalueMinor;
  if (deltaMinor === 0n) return { tx: null, deltaMinor: 0n, newCountervalueMinor };
  const entries: EntryDraft[] = [
    { accountId: p.accounts.countervalue, amountMinor: deltaMinor, currency: 'RUB' },
    { accountId: p.accounts.revalPnl, amountMinor: -deltaMinor, currency: 'RUB' },
  ];
  assertBalanced(entries);
  const tx: TxDraft = { kind: 'revaluation', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return { tx, deltaMinor, newCountervalueMinor };
}
