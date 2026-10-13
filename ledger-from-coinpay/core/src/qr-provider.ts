/**
 * QR-провайдер «Филиал 2»: себестоимость — курс ЦБ + надбавка (3 %), расчёт на следующий день в USDT.
 * Проводки (Σ=0 по каждой валюте; актив растёт — минус, обязательство растёт — плюс):
 *  • фиксация кассиром (`qr_hold`): требование к провайдеру (RUB-ностро) −A ·
 *    РАСЧЁТНЫЙ счёт мерчанта 440-RUB +A.
 *
 *    🔴 Счёта «В пути» (445) в тракте QR НЕТ. Прежде фиксация клала долг перед мерчантом на 445, и
 *    владелец искал рубли там, где их нет: на расчётном счёте пусто, а деньги — на отдельном счёте,
 *    который заводится на каждого мерчанта и каждую валюту. Долг перед мерчантом один, и лежит он
 *    на расчётном счёте.
 *
 *    Рубли при этом физически ещё у провайдера, поэтому заказать по ним выплату нельзя: их
 *    вычитает `availableToPayout` — ЕДИНСТВЕННОЕ место, где считается «доступно к выплате».
 *
 *  • расчёт — ДВЕ транзакции одного момента, потому что это два разных события:
 *      1. ЗАЧИСЛЕНИЕ (`qr_settlement`): провайдер закрыл требование тезерами.
 *         RUB: требование +A · позиция ₽ −A; USDT: кошелёк −U · позиция ₮ +U.
 *         Счетов мерчанта здесь больше нет вовсе: его рубли встали на место ещё при фиксации.
 *      2. ОБМЕН (`exchange`): мерчант меняет свои рубли на тезер по НАШЕМУ курсу.
 *         RUB: 440-RUB −A · позиция ₽ +A — ВСЯ сумма, рубли конвертируются целиком;
 *         USDT: позиция ₮ −M · 440-USDT мерчанта +M — ровно то, что обещала касса.
 *
 * 🔴 ЗАРАБОТОК ОСТАЁТСЯ НА ВАЛЮТНОЙ ПОЗИЦИИ ₮, отдельного счёта дохода у него НЕТ. Модель
 * владельца дословно: «на капитале на валютной позиции должна была совершиться операция, потом
 * отправиться на лоро и всё. Остаток на капитале». То есть на позицию ₮ пришёл весь тезер
 * провайдера (U), с неё ушла доля мерчанта (M), разница s = U−M просто лежит там же — это и есть
 * остаток капитала.
 *
 * Итог по оплате: позиция ₽ = −A+A = 0 (рубли конвертированы ЦЕЛИКОМ — прежде позиция ₽ навсегда
 * оставалась в минусе на нашу маржу, в боевой оплате −631,92 ₽, и владелец читал это как «рубли
 * конвертированы не все»), позиция ₮ = +U−M = s. Тезер-ностро отдал U = M (долг мерчанту) + s (наш
 * капитал) — баланс сходится без единого служебного счёта.
 *
 * 🔴 Курс ЦБ в обмене больше НЕ участвует. Он был нужен только чтобы оценить спред в рублях; теперь
 * спред берётся как есть, в валюте, в которой получен, и округлять нечего — ни одна копейка не
 * теряется на пересчёте.
 *
 * 🔴 Почему расчёт — две проводки, а не одна. Превращение рублей в тезер обязано читаться обменом:
 * прежде операций `exchange` в леджере не было вовсе, и витрина «Доход обмена» показывала 0,00 ₽
 * при непустом счёте 374. Теперь история читается целиком: пришли рубли (фиксация) → обменяли →
 * отдали тезер.
 *
 * 🔴 Ноги «затрат банка/НСПК» (372) у этого рельса НЕТ и быть не может: у «Филиала 2» нет ни
 * банка-эквайера, ни НСПК. Прежде на 372 списывалось c = A − U×ЦБ, а в доход кредитовалось
 * c + спред — то есть доход раздувался ровно на выдуманную затрату, и они гасили друг друга. Теперь
 * второй ноги не существует: 372 на QR-рельсе пуст по построению, а не по договорённости.
 *
 * s = `qrSpreadUsdtMinor` = U−M — тезер, оставшийся нам. Это наш заработок на оплате, и он
 * измеряется в тезере. Проводкой он не становится: он и так лежит на позиции ₮ как её остаток.
 * Для экранов s отдаётся СПРАВОЧНЫМ числом (`incomeUsdtMinor`) и пишется в `exchange_details` —
 * «сколько заработали на этой сделке»; «где эти деньги лежат» отвечает остаток позиции ₮.
 *
 * Сколько провайдер забрал на курсе (A − U×ЦБ) — СПРАВОЧНОЕ число для оператора
 * (`qrProviderRateCostRubMinor`), не проводка: этих денег мы никому не платили отдельно, они уже
 * внутри курса, по которому купили тезер.
 *
 *  • отклонение (`storno`): зеркало фиксации.
 */
