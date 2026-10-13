'use client';

import { createContext, useContext, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Amount } from '@/components/ui/Amount';
import { cn } from '@/lib/cn';
import type { CurrencyFunds, FundBlock, FundsByCurrency } from '@/lib/finance/funds';

// (Волна5 1) Приведение $/€ в панели: конверсия RUB-эквивалента блока к $ (1-й) и € (2-й).
const FundsRatesCtx = createContext<{ rateE6: bigint | null; rateEurE6: bigint | null }>({ rateE6: null, rateEurE6: null });
const convFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Стек «$ · €» из RUB-эквивалента (витрина; в проводки/Σ не входит). «—» без курса. */
/**
 * Приведение строки к $/€. `known=false` — курса валюты нет, и тогда это НЕ ноль, а «неизвестно»:
 * нулём молчаливо соглашались, что валюты в деньгах не существует (так пропадал TRX).
 */
function Conv({ rub, known = true }: { rub: bigint; known?: boolean }) {
  const { rateE6, rateEurE6 } = useContext(FundsRatesCtx);
  if (!known) return <span className="text-ink-3">курса нет</span>;
  const usd = rateE6 ? (rub * 1_000_000n) / rateE6 : null;
  const eur = rateEurE6 ? (rub * 1_000_000n) / rateEurE6 : null;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tnum text-ink-2">{usd === null ? '—' : convFmt.format(Number(usd) / 100)}<span className="text-ink-3">&nbsp;$</span></span>
      <span className="tnum text-[11px] text-ink-3">{eur === null ? '—' : convFmt.format(Number(eur) / 100)}&nbsp;€</span>
    </span>
  );
}

/**
 * «Средства по валютам» — горизонтальный А|П|К-баланс на Обзоре Финансов.
 * Три смысловых блока: АКТИВЫ («Наши») · ПАССИВЫ («Клиентские») · КАПИТАЛ, затем
 * баланс-проверка (Активы + Пассивы ≈ Капитал) последней ячейкой. Раскрытие валюты
 * разворачивает баланс: подстроки счетов в своих колонках (где деньги · кому должны ·
 * чьё это). Значки валют кружком — единственный цветной акцент.
 */

const CUR_BADGE: Record<string, { sym: string; cls: string }> = {
  RUB: { sym: '₽', cls: 'bg-green text-white' },
  USD: { sym: '$', cls: 'bg-[hsl(233_72%_61%)] text-white' },
};
function CurrencyBadge({ currency }: { currency: string }) {
  const b = CUR_BADGE[currency] ?? { sym: currency[0] ?? '?', cls: 'bg-ink-3 text-white' };
  return <span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', b.cls)} aria-hidden>{b.sym}</span>;
}
function placesLabel(n: number): string {
  const d = n % 10, dd = n % 100;
  const w = d === 1 && dd !== 11 ? 'счёт' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'счёта' : 'счетов';
  return `${n} ${w}`;
}

const NATIVE = 'w-32 shrink-0 whitespace-nowrap border-l border-line/60 px-3 text-right tnum text-sm';
const CONV = 'w-32 shrink-0 whitespace-nowrap px-2 text-right text-sm text-ink-3';
const CHECK = 'w-28 shrink-0 whitespace-nowrap border-l border-line/60 px-3 text-right tnum text-sm';
const DASH = <span className="text-ink-3">—</span>;

