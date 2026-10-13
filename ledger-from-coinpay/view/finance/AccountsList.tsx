import Link from 'next/link';
import { cn } from '@/lib/cn';
import { ACCOUNT_SORT_COLS, AccountsTable, rowNameLabel, rowTypeLabel, type AccountSortCol, type AccountTableRow } from '@/components/finance/AccountsTable';
import { OpenPlatformAccountForm } from '@/components/finance/OpenPlatformAccountForm';
import { CreateCounterpartyForm } from '@/components/finance/CreateCounterpartyForm';
import { AddCurrencyWizard } from '@/components/finance/AddCurrencyWizard';
import { Amount } from '@/components/ui/Amount';
import { SERVICE_CHIP, eqMinor } from '@/lib/finance/account-display';
import type { FinanceTree, TreeAccount, TreeCounterparty } from '@/lib/finance/tree';

/**
 * (Эталон «таблицы счетов») Секции экрана «Счета». Лоро имеет ДВА вида:
 *  • «Все счета» — одна строка на СЧЁТ, контрагент отдельной колонкой сразу после номера;
 *  • «По клиентам» — прежний список клиентов (клик = страница счетов клиента).
 * Ностро и Капитал — тот же табличный компонент без колонки контрагента.
 * Данные берутся из getFinanceTree: НИКАКОЙ новой логики леджера, только чтение и раскладка.
 */

export type LoroFilter = 'all' | 'exchange' | 'merchant' | 'agent';
export type LoroView = 'accounts' | 'clients';

const twoFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const abs = (v: bigint) => (v < 0n ? -v : v);

/** (fix-loro) Остаток узла-клиента ПО ВАЛЮТАМ (presented) — основная валюта + «+N валют». */
function clientBalances(cp: TreeCounterparty): { primary: { currency: string; minor: bigint }; extra: number } {
  const by = new Map<string, bigint>();
  for (const a of cp.accounts) for (const acc of [a, ...a.points]) by.set(acc.currency, (by.get(acc.currency) ?? 0n) + acc.presentedMinor);
  const nonzero = [...by].filter(([, v]) => v !== 0n).map(([currency, minor]) => ({ currency, minor }));
  if (nonzero.length === 0) return { primary: { currency: 'RUB', minor: 0n }, extra: 0 };
  const rub = nonzero.find((x) => x.currency === 'RUB');
  const primary = rub ?? [...nonzero].sort((a, b) => Number(abs(b.minor) - abs(a.minor)))[0]!;
  return { primary, extra: nonzero.length - 1 };
}

function SectionAddAction({ section }: { section: 'loro' | 'nostro' | 'capital' }) {
  if (section === 'loro') return <CreateCounterpartyForm variant="secondary" label="+ Контрагент" />;
  if (section === 'nostro') return <OpenPlatformAccountForm />;
  return <AddCurrencyWizard />;
}

/** (С8-1) Услуга клиента по РОЛЯМ-счетам: связка обмен+QR показывает обе. */
export function serviceLabel(cp: TreeCounterparty): string {
  if (cp.ownerKind === 'agent') return SERVICE_CHIP.agent!;
  const has = (p: string) => cp.accounts.some((a) => a.number.startsWith(p));
  const roles = [has('140') && 'Обмен', has('440') && 'QR-приём'].filter(Boolean);
  return roles.length ? roles.join(' · ') : SERVICE_CHIP[cp.ownerKind] ?? 'Клиент';
}

/** Плоский список счетов (ностро/капитал/счета клиента): точки — плоскими строками, без вложенности. */
export function flattenAccounts(accs: TreeAccount[]): { acc: TreeAccount; isPoint: boolean }[] {
  const out: { acc: TreeAccount; isPoint: boolean }[] = [];
  for (const a of accs) {
    out.push({ acc: a, isPoint: false });
    for (const p of a.points ?? []) out.push({ acc: p, isPoint: true });
  }
  return out;
}

/** Сортировка по умолчанию — $ по убыванию (деньги сверху), нули вниз, tie-break по номеру. */
function sortByMoney(rows: AccountTableRow[]): AccountTableRow[] {
  return [...rows].sort((a, b) => {
    const d = abs(b.acc.rubEquivMinor ?? 0n) - abs(a.acc.rubEquivMinor ?? 0n);
    if (d !== 0n) return d > 0n ? 1 : -1;
    return a.acc.number.localeCompare(b.acc.number);
  });
}

/** (правка Кирилла) Поиск по видимым полям строки: номер, контрагент, наименование, тип, валюта. */
function filterRows(rows: AccountTableRow[], q: string): AccountTableRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) =>
    [r.acc.number, r.counterpartyName ?? '', rowNameLabel(r.acc, r.isPoint), rowTypeLabel(r.acc, r.isPoint), r.acc.currency]
      .some((v) => v.toLowerCase().includes(needle)),
  );
}