import { ceilDivBig, floorDivBig } from './fx';

export const QR_USDT = 'USDT-TRC20';
/**
 * Потолок одной QR-оплаты — 1 000 000 ₽. Живёт в ядре, потому что его обязаны знать ОБА конца:
 * сервер (отказывает) и касса (не обещает кассиру сумму, которую сервер не примет). Раньше он был
 * только серверным, и касса в режиме тезера упиралась в свой потолок «миллион ₮» — то есть
 * называла предел, которого у неё нет: миллион тезеров это ~85 000 000 ₽, и сервер такую оплату
 * отбивает.
 */
export const QR_MAX_RUB_MINOR = 100_000_000n;
const USDT_UNITS = 4;
const RUB_UNITS = 2;
const E6 = 1_000_000n;
const UNIT_SCALE = 10n ** BigInt(USDT_UNITS - RUB_UNITS); // 100

export interface QrEntry { accountId: string; amountMinor: bigint; currency: string }

export function providerRateE6(cbRubPerUsdE6: bigint, markupBp: number): bigint {
  if (cbRubPerUsdE6 <= 0n || !Number.isInteger(markupBp) || markupBp < 0) throw new Error('providerRateE6: курс > 0, надбавка — целые bp ≥ 0');
  return ceilDivBig(cbRubPerUsdE6 * BigInt(10_000 + markupBp), 10_000n);
}

export function merchantUsdtRateE6(providerRate: bigint, priceBp: number): bigint {
  if (providerRate <= 0n || !Number.isInteger(priceBp) || priceBp < 0) throw new Error('merchantUsdtRateE6: курс > 0, тариф — целые bp ≥ 0');
  return ceilDivBig(providerRate * BigInt(10_000 + priceBp), 10_000n);
}

/** Рубли → USDT (4 знака) по курсу «₽ за 1 USDT». Вниз. */
export function rubToUsdtMinor(rubMinor: bigint, rubPerUsdtE6: bigint): bigint {
  if (rubPerUsdtE6 <= 0n) throw new Error('rubToUsdtMinor: курс > 0');
  return (rubMinor * UNIT_SCALE * E6) / rubPerUsdtE6;
}

/** USDT (4 знака) → рубли. `ceil` — сумма, которую платит клиент; `floor` — оценка (корректно и для отрицательных). */
export function usdtToRubMinor(usdtMinor: bigint, rubPerUsdtE6: bigint, mode: 'ceil' | 'floor'): bigint {
  const n = usdtMinor * rubPerUsdtE6;
  const d = E6 * UNIT_SCALE;
  return mode === 'ceil' ? ceilDivBig(n, d) : floorDivBig(n, d);
}

/**
 * Фиксация оплаты кассиром: требование к провайдеру открыто, долг перед мерчантом встал на его
 * РАСЧЁТНЫЙ счёт (440-RUB) — туда же, где мерчант ищет свои деньги.
 */