/** Ячейки блоков: Активы · Пассивы · Капитал (native жирнее, ≈₽ тише) + баланс-проверка. */
function BlockCells({ r }: { r: CurrencyFunds }) {
  return (
    <>
      <span className={cn(NATIVE, 'text-ink')}><Amount minor={r.assetMinor} currency={r.currency} /></span>
      <span className={CONV}><Conv rub={r.assetRubMinor} known={r.rateKnown} /></span>
      <span className={cn(NATIVE, 'text-ink')}><Amount minor={r.liabMinor} currency={r.currency} className="font-medium" /></span>
      <span className={CONV}><Conv rub={r.liabRubMinor} known={r.rateKnown} /></span>
      <span className={cn(NATIVE, 'text-ink')}><Amount minor={r.capitalMinor} currency={r.currency} className="font-medium" /></span>
      <span className={CONV}><Conv rub={r.capitalRubMinor} known={r.rateKnown} /></span>
      {/*
        🔴 Проверка — в СВОЕЙ валюте. Рублёвый эквивалент у валюты без курса равен нулю по всем
        трём блокам, и «ноль сходится» горело зелёным при любой реальной дыре.
      */}
      <span className={cn(CHECK, 'font-semibold', r.balanced ? 'text-success' : 'text-danger')}>
        {r.balanced ? '✓' : <Amount minor={r.residualMinor} currency={r.currency} className="font-semibold" />}
      </span>
    </>
  );
}

/** Подстрока раскрытия — один счёт в колонке своего блока, прочие ячейки прочерком. */
function LineRow({ name, block, presented, rub, currency }: { name: string; block: FundBlock; presented: bigint; rub: bigint; currency: string }) {
  const native = <Amount minor={presented} currency={currency} className="font-normal" />;
  const conv = <Conv rub={rub} />;
  return (
    <div className="flex items-center border-t border-line/60 bg-paper/40">
      <span className="w-9 shrink-0" />
      <span className="min-w-0 flex-1 truncate py-2 pl-4 pr-2 text-sm text-ink-2">{name}</span>
      <span className={cn(NATIVE, 'text-ink-2')}>{block === 'asset' ? native : DASH}</span>
      <span className={CONV}>{block === 'asset' ? conv : DASH}</span>
      <span className={cn(NATIVE, 'text-ink-2')}>{block === 'liability' ? native : DASH}</span>
      <span className={CONV}>{block === 'liability' ? conv : DASH}</span>
      <span className={cn(NATIVE, 'text-ink-2')}>{block === 'capital' ? native : DASH}</span>
      <span className={CONV}>{block === 'capital' ? conv : DASH}</span>
      <span className={CHECK} />
    </div>
  );
}

function CurrencyRow({ r }: { r: CurrencyFunds }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center border-t border-line hover:bg-green-tint/30">
        <button type="button" onClick={() => setOpen((v) => !v)} className="shrink-0 pl-3 pr-1 text-ink-3 hover:text-ink disabled:opacity-30" title={open ? 'Свернуть' : 'Раскрыть баланс валюты'} aria-label={open ? 'Свернуть' : 'Раскрыть баланс валюты'} disabled={r.lines.length === 0}>
          <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
        </button>
        <Link href={`/admin/finance/accounts?section=nostro&cur=${r.currency}`} className="flex min-w-0 flex-1 items-center gap-2 py-3 pr-2 text-left" title={`Счета в ${r.currency}`}>
          <CurrencyBadge currency={r.currency} />
          <span className="text-sm font-medium text-ink">{r.currency}</span>
          {r.placesCount > 0 ? <span className="text-xs text-ink-3">· {placesLabel(r.placesCount)}</span> : null}
        </Link>
        <BlockCells r={r} />
      </div>
      {open ? r.lines.map((ln) => <LineRow key={ln.id} name={ln.name} block={ln.block} presented={ln.presentedMinor} rub={ln.rubEquivMinor} currency={r.currency} />) : null}
    </>
  );
}