/**
 * (правка Кирилла) Сортировка по колонке из URL. Без параметра — прежний порядок: $ по убыванию.
 * «$» сравнивает модуль рублёвого эквивалента, как и порядок по умолчанию: пассив с минусом —
 * тоже крупные деньги, и прятать его в конец списка нельзя.
 */
function sortRows(rows: AccountTableRow[], sort: string | undefined, dir: 'asc' | 'desc'): AccountTableRow[] {
  if (!sort || !(ACCOUNT_SORT_COLS as readonly string[]).includes(sort)) return sortByMoney(rows);
  const col = sort as AccountSortCol;
  const text = (r: AccountTableRow): string =>
    col === 'number' ? r.acc.number
      : col === 'counterparty' ? r.counterpartyName ?? ''
        : col === 'name' ? rowNameLabel(r.acc, r.isPoint)
          : col === 'type' ? rowTypeLabel(r.acc, r.isPoint)
            : r.acc.currency;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    let d: number;
    if (col === 'usd') {
      const x = abs(a.acc.rubEquivMinor ?? 0n) - abs(b.acc.rubEquivMinor ?? 0n);
      d = x === 0n ? 0 : x > 0n ? 1 : -1;
    } else {
      d = text(a).localeCompare(text(b), 'ru', { numeric: true });
    }
    return d !== 0 ? d * sign : a.acc.number.localeCompare(b.acc.number);
  });
}

