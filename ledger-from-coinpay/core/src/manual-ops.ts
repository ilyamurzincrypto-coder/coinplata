/**
 * Шаблоны проводок ручных операций обменно-кассового контура (F2b).
 * Человек выбирает ТИП операции — проводки генерятся здесь (дебет/кредит руками
 * не пишут). Знаковая модель (positive=credit, Σ по валюте=0):
 *  • клиентский счёт (обязательство): positive = мы должны клиенту (его остаток),
 *    negative = дебиторка. Внесение → клиенту +, выдача → клиенту −.
 *  • касса/ностро/позиция (активы): противоположный знак, чтобы Σ=0; «наличие»
 *    на кассе презентуется с флипом знака (см. presentBalanceMinor).
 * Обмен: клиентские ноги ↔ позиционные счета по каждой валюте, спред — в позиции.
 */

import type { Minor } from './money';
import { assertBalanced, type EntryDraft, type TxDraft } from './ledger';
import { quoteExchange, type ExchangeDirection, type RoundingMode } from './exchange';
import { defaultMinorUnits } from './currencies';

/**
 * 🔴 Флипуются ТОЛЬКО активы. Позиция и контрвалюта — капитал, они показываются сырым знаком.
 *
 * Здесь `position` и `countervalue` тоже стояли в списке контра-счетов, и это давало ВТОРОЕ,
 * противоположное правило подачи для тех же счетов: дерево, ОСВ и выписка (`ledgerRole`)
 * печатают капитал сырым знаком, а эта функция — перевёрнутым. Обе живут в одном объекте на
 * Обзоре Финансов: `positionsByCurrency` приходит сырой, `positionUsdMinor` — через эту функцию.
 * Одна и та же валютная позиция на одном экране с двумя разными знаками.
 *
 * Какой знак верен, задаёт не вкус, а тождество: в обмене клиент отдаёт 100 ₽ → его долг вниз,
 * позиция `raw +100`. Значит **плюс на позиции = длинная позиция по валюте**, и показывать это
 * минусом нельзя.
 */
const CONTRA_KINDS = new Set(['cash_desk', 'nostro']);

/** Остаток счёта «как читает человек»: активы — с флипом знака, капитал — сырым. */
export function presentBalanceMinor(kind: string, rawSumMinor: Minor): Minor {
  return CONTRA_KINDS.has(kind) ? -rawSumMinor : rawSumMinor;
}

function tx(kind: TxDraft['kind'], entries: EntryDraft[], idempotencyKey?: string): TxDraft {
  assertBalanced(entries);
  const t: TxDraft = { kind, entries };
  if (idempotencyKey !== undefined) t.idempotencyKey = idempotencyKey;
  return t;
}

export interface DepositParams {
  amount: Minor;
  currency: string;
  clientAccount: string;
  cashDesk: string;
  idempotencyKey?: string;
}
/** Внесение: внешний мир → счёт клиента через кассу. Клиент +amount, касса −amount. */
export function buildDepositTx(p: DepositParams): TxDraft {
  if (p.amount <= 0n) throw new Error('buildDepositTx: сумма > 0');
  return tx('deposit', [
    { accountId: p.clientAccount, amountMinor: p.amount, currency: p.currency },
    { accountId: p.cashDesk, amountMinor: -p.amount, currency: p.currency },
  ], p.idempotencyKey);
}

export interface WithdrawalParams {
  amount: Minor;
  currency: string;
  clientAccount: string;
  cashDesk: string;
  idempotencyKey?: string;
}
/** Выдача: счёт клиента → касса наружу. Клиент −amount (может уйти в минус), касса +amount. */
export function buildWithdrawalTx(p: WithdrawalParams): TxDraft {
  if (p.amount <= 0n) throw new Error('buildWithdrawalTx: сумма > 0');
  return tx('withdrawal', [
    { accountId: p.clientAccount, amountMinor: -p.amount, currency: p.currency },
    { accountId: p.cashDesk, amountMinor: p.amount, currency: p.currency },
  ], p.idempotencyKey);
}

export interface TransferClientParams {
  amount: Minor;
  currency: string;
  fromClient: string;
  toClient: string;
  idempotencyKey?: string;
}
/** Перевод между клиентами (одна валюта). from −amount, to +amount. */
export function buildTransferClientTx(p: TransferClientParams): TxDraft {
  if (p.amount <= 0n) throw new Error('buildTransferClientTx: сумма > 0');
  if (p.fromClient === p.toClient) throw new Error('buildTransferClientTx: счета совпадают');
  return tx('transfer', [
    { accountId: p.fromClient, amountMinor: -p.amount, currency: p.currency },
    { accountId: p.toClient, amountMinor: p.amount, currency: p.currency },
  ], p.idempotencyKey);
}