export function FundsPanel({ funds }: { funds: FundsByCurrency }) {
  const t = funds.totals;
  return (
    <FundsRatesCtx.Provider value={{ rateE6: funds.rateE6, rateEurE6: funds.rateEurE6 }}>
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-ink">Средства по валютам</h2>
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <div className="min-w-[1072px]">
          {/* Тонкая строка блоков — читается как баланс. */}
          <div className="flex items-stretch bg-paper/40 text-[11px] font-medium text-ink-3">
            <span className="w-9 shrink-0" />
            <span className="min-w-0 flex-1" />
            <span className="w-64 shrink-0 border-l border-line/70 px-3 py-1.5">Активы</span>
            <span className="w-64 shrink-0 border-l border-line/70 px-3 py-1.5">Пассивы</span>
            <span className="w-64 shrink-0 border-l border-line/70 px-3 py-1.5">Капитал</span>
            <span className="w-28 shrink-0 border-l border-line/70 px-3 py-1.5 text-right">Баланс</span>
          </div>
          {/* Шапка колонок. */}
          <div className="flex items-center border-t border-line/60 bg-paper/60 text-xs font-medium text-ink-3">
            <span className="w-9 shrink-0" />
            <span className="min-w-0 flex-1 py-2 pr-2">Валюта</span>
            <span className="w-32 shrink-0 border-l border-line/60 px-3 py-2 text-right">Наши</span>
            <span className="w-32 shrink-0 px-2 py-2 text-right">$ · €</span>
            <span className="w-32 shrink-0 border-l border-line/60 px-3 py-2 text-right">Клиентские</span>
            <span className="w-32 shrink-0 px-2 py-2 text-right">$ · €</span>
            <span className="w-32 shrink-0 border-l border-line/60 px-3 py-2 text-right">Капитал</span>
            <span className="w-32 shrink-0 px-2 py-2 text-right">$ · €</span>
            <span className="w-28 shrink-0 border-l border-line/60 px-3 py-2 text-right">А−П−К</span>
          </div>

          {funds.rows.map((r) => <CurrencyRow key={r.currency} r={r} />)}

          {/* ИТОГО — по трём блокам в ₽, прочерки в валютных колонках. */}
          <div className="flex items-center border-t-2 border-line-2 bg-paper/50">
            <span className="w-9 shrink-0" />
            <span className="min-w-0 flex-1 py-3 pr-2 text-sm font-semibold text-ink">ИТОГО в $ · €</span>
            <span className="w-32 shrink-0 border-l border-line/60 px-3 text-right text-sm text-ink-3">—</span>
            <span className="w-32 shrink-0 whitespace-nowrap px-2 py-2 text-right"><Conv rub={t.assetRubMinor} /></span>
            <span className="w-32 shrink-0 border-l border-line/60 px-3 text-right text-sm text-ink-3">—</span>
            <span className="w-32 shrink-0 whitespace-nowrap px-2 py-2 text-right"><Conv rub={t.liabRubMinor} /></span>
            <span className="w-32 shrink-0 border-l border-line/60 px-3 text-right text-sm text-ink-3">—</span>
            <span className="w-32 shrink-0 whitespace-nowrap px-2 py-2 text-right"><Conv rub={t.capitalRubMinor} /></span>
            <span className={cn('w-28 shrink-0 whitespace-nowrap border-l border-line/60 px-3 py-2 text-right tnum text-sm font-semibold', t.balanced ? 'text-success' : 'text-danger')}>
              {/* Итог сходится, когда сходится каждая валюта; рублёвая невязка — справочная. */}
              {t.balanced ? '✓' : 'не сходится'}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        {funds.hasRate && funds.rateE6 !== null
          ? <>Балансовое равенство: Активы ≈ Пассивы + Капитал (столбец «А−П−К» — невязка, ✓ в пределах непроведённой переоценки). Приведение к $ (1-й) и € (2-й) — витрина; €{funds.rateEurE6 === null ? ' появится с рыночным курсом' : ''}. Курс USD/RUB {(Number(funds.rateE6) / 1_000_000).toFixed(4)}{funds.rateDate ? ` от ${funds.rateDate}` : ''}.</>
          : 'Курс не загружен — приведение USD в рубли недоступно.'}
      </p>
    </section>
    </FundsRatesCtx.Provider>
  );
}
