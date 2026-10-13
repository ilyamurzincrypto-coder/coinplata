/**
 * ВЫПЛАТА С ВАЛЮТНОГО СЧЁТА МЕРЧАНТА — чистые проводки, без базы и без курса.
 *
 * 🔴 Курса здесь нет ВООБЩЕ, и это главное отличие от `payout-conversion`. Там мерчант отдаёт
 * рубли и получает валюту по нашему курсу — значит есть спред и доход обмена. Здесь деньги уже
 * лежат в той валюте, которую мерчант получит: обмен состоялся раньше (при зачислении), и
 * применить курс второй раз значило бы взять спред дважды с одних и тех же денег.
 *
 * Форма тракта — ровно та же, что у рублёвой выплаты (A6): удержание → выдача, а при провале
 * разворот удержания. Отличается только то, ЧЕМ платим:
 *   удержание: 440-<валюта> −A  ·  445-<валюта> +A      («ожидает выплаты» того же мерчанта)
 *   выдача:    445-<валюта> −A  ·  ностро/касса +A      (+ отдельная нога газа в валюте сети)
 *   разворот:  445-<валюта> −A  ·  440-<валюта> +A      (деньги вернулись мерчанту)
 *
 * Знаки скопированы с работающего тракта заявки (`buildRequestHoldTx`/`buildRequestReleaseTx`),
 * а не выведены заново: обязательство перед мерчантом держит положительный знак, актив-ностро
 * уходит в плюс, когда деньги с него ушли.
 */

import type { Minor } from './money';
import { sumEntriesByCurrency } from './payout-conversion';

export interface CurrencyEntry {
  accountId: string;
  amountMinor: Minor;
  currency: string;
}

export interface CurrencyPayoutTx {
  entries: CurrencyEntry[];
}

/**
 * Единственная арифметика этого файла: перенос суммы между двумя счетами ОДНОЙ валюты.
 *
 * Все три шага тракта — это он с разными счетами, поэтому проверка «сумма положительна» и
 * инвариант Σ=0 по валюте написаны один раз. Три отдельные пары строк рано или поздно разошлись
 * бы знаками — ровно так уже выходило с комиссией и с курсом.
 */
function move(amountMinor: Minor, currency: string, fromAccountId: string, toAccountId: string, step: string): CurrencyPayoutTx {
  if (amountMinor <= 0n) throw new Error(`${step}: сумма должна быть положительной, получено ${amountMinor}`);
  if (fromAccountId === toAccountId) throw new Error(`${step}: счёт списания и счёт зачисления совпадают`);
  const entries: CurrencyEntry[] = [
    { accountId: fromAccountId, amountMinor: -amountMinor, currency },
    { accountId: toAccountId, amountMinor, currency },
  ];
  assertBalancedByCurrency(entries, step);
  return { entries };
}

/** Σ=0 ПО КАЖДОЙ ВАЛЮТЕ — общая проверка для проводок, где валют больше одной (выдача + газ). */
export function assertBalancedByCurrency(entries: CurrencyEntry[], step = 'проводка'): void {
  for (const [currency, sum] of Object.entries(sumEntriesByCurrency(entries))) {
    if (sum !== 0n) throw new Error(`${step}: Σ по ${currency} ≠ 0 (получено ${sum})`);
  }
}

/** Шаг 1 — удержание: расчётный счёт мерчанта в валюте → его же «ожидает выплаты». */
export function buildCurrencyPayoutHoldTx(p: {
  amountMinor: Minor;
  currency: string;
  accounts: { merchantSettlement: string; merchantHold: string };
}): CurrencyPayoutTx {
  return move(p.amountMinor, p.currency, p.accounts.merchantSettlement, p.accounts.merchantHold, 'Удержание валютной выплаты');
}

/**
 * Шаг 2 — выдача: «ожидает выплаты» → наш ностро/касса той же валюты.
 * Газ сюда НЕ подмешивается: он живёт в валюте сети и приезжает отдельной парой ног, поэтому
 * сумма мерчанта не меняется ни на минорную единицу (правило владельца — сеть платит платформа).
 */
export function buildCurrencyPayoutReleaseTx(p: {
  amountMinor: Minor;
  currency: string;
  accounts: { merchantHold: string; source: string };
}): CurrencyPayoutTx {
  return move(p.amountMinor, p.currency, p.accounts.merchantHold, p.accounts.source, 'Выдача валютной выплаты');
}

/**
 * Разворот удержания (провайдер не принял выплату): «ожидает выплаты» → расчётный счёт.
 * Деньги возвращаются мерчанту той же суммой — ни курса, ни удержаний по дороге.
 */
export function buildCurrencyPayoutReversalTx(p: {
  amountMinor: Minor;
  currency: string;
  accounts: { merchantSettlement: string; merchantHold: string };
}): CurrencyPayoutTx {
  return move(p.amountMinor, p.currency, p.accounts.merchantHold, p.accounts.merchantSettlement, 'Разворот валютной выплаты');
}