export interface TransferCashParams {
  amount: Minor;
  currency: string;
  fromCash: string;
  toCash: string;
  idempotencyKey?: string;
}
/** Перевод между кассами. Наличие уходит из fromCash в toCash (raw-знаки зеркальны флипу). */
export function buildTransferCashTx(p: TransferCashParams): TxDraft {
  if (p.amount <= 0n) throw new Error('buildTransferCashTx: сумма > 0');
  if (p.fromCash === p.toCash) throw new Error('buildTransferCashTx: кассы совпадают');
  return tx('transfer', [
    { accountId: p.fromCash, amountMinor: p.amount, currency: p.currency }, // наличие из fromCash убыло
    { accountId: p.toCash, amountMinor: -p.amount, currency: p.currency }, // на toCash прибыло
  ], p.idempotencyKey);
}

export interface InternalTransferParams {
  amount: Minor;
  currency: string;
  fromAccount: string;
  toAccount: string;
  idempotencyKey?: string;
}
/**
 * (Д3а) Перевод между своими платформенными счетами ОДНОЙ валюты (ностро↔ностро, касса→ностро — любые
 * активы CONTRA_KINDS). Обе ноги — активы (флип знака), поэтому наличие уходит из fromAccount (raw +amount →
 * presented −amount) и приходит на toAccount (raw −amount → presented +amount). Σ по валюте = 0.
 * Валюту/активность счетов проверяет вызывающий слой (экшен); ядро — только знаки и Σ=0.
 */
export function buildInternalTransferTx(p: InternalTransferParams): TxDraft {
  if (p.amount <= 0n) throw new Error('buildInternalTransferTx: сумма > 0');
  if (p.fromAccount === p.toAccount) throw new Error('buildInternalTransferTx: счета совпадают');
  return tx('transfer', [
    { accountId: p.fromAccount, amountMinor: p.amount, currency: p.currency }, // источник: наличие убыло
    { accountId: p.toAccount, amountMinor: -p.amount, currency: p.currency }, // получатель: наличие прибыло
  ], p.idempotencyKey);
}

export interface FormConversionParams {
  amount: Minor;
  currency: string;
  /** incassation — нал→безнал (сдать наличные в банк); reinforcement — безнал→нал (снять в кассу). */
  direction: 'incassation' | 'reinforcement';
  cashDesk: string; // касса (нал, cash_desk)
  nostro: string; // банк/ностро (безнал)
  cashPosition: string; // позиция валюты · нал
  cashlessPosition: string; // позиция валюты · безнал
  idempotencyKey?: string;
}
/**
 * Конверсия ФОРМЫ (нал↔безнал одной валюты) — 4 ноги: физические (касса/ностро) + позиционная
 * пара. Курс 1:1, доход НЕ считается. Валютная экспозиция валюты не меняется (сумма пары), меняется
 * её РАСКЛАД по формам.
 *
 * 🔴 ПОЗИЦИОННАЯ ПАРА БЫЛА ПЕРЕВЁРНУТА. Знаки стояли по старой контра-конвенции, где позиция
 * печаталась флипом; живые экраны (дерево, ОСВ, выписка) печатают капитал сырым знаком, и на них
 * инкассация читалась наоборот: сдали наличные в банк — «наличная экспозиция выросла», а
 * «безналичная ушла в минус».
 *
 * Знак выводится из тождества, а не из вкуса: в обмене клиент отдаёт 100 ₽ → его долг вниз,
 * позиция `raw +100`, то есть ПЛЮС = длинная позиция. Сквозной пример, который ловит ошибку:
 * клиент внёс 100 ₽ налом и обменял → позиция RUB·нал = +100 (честно, деньги в кассе). Инкассация
 * 100 ₽ → по-старому позиция RUB·нал становилась +200 при ПУСТОЙ кассе, а RUB·безнал −100 при
 * 100 ₽ на ностро. Ошибка на 2×X за операцию, накопительно.
 *
 * Правильно: наличие кассы −X → нал-экспозиция −X; наличие ностро +X → безнал-экспозиция +X.
 * Σ=0 сохраняется в обоих вариантах — обе пары замыкаются сами, поэтому ни триггер, ни тождество
 * этого не ловили.
 */
export function buildFormConversionTx(p: FormConversionParams): TxDraft {
  if (p.amount <= 0n) throw new Error('buildFormConversionTx: сумма > 0');
  const s = p.direction === 'incassation' ? 1n : -1n;
  const X = p.amount;
  return tx(p.direction, [
    { accountId: p.cashDesk, amountMinor: s * X, currency: p.currency }, // наличие кассы −X·s
    { accountId: p.nostro, amountMinor: -s * X, currency: p.currency }, // наличие ностро +X·s
    { accountId: p.cashPosition, amountMinor: -s * X, currency: p.currency }, // нал-экспозиция −X·s
    { accountId: p.cashlessPosition, amountMinor: s * X, currency: p.currency }, // безнал-экспозиция +X·s
  ], p.idempotencyKey);
}