/**
 * 🔴 ФИКСАЦИЯ ОПЛАТЫ ПО QR — требование к провайдеру В ТЕЗЕРЕ, рубли к нам не приходят.
 *
 * Прежде фиксация писала две рублёвые ноги: «ностро приёма» −A и долг мерчанту +A. Книги делали
 * вид, что рубли пришли НАМ и лежат на банковском счёте. На самом деле клиент платит по QR
 * ПРОВАЙДЕРУ, и до нас эти рубли не доходят никогда — провайдер рассчитывается тезером.
 *
 * Что на самом деле возникает в момент приёма:
 *  • провайдер должен нам ТЕЗЕР по курсу, зафиксированному в этот момент (ЦБ + его наценка);
 *  • мы должны мерчанту РУБЛИ по курсу, зафиксированному тогда же.
 * То есть мы одновременно длинные в тезере и короткие в рубле — это настоящая валютная позиция,
 * и до этой правки она была скрыта полностью.
 *
 * Четыре ноги, Σ=0 по КАЖДОЙ валюте отдельно:
 *   требование ₮ −U   ·  позиция ₮ +U      (провайдер должен нам тезер)
 *   К выплате ₽  +A   ·  позиция ₽ −A      (мы должны мерчанту рубли)
 *
 * Сумму тезера считает вызывающий по зафиксированному курсу провайдера — тем же `rubToUsdtMinor`,
 * которым считается всё остальное в тракте.
 */
export function buildQrHoldEntries(p: {
  amountRubMinor: bigint;
  providerUsdtMinor: bigint;
  accounts: { claim: string; merchantSettlement: string; posRub: string; posUsdt: string };
}): QrEntry[] {
  if (p.amountRubMinor <= 0n) throw new Error('buildQrHoldEntries: сумма > 0');
  if (p.providerUsdtMinor <= 0n) throw new Error('buildQrHoldEntries: требование к провайдеру > 0');
  return [
    { accountId: p.accounts.claim, amountMinor: -p.providerUsdtMinor, currency: QR_USDT },
    { accountId: p.accounts.posUsdt, amountMinor: p.providerUsdtMinor, currency: QR_USDT },
    { accountId: p.accounts.merchantSettlement, amountMinor: p.amountRubMinor, currency: 'RUB' },
    { accountId: p.accounts.posRub, amountMinor: -p.amountRubMinor, currency: 'RUB' },
  ];
}

/** Отклонение зафиксированной оплаты — точное зеркало фиксации по тем же счетам. */
export function buildQrDeclineEntries(p: {
  amountRubMinor: bigint;
  providerUsdtMinor: bigint;
  accounts: { claim: string; merchantSettlement: string; posRub: string; posUsdt: string };
}): QrEntry[] {
  return buildQrHoldEntries(p).map((e) => ({ ...e, amountMinor: -e.amountMinor }));
}

export interface QrIntakeAccounts {
  /** Счёт требования к провайдеру В ТЕЗЕРЕ (447), открытый фиксацией. */
  claim: string;
  /** Кошелёк платформы, на который провайдер прислал тезер. */
  usdtWallet: string;
  posRub: string;
  posUsdt: string;
  /**
   * 🔴 Только для ЛЕГАСИ-оплат, зафиксированных до отказа от счёта «В пути»: их рубли лежат на 445,
   * и зачисление переносит их на расчётный счёт. У новых оплат этого нет — долг встал на расчётный
   * сразу, и переносить нечего.
   *
   * Поле обязано существовать, а не «дочиститься потом»: на момент выката такие оплаты уже висят
   * зафиксированными, и без переноса их рубли остались бы на 445 навсегда — ровно тот счёт, который
   * владелец велел из тракта убрать.
   */
  legacyHold?: { merchantHold: string; merchantSettlement: string } | null;
}

/**
 * Транзакция 1 расчёта — ЗАЧИСЛЕНИЕ: требование к провайдеру на A ₽ обменяно на U ₮. Оценок и
 * курсов здесь нет: позиция просто приняла A ₽ и отдала U ₮ — по какому курсу, видно из самой
 * пары ног. Счетов мерчанта в новой форме нет вовсе: его рубли встали при фиксации.
 */
