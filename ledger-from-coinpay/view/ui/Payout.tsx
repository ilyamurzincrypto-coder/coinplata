import { currencySymbol, formatPayoutMinor, isPayoutAsset } from '@coincash/core';
import { cn } from '@/lib/cn';

/**
 * ВЫДАЧА КЛИЕНТУ по QR-оплате: что кассир отдал на руки — «2 000,00 ₺», «50,0000 ₮», «8 745,22 ₽».
 *
 * Отдельный компонент, потому что это число печатают три экрана (журнал кассы, борд расчёта,
 * карточка операции), и печатать его обязаны одинаково: у тезера четыре знака, у наличных два,
 * дробная часть — того же кегля, что целая (дизайн-система), приглушён только символ валюты.
 * Считает не он — считает касса; здесь единственный ФОРМАТТЕР (`formatPayoutMinor` из ядра).
 *
 * Старые оплаты записи о выдаче не имеют (null) — прочерк, а не пустота и не ноль.
 */
export function Payout({ minor, currency, className, tone = 'default' }: {
  minor: bigint | string | null;
  currency: string | null;
  className?: string;
  tone?: 'default' | 'inverse';
}) {
  if (minor === null || !currency || !isPayoutAsset(currency)) return <span className={cn('text-ink-3', className)}>—</span>;
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  const muted = tone === 'inverse' ? 'text-white/60' : 'text-ink-3';
  return (
    <span className={cn('tnum font-semibold', className)}>
      {formatPayoutMinor(value, currency)}
      <span className={cn('font-normal', muted)}>&nbsp;{currencySymbol(currency)}</span>
    </span>
  );
}
