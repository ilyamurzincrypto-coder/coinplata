import { Amount } from '@/components/ui/Amount';
import type { CurrencyBalance } from '@/lib/data/participants';

/**
 * (Б2-1) Остатки ПО ВАЛЮТАМ. Каждая сумма подписана своей валютой через `Amount`,
 * а не через `Money` — тот всегда клеит «₽», и на боевом это показало мерчанту
 * «975,00 ₽» вместо «975,00 $».
 *
 * Валюты выводятся строками одна под другой и НЕ складываются: сумма долларов и рублей
 * не имеет смысла. Рубль всегда первым — это валюта приёма.
 */
export function CurrencyBalances({
  balances,
  size = 'lg',
  /**
   * (Блок 5) Валюта, в которой показать ЯВНЫЙ НОЛЬ, когда строк нет.
   *
   * Прочерк и ноль — разные утверждения: «—» читается как «неизвестно/не считали», а у резерва
   * ответ известен и он нулевой. Раньше мерчант с пустым резервом видел «—» и не понимал,
   * заморожено у него что-то или просто не показали. Там, где ноль — это ответ, пишем «0,00 ₽».
   */
  zeroIn,
}: {
  balances: CurrencyBalance[];
  size?: 'lg' | 'sm';
  zeroIn?: string;
}) {
  if (balances.length === 0) {
    if (zeroIn) return <Amount minor={0n} currency={zeroIn} className={size === 'lg' ? 'text-2xl' : 'text-sm'} />;
    return <span className="text-ink-3">—</span>;
  }

  return (
    <div className={size === 'lg' ? 'flex flex-col gap-1' : 'flex flex-wrap items-baseline gap-x-4 gap-y-1'}>
      {balances.map((b) => (
        <div key={b.currency} className={size === 'lg' ? 'text-2xl' : 'text-sm'}>
          <Amount minor={b.minor} currency={b.currency} />
        </div>
      ))}
    </div>
  );
}