/** Строки-клиенты (вид «По клиентам») — та же табличная сетка, без колонки контрагента. */
function ClientsTable({ cps, rateE6, rateEurE6, footerNote }: { cps: TreeCounterparty[]; rateE6: bigint | null; rateEurE6: bigint | null; footerNote: string }) {
  const totalRub = cps.reduce<bigint>((s, c) => s + c.rubEquivMinor, 0n);
  const totalUsd = eqMinor(totalRub, rateE6);
  const totalEur = eqMinor(totalRub, rateEurE6);
  const sorted = [...cps].sort((a, b) => {
    const d = abs(b.rubEquivMinor) - abs(a.rubEquivMinor);
    return d !== 0n ? (d > 0n ? 1 : -1) : a.name.localeCompare(b.name);
  });

  return (
    <div className="rounded-card border border-line bg-card p-4 sm:p-5">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse min-w-[1220px]">
          <colgroup>
            <col className="w-[168px]" />
            <col />
            <col className="w-[184px]" />
            <col className="w-[144px]" />
            <col className="w-[108px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:truncate [&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-line-2 [&>th]:px-3 [&>th]:pb-2.5 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-medium [&>th]:text-ink-3 [&>th+th]:border-l [&>th+th]:border-line [&>th:first-child]:pl-1 [&>th:last-child]:pr-1">
              <th>Код</th>
              <th>Клиент</th>
              <th>Услуга</th>
              <th className="!text-right">Остаток</th>
              <th className="!text-right">$&nbsp;↓</th>
              <th className="!text-right">€</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-ink-3">Клиентов нет.</td></tr>
            ) : (
              sorted.map((cp) => {
                const main = cp.accounts.find((a) => a.kind === 'settlement') ?? cp.accounts[0];
                const code = main ? (main.number.split('-')[1] ?? main.number) : '';
                const b = clientBalances(cp);
                const zero = b.primary.minor === 0n && b.extra === 0;
                return (
                  <tr
                    key={cp.id}
                    className={cn(
                      'transition-colors hover:bg-green-tint/30',
                      '[&>td]:h-[52px] [&>td]:truncate [&>td]:whitespace-nowrap [&>td]:border-t [&>td]:border-line [&>td]:px-3 [&>td]:align-middle',
                      '[&>td+td]:border-l [&>td+td]:border-line/70 [&>td:first-child]:pl-1 [&>td:last-child]:pr-1',
                      zero && 'text-ink-3 [&_*]:!text-ink-3 [&_*]:!font-normal',
                    )}
                  >
                    <td className="tnum text-[12.5px] text-ink-2"><Link href={`/admin/finance/clients/${cp.id}`} className="hover:underline">{code}</Link></td>
                    {/* Имя клиента ЦЕЛИКОМ — не режем многоточием (правка владельца). */}
                    <td className="text-sm font-medium text-ink"><Link href={`/admin/finance/clients/${cp.id}`} className="hover:underline">{cp.name}</Link></td>
                    <td className="text-[12.5px] text-ink-2">{serviceLabel(cp)}</td>
                    <td className="text-right text-sm">
                      <Amount minor={b.primary.minor} currency={b.primary.currency} />
                      {b.extra > 0 ? <span className="ml-1 text-[11.5px] text-ink-3">+{b.extra}&nbsp;вал.</span> : null}
                    </td>
                    <td className="tnum text-right text-[12.5px] text-ink-2">{(() => { const v = eqMinor(cp.rubEquivMinor, rateE6); return v === null ? <span className="text-ink-3">—</span> : <>{twoFmt.format(Number(v) / 100)}<span className="text-ink-3">&nbsp;$</span></>; })()}</td>
                    <td className="tnum text-right text-[12.5px] text-ink-2">{(() => { const v = eqMinor(cp.rubEquivMinor, rateEurE6); return v === null ? <span className="text-ink-3">—</span> : <>{twoFmt.format(Number(v) / 100)}<span className="text-ink-3">&nbsp;€</span></>; })()}</td>
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
          Итого&nbsp;&nbsp;<b className="tnum font-semibold">{totalUsd !== null ? `${twoFmt.format(Number(totalUsd) / 100)} $` : '—'}</b>
          &nbsp;&nbsp;<span className="tnum text-ink-2">{totalEur !== null ? `${twoFmt.format(Number(totalEur) / 100)} €` : '—'}</span>
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2"><SectionAddAction section="loro" /></div>
    </div>
  );
}

const FILTER_RU: Record<LoroFilter, string> = { all: 'все', exchange: 'обмен', merchant: 'эквайринг', agent: 'агенты' };

export function AccountsList({
  tree,
  section,
  filter = 'all',
  view = 'accounts',
  q = '',
  sort,
  dir = 'asc',
}: {
  tree: FinanceTree;
  section: 'loro' | 'nostro' | 'capital';
  filter?: LoroFilter;
  view?: LoroView;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
}) {
  const searchNote = q.trim() ? ` · поиск: «${q.trim()}»` : '';
  const g = tree.groups.find((x) => x.key === section);
  const { rateE6, rateEurE6 } = tree;

  if (section === 'loro') {
    let cps = g?.counterparties ?? [];
    // (С8-1) Фильтр по РОЛИ-СЧЁТУ, не по ownerKind: у связки обмен+эквайринг обе роли.
    const hasRole = (c: TreeCounterparty, prefix: string) => c.accounts.some((a) => a.number.startsWith(prefix));
    if (filter === 'exchange') cps = cps.filter((c) => c.ownerKind === 'counterparty' && hasRole(c, '140'));
    else if (filter === 'merchant') cps = cps.filter((c) => hasRole(c, '440'));
    else if (filter === 'agent') cps = cps.filter((c) => c.ownerKind === 'agent');

    if (view === 'clients') {
      const needle = q.trim().toLowerCase();
      const found = needle
        ? cps.filter((c) => c.name.toLowerCase().includes(needle) || c.accounts.some((a) => a.number.toLowerCase().includes(needle)))
        : cps;
      return <ClientsTable cps={found} rateE6={rateE6} rateEurE6={rateEurE6} footerNote={`${found.length} ${plural(found.length, 'клиент', 'клиента', 'клиентов')} · фильтр: ${FILTER_RU[filter]}${searchNote}`} />;
    }

    // Вид «Все счета»: одна строка на счёт, имя клиента — отдельной колонкой.
    const rows: AccountTableRow[] = [];
    for (const cp of cps) {
      for (const { acc, isPoint } of flattenAccounts(cp.accounts)) {
        rows.push({ acc, isPoint, counterpartyName: cp.name, href: `/admin/finance/accounts/${acc.id}` });
      }
    }
    const shown = sortRows(filterRows(rows, q), sort, dir);
    return (
      <AccountsTable
        rows={shown}
        rateE6={rateE6}
        rateEurE6={rateEurE6}
        emptyText={searchNote ? 'Ничего не найдено — измените запрос.' : 'Счетов нет.'}
        footerNote={`${shown.length} ${plural(shown.length, 'счёт', 'счёта', 'счетов')} · ${cps.length} ${plural(cps.length, 'клиент', 'клиента', 'клиентов')} · фильтр: ${FILTER_RU[filter]}${searchNote}`}
        action={<SectionAddAction section="loro" />}
        sortable
      />
    );
  }

  const flat = flattenAccounts(g?.accounts ?? []);
  // 🔴 Правило владельца: три вкладки идентичны — колонка «Контрагент» есть и здесь.
  // Ностро и Капитал — счета платформы, владелец у всех строк один.
  const rows: AccountTableRow[] = flat.map(({ acc, isPoint }) => ({ acc, isPoint, counterpartyName: 'Платформа', href: `/admin/finance/accounts/${acc.id}` }));
  const shown = sortRows(filterRows(rows, q), sort, dir);
  return (
    <AccountsTable
      rows={shown}
      rateE6={rateE6}
      rateEurE6={rateEurE6}
      emptyText={searchNote ? 'Ничего не найдено — измените запрос.' : section === 'capital' ? 'Капитальных счетов нет.' : 'Счетов нет.'}
      footerNote={`${shown.length} ${plural(shown.length, 'счёт', 'счёта', 'счетов')}${searchNote}`}
      action={<SectionAddAction section={section} />}
      sortable
    />
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
