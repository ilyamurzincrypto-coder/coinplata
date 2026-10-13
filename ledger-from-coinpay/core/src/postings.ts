/**
 * Банковское представление проводок (F2d): любую сбалансированную транзакцию
 * (Σ по валюте = 0) раскладываем в строки «Дт счёт — Кт счёт — сумма».
 *
 * Знаковая модель леджера: amount > 0 — кредитовая нога (Кт), amount < 0 —
 * дебетовая (Дт). Для составных проводок (несколько ног одной валюты) применяем
 * потоковую декомпозицию: жадно спариваем дебеты с кредитами → минимальный набор
 * строк, суммы которых сходятся к исходным (как в 1С: документ → набор проводок).
 */

import type { Minor } from './money';

export interface PostingAccountRef {
  accountId: string;
  number: string;
  /** Владелец счёта («Платформа», имя мерчанта/контрагента). */
  ownerLabel: string;
  /** Явное имя счёта (касса «Анталия», точка) — опционально. */
  title?: string | null;
}

export interface PostingEntryInput {
  ref: PostingAccountRef;
  amountMinor: Minor;
  currency: string;
}

export interface PostingRow {
  debit: PostingAccountRef;
  credit: PostingAccountRef;
  amountMinor: Minor; // всегда > 0
  currency: string;
}

/** Раскладка проводок транзакции в строки Дт/Кт. Ноги с нулевой суммой игнорируются. */
export function buildPostingRows(entries: PostingEntryInput[]): PostingRow[] {
  const byCurrency = new Map<string, PostingEntryInput[]>();
  for (const e of entries) {
    if (e.amountMinor === 0n) continue;
    const arr = byCurrency.get(e.currency) ?? [];
    arr.push(e);
    byCurrency.set(e.currency, arr);
  }

  const rows: PostingRow[] = [];
  for (const [currency, es] of byCurrency) {
    // Дебеты (amount<0) и кредиты (amount>0) с остатком к разнесению.
    const debits = es.filter((e) => e.amountMinor < 0n).map((e) => ({ ref: e.ref, rem: -e.amountMinor }));
    const credits = es.filter((e) => e.amountMinor > 0n).map((e) => ({ ref: e.ref, rem: e.amountMinor }));
    let i = 0;
    let j = 0;
    while (i < debits.length && j < credits.length) {
      const m = debits[i]!.rem < credits[j]!.rem ? debits[i]!.rem : credits[j]!.rem;
      rows.push({ debit: debits[i]!.ref, credit: credits[j]!.ref, amountMinor: m, currency });
      debits[i]!.rem -= m;
      credits[j]!.rem -= m;
      if (debits[i]!.rem === 0n) i++;
      if (credits[j]!.rem === 0n) j++;
    }
  }
  return rows;
}
