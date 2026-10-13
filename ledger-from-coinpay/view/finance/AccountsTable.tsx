import Link from 'next/link';
import { cn } from '@/lib/cn';
import { csvAmount } from '@/lib/csv';
import { Amount } from '@/components/ui/Amount';
import { accLabel, accRole, eqMinor, formLabel } from '@/lib/finance/account-display';
import type { TreeAccount } from '@/lib/finance/tree';
import { UrlSortHeader } from '@/components/finance/UrlSortHeader';
import { CopyRowButton } from '@/components/finance/CopyRowButton';

/**
 * (Эталон «таблицы счетов») ЕДИНЫЙ табличный компонент для Лоро · Ностро и кассы · Капитал.
 * Отличия от прежних flex-строк: настоящая <table> с `table-layout: fixed` и <colgroup> —
 * колонки стоят на одних вертикалях при любом содержимом, длинное режется многоточием, переносов
 * нет. 🔴 ЖЕЛЕЗОБЕТОННОЕ ПРАВИЛО ВЛАДЕЛЬЦА: НИ ОДНА ячейка не переносится на вторую строку
 * («USDT-TRC20» и «Кошелёк · цифровая» ломались надвое) и никаких <br>. Строка ВСЕГДА одна,
 * поэтому высота всех строк одинакова и таблицы всех вкладок одного размера. Чтобы имена при
 * этом были видны ЦЕЛИКОМ, колонки расширены под самые длинные боевые значения, а не
 * переносятся. Тип — ОТДЕЛЬНЫЙ столбец сразу после наименования
 * (правка владельца: в приписку его прятать нельзя), дальше остаток. Нулевой счёт приглушается
 * всей строкой. Плашка итога — под таблицей, считается по видимым строкам (уважает фильтр и вид).
 *
 * 🔴 ПРАВИЛО ВЛАДЕЛЬЦА: Лоро, Ностро и кассы, Капитал обязаны выглядеть ИДЕНТИЧНО — один
 * компонент, ОДИН набор колонок, те же ширины и порядок; различаются только данные строк.
 * Поэтому колонка «Контрагент» есть ВЕЗДЕ: в Лоро это клиент, в Ностро и Капитале —
 * «Платформа» (счета принадлежат нам). Эталон разрешал эту колонку только в плоском Лоро —
 * правило владельца имеет приоритет над эталоном. Колонку, нужную одной вкладке, добавлять
 * нельзя: сначала спросить.
 *
 * Шрифт и цвета — существующие токены проекта (paper/card/line/ink), НЕ хексы из эталона: он сам
 * это предписывает. Номера — Golos Text с `tabular-nums`, а не моноширинный: моноширинный запрещён
 * дизайн-системой (CLAUDE.md, «Никогда»), а выравнивание цифр даёт tnum.
 */

const twoFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface AccountTableRow {
  acc: TreeAccount;
  isPoint: boolean;
  /** Владелец счёта: клиент (Лоро) либо «Платформа» (Ностро/Капитал). Колонка есть ВЕЗДЕ. */
  counterpartyName?: string;
  /** Атрибут к наименованию (канон K3: hold 445 «в обработке банка» — приписка, НЕ вторая строка). */
  extraNote?: string;
  href: string;
}

/**
 * «Точка» — только настоящая точка клиента: у неё точечный номер («140-C0007.02-…»).
 * В дереве в `points[]` мерчанта лежат ещё hold/reserve и второй расчётный по валюте —
 * они точками не являются, и подписывать их «Точка» нельзя.
 */
function isRealPoint(acc: TreeAccount, isPoint: boolean): boolean {
  return isPoint && acc.number.includes('.');
}

/**
 * Столбец «Тип»: роль счёта + форма, если она не читается из самой роли
 * («Расчётный · безнал», «Ностро (нал)», «Кошелёк»).
 */
