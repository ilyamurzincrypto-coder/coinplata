import { currencySymbol, defaultMinorUnits, formatAmount } from '@coincash/core';
import { cn } from '@/lib/cn';

const roundFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/**
 * 🔴 Число знаков — НЕ константа: у тезера их четыре, у рубля два, и задаётся это в справочнике
 * валют (`currencies.minor_units`), который правится из админки.
 *
 * Пока форматтер делил на 100 всегда, 2 185 224 минорных единиц тезера читались как «21 852,24 ₮»
 * вместо «218,5224 ₮» — ошибка в СТО РАЗ на экране остатков. Поэтому `minorUnits` приходит из
 * данных вместе с валютой; дефолт 2 оставлен только для рублёвых вызовов.
 */
const fmtCache = new Map<number, Intl.NumberFormat>();
function fractionFmt(units: number): Intl.NumberFormat {
  let f = fmtCache.get(units);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: units, maximumFractionDigits: units });
    fmtCache.set(units, f);
  }
  return f;
}

/**
 * Денежная сумма с символом валюты ИЗ СПРАВОЧНИКА (RUB → «₽» через formatAmount; прочие —
 * `currencySymbol`, напр. EUR → «€», USDT → «₮»). Правка владельца: символ больше НЕ
 * захардкожен «$» — EUR показывался долларом. Знак сохраняется; цвет не навешивается.
 */
export function Amount({
  minor,
  currency,
  className,
  /**
   * (эталон r7) Символ валюты — надстрочным мелким знаком, как в макете кабинета.
   *
   * Живёт ЗДЕСЬ, а не отдельным компонентом: денежный форматтер в проекте один, и второй
   * неизбежно разойдётся с этим в округлении или в разделителе. Меняется подача символа —
   * сама сумма и копейки форматируются тем же кодом.
   */
  sup = false,
  /**
   * (эталон r7) Оверсайз-цифры KPI показывают целые рубли: «96 400 ₽».
   *
   * Это не «приглушённые копейки», запрещённые дизайн-системой, а сознательно округлённая
   * подача оборота, где копейка не несёт смысла. Там, где копейка важна (курсы, остатки),
   * `round` не ставится и сумма выводится полностью.
   */
  round = false,
  /**
   * Знаков после запятой у ЭТОЙ валюты — из `currencies.minor_units`, когда данные их несут.
   * Не передали — берём запасной список ядра (тезер 4, фиат 2), а НЕ «два» вслепую.
   */
  minorUnits,
  /** inverse — для залитых зелёным карточек: приглушённый знак валюты становится светлым. */
  tone = 'default',
}: {
  minor: bigint;
  currency: string;
  className?: string;
  sup?: boolean;
  round?: boolean;
  minorUnits?: number;
  tone?: 'default' | 'inverse';
}) {
  const units = minorUnits ?? defaultMinorUnits(currency);
  const suffix = currency === 'RUB' ? '₽' : currencySymbol(currency);
  const muted = tone === 'inverse' ? 'text-white/60' : 'text-ink-3';
  const suffixEl = sup ? (
    <small className={cn('align-super text-[0.38em] font-medium', muted)}>&nbsp;{suffix}</small>
  ) : (
    <span className={cn('font-normal', muted)}>&nbsp;{suffix}</span>
  );
  const scale = 10 ** units;

  if (round) {
    return (
      <span className={cn('tnum font-semibold', className)}>
        {roundFmt.format(Number(minor) / scale)}
        {suffixEl}
      </span>
    );
  }

  if (currency === 'RUB') {
    const { major, minor: kop } = formatAmount(minor);
    return (
      <span className={cn('tnum font-semibold', className)}>
        {major}
        <span>,{kop}</span>
        {suffixEl}
      </span>
    );
  }
  return (
    <span className={cn('tnum font-semibold', className)}>
      {fractionFmt(units).format(Number(minor) / scale)}
      {suffixEl}
    </span>
  );
}