export function buildQrIntakeEntries(p: {
  amountRubMinor: bigint;
  /** Сколько тезера провайдер ДОЛЖЕН был по курсу, зафиксированному при приёме. */
  providerUsdtMinor: bigint;
  /** Сколько тезера пришло ФАКТИЧЕСКИ. */
  usdtReceivedMinor: bigint;
  accounts: QrIntakeAccounts;
}): { entries: QrEntry[] } {
  const { providerUsdtMinor: Uexp, usdtReceivedMinor: U, accounts: a } = p;
  if (Uexp <= 0n || U <= 0n) throw new Error('buildQrIntakeEntries: суммы > 0');
  /**
   * 🔴 Расчёт ГАСИТ ТРЕБОВАНИЕ и показывает РАСХОЖДЕНИЕ с договорённостью.
   *
   * Требование встало при фиксации на Uexp — столько провайдер должен по курсу того дня. Пришло U.
   * Разница (U − Uexp) — переплата или недоплата провайдера против зафиксированного курса, и она
   * ложится на валютную позицию ОТДЕЛЬНОЙ ногой, то есть видна в выписке и в журнале.
   *
   * На боевой операции 18.09 это ровно 226,0000 − 225,0781 = 0,9219 ₮ в нашу пользу. Прежде эта
   * величина растворялась в позиции без следа: расчёт списывал рублёвое требование и зачислял
   * сколько пришло, и сверить «сколько обещали» было не с чем.
   *
   * Рублёвых ног здесь больше нет: рубли к нам не приходили — они ушли провайдеру напрямую.
   */
  const diff = U - Uexp;
  const entries: QrEntry[] = [
    { accountId: a.usdtWallet, amountMinor: -U, currency: QR_USDT },
    { accountId: a.claim, amountMinor: Uexp, currency: QR_USDT },
  ];
  if (diff !== 0n) entries.push({ accountId: a.posUsdt, amountMinor: diff, currency: QR_USDT });
  if (a.legacyHold) {
    const A = p.amountRubMinor;
    entries.push(
      { accountId: a.legacyHold.merchantHold, amountMinor: -A, currency: 'RUB' },
      { accountId: a.legacyHold.merchantSettlement, amountMinor: A, currency: 'RUB' },
    );
  }
  return { entries };
}

/**
 * НАШ СПРЕД по оплате — В ТЕЗЕРЕ: пришло U, мерчанту причитается M, разница наша. Отрицательный
 * (провайдер прислал меньше, чем мы обещали мерчанту) не режется: это убыток, и он обязан быть виден.
 *
 * Единственное определение заработка на QR-оплате: любая витрина обязана спрашивать его здесь.
 * Проводки у него нет — он остаётся на валютной позиции ₮ её остатком.
 *
 * 🔴 Прежде спред считался в рублях — `usdtToRubMinor(U−M, ЦБ, floor)`, — и именно эта рублёвая
 * оценка списывалась с позиции ₽ до обмена. Пересчёта больше нет: величина живёт в той валюте, в
 * которой получена, и округления, на котором расходились «две правды», не существует.
 */
export function qrSpreadUsdtMinor(usdtReceivedMinor: bigint, merchantUsdtMinor: bigint): bigint {
  return usdtReceivedMinor - merchantUsdtMinor;
}

/**
 * СПРАВОЧНО (не проводка): сколько провайдер забрал на курсе — A минус стоимость пришедших тезеров
 * по ЦБ. Оператору полезно видеть это число на борде расчёта, но ноги в леджере у него нет: мы
 * ничего не платили сверх — это цена, по которой купили тезер, а «затраты банка/НСПК» у «Филиала 2»
 * не существуют.
 */
export function qrProviderRateCostRubMinor(amountRubMinor: bigint, usdtReceivedMinor: bigint, cbRubPerUsdE6: bigint): bigint {
  if (cbRubPerUsdE6 <= 0n) throw new Error('qrProviderRateCostRubMinor: курс > 0');
  return amountRubMinor - usdtToRubMinor(usdtReceivedMinor, cbRubPerUsdE6, 'floor');
}