function typeOf(acc: TreeAccount, isPoint: boolean): string {
  const role = accRole(acc, isRealPoint(acc, isPoint));
  const form = formLabel(acc.form, acc.isCrypto);
  if (form === '—' || role.toLowerCase().includes(form.toLowerCase())) return role;
  return `${role} · ${form}`;
}

/** Подпись «Наименование» строки — та же, что в ячейке. Нужна поиску и копированию строки. */
export function rowNameLabel(acc: TreeAccount, isPoint: boolean): string {
  return accLabel(acc, isRealPoint(acc, isPoint));
}

/** Подпись «Тип» строки — та же, что в ячейке. */
export function rowTypeLabel(acc: TreeAccount, isPoint: boolean): string {
  return typeOf(acc, isPoint);
}

/**
 * Строка для буфера: поля через табуляцию, сумма без разделителя разрядов — Excel читает её числом.
 *
 * 🔴 Знаков столько же, сколько в ячейке рядом (`acc.minorUnits` из справочника). Копия жила
 * своей жизнью и делила на 100 при любой валюте: экран показывал «218,5224 ₮», а в буфер уезжало
 * «21852,24» — в сто раз больше, и именно эта цифра попадала в чужую таблицу.
 */
function copyText(r: AccountTableRow): string {
  const amount = csvAmount(r.acc.presentedMinor, r.acc.minorUnits, { decimal: ',' });
  return [r.acc.number, r.counterpartyName ?? '', rowNameLabel(r.acc, r.isPoint), typeOf(r.acc, r.isPoint), `${amount} ${r.acc.currency}`].join('\t');
}

/** Колонки, по которым таблица сортируется (ключ `sort` в URL). */
export const ACCOUNT_SORT_COLS = ['number', 'counterparty', 'name', 'type', 'currency', 'usd'] as const;
export type AccountSortCol = (typeof ACCOUNT_SORT_COLS)[number];

function EqCell({ rubMinor, rateE6, sym }: { rubMinor: bigint | null; rateE6: bigint | null; sym: string }) {
  const v = eqMinor(rubMinor, rateE6);
  if (v === null) return <span className="text-ink-3">—</span>;
  return <>{twoFmt.format(Number(v) / 100)}<span className="text-ink-3">&nbsp;{sym}</span></>;
}

