import { formatAmount } from '@coincash/core';
import { cn } from '@/lib/cn';

export interface MoneyProps {
  minor: bigint | number;
  className?: string;
  /** inverse — для залитых зелёным поверхностей (белая цифра). */
  tone?: 'default' | 'inverse';
}

/**
 * Деньги: вес 600, tabular-nums. Копейки — ТОГО ЖЕ кегля и веса, что рубли, без приглушения
 * (правка владельца: мелкие копейки нечитаемы — «8745,22 мелкие»; правило «52–55% кегля»
 * отменено в CLAUDE.md). Приглушён только символ валюты. Копейки показываются ВСЕГДА,
 * включая ,00 — правка владельца 25.08.2026 (скрытие при нуле убрано из formatAmount).
 */
export function Money({ minor, className, tone = 'default' }: MoneyProps) {
  const value = typeof minor === 'bigint' ? minor : BigInt(Math.trunc(minor));
  const { major, minor: kop } = formatAmount(value);
  const muted = tone === 'inverse' ? 'text-white/60' : 'text-ink-3';
  return (
    <span className={cn('tnum font-semibold', className)}>
      {major}
      <span>,{kop}</span>
      <span className={cn('font-normal', muted)}>&nbsp;₽</span>
    </span>
  );
}