export interface ExchangeAccounts {
  /** Клиентские счета в валютах from/to. */
  clientFrom: string;
  clientTo: string;
  /** Позиционные счета платформы в валютах from/to. */
  positionFrom: string;
  positionTo: string;
}
export interface BuildExchangeParams {
  baseE6: bigint;
  markupBp: number;
  direction: ExchangeDirection;
  amountMinor: Minor;
  amountSide: 'from' | 'to';
  rounding: RoundingMode;
  accounts: ExchangeAccounts;
  /** Валюта не-рублёвой ноги (дефолт USD). RUB — пивот; baseE6/dealE6 = RUB за 1 foreign. */
  foreignCurrency?: string;
  /** Знаков у не-рублёвой ноги (`currencies.minor_units`) — участвует в расчёте суммы. */
  foreignMinorUnits?: number;
  /** Волна 4: договорной курс сделки — прямой курс вместо база×наценка. */
  dealE6Override?: bigint;
  idempotencyKey?: string;
}
export interface BuildExchangeResult {
  tx: TxDraft;
  fromMinor: Minor;
  toMinor: Minor;
  dealE6: bigint;
  /** Доход сделки в RUB: |fromRUB по сделке − fromRUB по базовому курсу|. */
  incomeMinorRub: Minor;
}

/**
 * Обмен: клиент отдаёт валюту from, получает to. Две валютные ноги балансируются
 * в ноль независимо через позиционные счета; спред оседает в позиции. Доход
 * (income) считается в RUB как разница стоимости USD-ноги по курсу сделки и по базовому.
 */
export function buildExchangeTx(p: BuildExchangeParams): BuildExchangeResult {
  const q = quoteExchange({
    baseE6: p.baseE6,
    markupBp: p.markupBp,
    direction: p.direction,
    amountMinor: p.amountMinor,
    amountSide: p.amountSide,
    rounding: p.rounding,
    foreignCurrency: p.foreignCurrency,
    foreignMinorUnits: p.foreignMinorUnits,
    dealE6Override: p.dealE6Override,
  });
  const { accounts } = p;
  const entries: EntryDraft[] = [
    // Нога from (клиент отдаёт → позиция получает).
    { accountId: accounts.clientFrom, amountMinor: -q.fromMinor, currency: q.fromCurrency },
    { accountId: accounts.positionFrom, amountMinor: q.fromMinor, currency: q.fromCurrency },
    // Нога to (позиция отдаёт → клиент получает).
    { accountId: accounts.positionTo, amountMinor: -q.toMinor, currency: q.toCurrency },
    { accountId: accounts.clientTo, amountMinor: q.toMinor, currency: q.toCurrency },
  ];
  /**
   * Доход: не-рублёвая (foreign) нога, оценённая по (курс сделки − базовый), в RUB.
   *
   * 🔴 Масштаб foreign-ноги обязателен и здесь. `foreignMinor × spread / 1e6` верно только
   * когда у foreign два знака, как у рубля; у тезера их четыре, и доход обмена выходил бы в сто
   * раз больше самой сделки. Приводим: foreign → мажоры (÷10^знаков) → рубли (×100).
   */
  const foreignMinor = q.fromCurrency === 'RUB' ? q.toMinor : q.fromMinor;
  const foreignCode = q.fromCurrency === 'RUB' ? q.toCurrency : q.fromCurrency;
  const fScale = 10n ** BigInt(p.foreignMinorUnits ?? defaultMinorUnits(foreignCode));
  /**
   * 🔴 Знак спреда СОХРАНЯЕТСЯ. Прежде здесь стоял модуль, и это было незаметно ровно до
   * договорного курса: при наценке спред всегда в нашу пользу, а курс, введённый оператором
   * руками, легко оказывается хуже базового. Модуль печатал такой УБЫТОК доходом — счёт
   * «Доход от обмена» рос на сделке, которая нас обеднила.
   *
   * В нашу пользу спред считается по-разному в две стороны: клиент покупает валюту — зарабатываем
   * на том, что курс сделки ВЫШЕ базового; клиент продаёт — на том, что он НИЖЕ.
   */
  const spreadE6 = p.direction === 'buy_usd' ? q.dealE6 - p.baseE6 : p.baseE6 - q.dealE6;
  const incomeMinorRub = (foreignMinor * spreadE6 * 100n) / (1_000_000n * fScale);
  return { tx: tx('exchange', entries, p.idempotencyKey), fromMinor: q.fromMinor, toMinor: q.toMinor, dealE6: q.dealE6, incomeMinorRub };
}

export interface StornoEntry {
  accountId: string;
  amountMinor: Minor;
  currency?: string;
}
/**
 * Сторно: зеркало исходной операции (все проводки с обратным знаком). Удаление
 * запрещено — только компенсирующая tx. kind='storno', связь reversal_of_tx_id.
 */
export function buildStornoTx(originalEntries: StornoEntry[], idempotencyKey?: string): TxDraft {
  if (originalEntries.length === 0) throw new Error('buildStornoTx: нет проводок для сторно');
  const entries: EntryDraft[] = originalEntries.map((e) => ({
    accountId: e.accountId,
    amountMinor: -e.amountMinor,
    ...(e.currency ? { currency: e.currency } : {}),
  }));
  return tx('storno', entries, idempotencyKey);
}