export function AccountsTable({
  rows,
  rateE6,
  rateEurE6,
  emptyText,
  footerNote,
  action,
  sortable = false,
}: {
  rows: AccountTableRow[];
  rateE6: bigint | null;
  rateEurE6: bigint | null;
  emptyText: string;
  /** Левая половина плашки итога: «14 счетов · 9 клиентов · фильтр: все». */
  footerNote: string;
  /** Кнопка «+ Контрагент» / «Открыть ностро» / «Добавить валюту» — под таблицей. */
  action?: React.ReactNode;
  /**
   * Заголовки сортируют таблицу через URL (`sort`/`dir`). Сам порядок строк задаёт родитель —
   * включать только там, где он этот параметр читает, иначе стрелка есть, а порядок не меняется.
   */
  sortable?: boolean;
}) {
  const head = (label: string, col: AccountSortCol, align?: 'right') =>
    sortable ? <UrlSortHeader label={label} col={col} align={align} isDefault={col === 'usd'} defaultDir="desc" /> : label;
  const totalRub = rows.reduce<bigint>((s, r) => s + (r.acc.rubEquivMinor ?? 0n), 0n);
  const totalUsd = eqMinor(totalRub, rateE6);
  const totalEur = eqMinor(totalRub, rateEurE6);

  return (
    <div className="rounded-card border border-line bg-card p-4 sm:p-5">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse min-w-[1220px]">
          <colgroup>
            {/* Ширины подобраны под самые длинные боевые значения, чтобы НИЧЕГО не переносилось:
                номер «140-C0007.02-0643-02», контрагент «Toy market test 10/08/2026 18-10»,
                тип «Кошелёк · цифровая», валюта «USDT-TRC20». Одинаковы на всех вкладках. */}
            <col className="w-[168px]" />
            <col className="w-[288px]" />
            <col />
            <col className="w-[184px]" />
            <col className="w-[144px]" />
            <col className="w-[104px]" />
            <col className="w-[108px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:truncate [&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-line-2 [&>th]:px-3 [&>th]:pb-2.5 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-medium [&>th]:text-ink-3 [&>th+th]:border-l [&>th+th]:border-line [&>th:first-child]:pl-1 [&>th:last-child]:pr-1">
              <th>{head('Номер', 'number')}</th>
              <th>{head('Контрагент', 'counterparty')}</th>
              <th>{head('Наименование', 'name')}</th>
              <th>{head('Тип', 'type')}</th>
              <th className="!text-right">Остаток</th>
              <th>{head('Вал', 'currency')}</th>
              <th className="!text-right">{sortable ? head('$', 'usd', 'right') : <>$&nbsp;↓</>}</th>
              <th className="!text-right">€</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-ink-3">{emptyText}</td>
              </tr>
            ) : (
              rows.map((row) => {
                const { acc, isPoint, counterpartyName, extraNote, href } = row;
                const zero = acc.presentedMinor === 0n;
                return (
                  <tr
                    key={acc.id}
                    className={cn(
                      'group transition-colors hover:bg-green-tint/30',
                      '[&>td]:h-[52px] [&>td]:truncate [&>td]:whitespace-nowrap [&>td]:border-t [&>td]:border-line [&>td]:px-3 [&>td]:align-middle',
                      '[&>td+td]:border-l [&>td+td]:border-line/70 [&>td:first-child]:pl-1 [&>td:last-child]:pr-1',
                      zero && 'text-ink-3 [&_*]:!text-ink-3 [&_*]:!font-normal',
                    )}
                  >
                    <td className="tnum text-[12.5px] text-ink-2">
                      <Link href={href} className="hover:underline">{acc.number}</Link>
                    </td>
                    {/* Владелец счёта ЦЕЛИКОМ: не режем многоточием, при нехватке ширины переносим. */}
                    <td className="text-[13px] text-ink">{counterpartyName ?? '—'}</td>
                    <td className="relative text-sm text-ink">
                      <Link href={href} className="hover:underline">{accLabel(acc, isRealPoint(acc, isPoint))}</Link>
                      {extraNote ? <span className="ml-2 text-[11.5px] font-normal text-ink-3">{extraNote}</span> : null}
                      <CopyRowButton text={copyText(row)} className="absolute right-1.5 top-1/2 -translate-y-1/2" />
                    </td>
                    <td className="text-[12.5px] text-ink-2">{typeOf(acc, isPoint)}</td>
                    <td className="text-right text-sm">
                      <Amount minor={acc.presentedMinor} currency={acc.currency} minorUnits={acc.minorUnits} />
                    </td>
                    <td className="tnum text-[11.5px] text-ink-3">{acc.currency}</td>
                    <td className="tnum text-right text-[12.5px] text-ink-2">
                      <EqCell rubMinor={acc.rubEquivMinor} rateE6={rateE6} sym="$" />
                    </td>
                    <td className="tnum text-right text-[12.5px] text-ink-2">
                      <EqCell rubMinor={acc.rubEquivMinor} rateE6={rateEurE6} sym="€" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-paper/70 px-3.5 py-2.5">
        <span className="text-[11.5px] text-ink-3">{footerNote}</span>
        <span className="text-[12.5px] text-ink">
          Итого&nbsp;&nbsp;
          <b className="tnum font-semibold">{totalUsd !== null ? `${twoFmt.format(Number(totalUsd) / 100)} $` : '—'}</b>
          &nbsp;&nbsp;
          <span className="tnum text-ink-2">{totalEur !== null ? `${twoFmt.format(Number(totalEur) / 100)} €` : '—'}</span>
        </span>
      </div>

      {action ? <div className="mt-3 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
