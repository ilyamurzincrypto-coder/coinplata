/**
 * Единый источник имён счетов (ревизия Кирилла): имя счёта = НАЗНАЧЕНИЕ, форма —
 * тихий суффикс, не имя. После реклассификации многие счета остались с именем-формой
 * («безналичные») → счета одного владельца читались как дубли. Эта функция задаёт
 * осмысленное имя по (ownerType, kind, form); используется и в дереве/выписках, и в
 * бэкфилле имён. Пользовательские осмысленные имена (точки, «Касса Анталия») НЕ трогаем.
 */

/**
 * (Волна Д2) ЕДИНЫЙ человеческий язык вида счёта (account.kind) — один канон на дерево, выписку,
 * карточки и фолбэки. Убирает сырые «settlement/fee_income/position» из UI. Где известен владелец —
 * используем accountPurposeName (роль по владельцу); где только kind — этот словарь.
 */
/**
 * 🔴 Холд (445) называется УДЕРЖАНИЕМ, а не «В пути».
 *
 * «В пути» означает «деньги едут» — именно это слово владелец вычистил из QR-тракта вместе с
 * одноимённым счётом. На 445 деньги никуда не едут: они зарезервированы у нас и ждут исполнения
 * выплаты. Проверено по коду: сегодня на `kind='hold'` пишут ТОЛЬКО выплатные тракты
 * (`payout-request-core`, `payout-currency-core`, рублёвый `resolveMerchantAccounts`), а QR лишь
 * читает исторические остатки, которые тоже являются удержанными деньгами, — так что новое имя
 * честно и для них.
 */
/**
 * 🔴 447 называется «Требование к провайдеру», а не «к банку-эквайеру».
 *
 * Имя осталось от модели эквайринга T+1, где на 447 висел долг банка. Сегодня 447 — это долг
 * ПРОВАЙДЕРА приёма по QR: клиент платит по QR провайдеру напрямую, рубли до нас не доходят, а
 * рассчитывается он тезером на следующий день. «Банк-эквайер» в этой роли не участвует вовсе, и
 * старое имя отправляло бы читателя выписки не туда. Счетов 447 на боевой ноль (проверено
 * запросом), поэтому переименование ничего не переписывает — меняется только то, как назовётся
 * счёт при открытии.
 */
const ACCOUNT_KIND_RU: Record<string, string> = {
  settlement: 'Расчётный счёт',
  hold: 'Удержано (ожидает выплаты)',
  reserve: 'Резерв',
  payable: 'Требование к провайдеру',
  fee_income: 'Доход платформы',
  exchange_income: 'Доход от обмена',
  nostro: 'Ностро (счёт в банке)',
  cash_desk: 'Касса',
  position: 'Валютная позиция',
  countervalue: 'Контрвалюта позиции',
  reval_pnl: 'Курсовая переоценка',
  bank_fees: 'Затраты банка/НСПК',
  network_fees: 'Затраты сети (газ)',
};
export function accountKindLabel(kind: string): string {
  return ACCOUNT_KIND_RU[kind] ?? kind;
}

/** Имя-заглушка: пусто или голая форма — такое имя перекрываем назначением. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  if (name == null) return true;
  const t = name.trim().toLowerCase();
  return t === '' || t === 'безналичные' || t === 'наличные';
}

const PLATFORM: Record<string, string> = {
  cash_desk: 'Касса',
  nostro: 'Интейк СБП (банк-эквайер)',
  payable: 'Требование к провайдеру',
  position: 'Валютная позиция',
  countervalue: 'Контрвалюта позиции',
  fee_income: 'Доход платформы',
  exchange_income: 'Доход от обмена',
  reval_pnl: 'Курсовая переоценка',
  bank_fees: 'Затраты банка/НСПК',
  network_fees: 'Затраты сети (газ)',
};
const MERCHANT: Record<string, string> = {
  settlement: 'К выплате',
  hold: 'Удержано (ожидает выплаты)',
  reserve: 'Резерв (rolling reserve)',
  payable: 'Интейк эквайринга',
  fee_income: 'Комиссионный доход',
};
const AGENT: Record<string, string> = {
  settlement: 'Расчётный счёт агента',
  hold: 'Удержано',
  reserve: 'Резерв',
  fee_income: 'Комиссионный доход агента',
};

/**
 * Осмысленное имя по назначению счёта. Валюта — суффикс у settlement (разные валюты
 * одного владельца иначе коллизируют: «К выплате» RUB и USD, «Расчётный счёт» RUB/USD).
 */
export function accountPurposeName(ownerType: string, kind: string, form?: string | null, currency?: string | null): string {
  const cur = currency ? ` ${currency}` : '';
  // Форма явно в имени клиентского расчётного счёта: «нал»/«безнал» (правка эксперта).
  const f = form === 'cash' ? ' нал' : form === 'cashless' ? ' безнал' : '';
  if (ownerType === 'platform') return PLATFORM[kind] ?? kind;
  if (ownerType === 'merchant') return kind === 'settlement' ? `К выплате${cur}` : (MERCHANT[kind] ?? kind);
  if (ownerType === 'agent') return kind === 'settlement' ? `Расчётный счёт агента${cur}` : (AGENT[kind] ?? kind);
  // counterparty (обменный клиент)
  if (kind === 'settlement') return `Расчётный счёт${cur}${f}`;
  if (kind === 'hold') return 'Удержано';
  if (kind === 'reserve') return 'Резерв';
  return 'Счёт';
}

/**
 * (Пакет №1, п.4) Имя счёта ДЛЯ РЯДА С ЧИПАМИ валюты/формы: убираем валюту/форму из имени,
 * чтобы не дублировать отдельные чипы («Расчётный счёт RUB безнал» + чипы RUB·безнал → каша).
 * Правило одно на клиент/мерчант/дерево: имя = роль, валюта+форма — отдельными чипами.
 * Пользовательские имена без валюты/формы («Касса Анталия») остаются как есть.
 */
export function accountRoleLabel(name: string | null | undefined, currency?: string | null): string {
  let s = (name ?? '').trim();
  if (!s) return currency ?? '';
  // Хвосты «форма» и «валюта» могут идти в любом порядке и через разделитель
  // («Валютная позиция · безнал · RUB»), поэтому срезаем по кругу, пока строка меняется.
  const curRe = currency ? new RegExp('[\\s·]*' + currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') : null;
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/[\s·]+(нал|безнал)$/i, ''); // хвостовая форма
    if (curRe) s = s.replace(curRe, '');
    s = s.replace(/[\s·]+$/, ''); // висящий разделитель после среза
  }
  return s.trim() || (currency ?? '');
}

/** Итоговое отображаемое имя: осмысленное пользовательское — как есть; иначе — назначение. */
export function resolveAccountName(a: {
  ownerType: string;
  kind: string;
  form?: string | null;
  currency?: string | null;
  name?: string | null;
}): string {
  return isPlaceholderName(a.name) ? accountPurposeName(a.ownerType, a.kind, a.form, a.currency) : a.name!.trim();
}