/**
 * Счета обмена. Счёта дохода здесь НЕТ и быть не должно: наша маржа остаётся остатком позиции ₮.
 * Поле `exchangeIncome` из этого набора убрано намеренно — чтобы тракт физически не мог снова
 * начать открывать тезерный 374.
 */
export interface QrExchangeAccounts {
  merchantRub: string;
  merchantUsdt: string;
  posRub: string;
  posUsdt: string;
}

/**
 * Транзакция 2 расчёта — ОБМЕН рублей мерчанта на тезер по НАШЕМУ курсу.
 * `merchantUsdtMinor` — то, что мерчанту обещала касса (снимок инвойса), а не пересчёт задним
 * числом: одна денежная величина — один источник.
 *
 * Рубли уходят ЦЕЛИКОМ: позиция ₽ принимает всю сумму A, а не A за вычетом нашей маржи. Позиция ₮
 * отдаёт мерчанту ровно M — ни ногой больше: остаток s = U−M остаётся на ней и есть наш капитал.
 * Σ=0 по каждой валюте внутри проводки: ₽ (−A +A), ₮ (−M +M).
 */
export function buildQrExchangeEntries(p: {
  amountRubMinor: bigint;
  usdtReceivedMinor: bigint;
  merchantUsdtMinor: bigint;
  accounts: QrExchangeAccounts;
}): { entries: QrEntry[]; incomeUsdtMinor: bigint } {
  const { amountRubMinor: A, usdtReceivedMinor: U, merchantUsdtMinor: M, accounts: a } = p;
  if (A <= 0n || U <= 0n || M <= 0n) throw new Error('buildQrExchangeEntries: суммы > 0');
  const income = qrSpreadUsdtMinor(U, M);
  /**
   * 🔴 Заработок ОСТАЁТСЯ НА ВАЛЮТНОЙ ПОЗИЦИИ, отдельного счёта дохода у него нет.
   *
   * Модель владельца: на позицию пришёл весь тезер провайдера, с неё ушла доля мерчанта на его
   * Лоро, разница осталась лежать тут же — это и есть остаток капитала. Прежде разница уезжала
   * на отдельный счёт «Доход от обмена», и позиция обнулялась: владелец искал свои 7,4776 ₮ на
   * позиции и не находил, а в списке появлялся счёт, которого он не заводил.
   *
   * Σ=0 держится по каждой валюте: рубли (−A +A), тезер (−M +M). `incomeUsdtMinor` остаётся
   * справочным числом для экрана — проводкой оно больше не становится.
   *
   * Отсева нулевых ног здесь нет и не нужно: A и M гарантированно > 0 проверкой выше, а ноги
   * дохода, единственной, которая могла обнулиться (спред ноль), больше не существует.
   */
  const entries: QrEntry[] = [
    { accountId: a.merchantRub, amountMinor: -A, currency: 'RUB' },
    { accountId: a.posRub, amountMinor: A, currency: 'RUB' },
    { accountId: a.posUsdt, amountMinor: -M, currency: QR_USDT },
    { accountId: a.merchantUsdt, amountMinor: M, currency: QR_USDT },
  ];
  return { entries, incomeUsdtMinor: income };
}

/** Делит фактически пришедшие USDT между оплатами пропорционально рублям; остаток — последней. */
export function allocateUsdt(totalUsdtMinor: bigint, rubAmounts: bigint[]): bigint[] {
  if (rubAmounts.length === 0) throw new Error('allocateUsdt: нет оплат');
  if (rubAmounts.some((x) => x <= 0n)) throw new Error('allocateUsdt: все суммы должны быть > 0');
  const totalRub = rubAmounts.reduce((s, x) => s + x, 0n);
  if (totalRub <= 0n || totalUsdtMinor <= 0n) throw new Error('allocateUsdt: суммы > 0');
  const parts = rubAmounts.map((x) => (totalUsdtMinor * x) / totalRub);
  const rest = totalUsdtMinor - parts.reduce((s, x) => s + x, 0n);
  parts[parts.length - 1] = parts[parts.length - 1]! + rest;
  return parts;
}
