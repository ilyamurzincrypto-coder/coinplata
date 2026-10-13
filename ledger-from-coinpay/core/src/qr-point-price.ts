/**
 * ЦЕНА КЛИЕНТУ В ПУНКТЕ ОБМЕНА (QR «Филиал 2»): курс ЦБ → надбавка провайдера → наценка платформы
 * → НАДБАВКА ПУНКТА → цена клиенту.
 *
 * 🔴 Цена клиенту СЧИТАЕТСЯ, а не набирается руками. Прежде кассир получал утром абсолютные числа
 * («USDT → TRY 48,05») и вбивал их в лист; курс платформы за день уезжал, а число в листе стояло
 * прежнее — и пункт продавал то дешевле себестоимости, то дороже, чем собирался. Теперь пункт
 * задаёт ОДНО: свой процент. Всё остальное считает эта цепочка, и цена едет вместе с курсом дня.
 *
 * 🔴 Одна функция на все четыре валюты (₺ $ € ₮) и на все три поверхности — касса, кабинет,
 * админка. Второе вычисление «той же» цены разошлось бы с первым, а клиент читает цену с экрана
 * кассы, мерчант — из кабинета, и сверяют их между собой.
 *
 * Единица цены — ₽ ЗА ОДНУ ЕДИНИЦУ ВЫДАЧИ (×1e6), одна и та же для лиры, доллара, евро и тезера.
 * Так её показывает касса (`effectiveRateE6`) и так её сверяет кабинет; «лир за тезер» — форма
 * записи утреннего листа, а не величина, которой считают деньги.
 *
 * Округление — в пользу платформы: курс вверх (`ceil`), выдача клиенту вниз (`floor`).
 */
import { ceilDivBig, dealRateE6 } from './fx';
import { clientUsdtRateE6, isClientUsdtRow, SHEET_MINOR_UNITS, type SheetAsset, type SheetRow } from './point-rate-sheet';
import { merchantUsdtRateE6, providerRateE6 } from './qr-provider';

const E6 = 1_000_000n;
const BP = 10_000n;
const RUB_UNITS = 2;
const pow10 = (n: number) => 10n ** BigInt(n);

/**
 * Валюты, по которым пункт задаёт надбавку. Рубли сюда не входят: их пункт ПРИНИМАЕТ по QR, и
 * наценять рубль на рубль нечем (в рублёвом режиме кассир ничего не зарабатывает на курсе).
 */
export const POINT_MARKUP_CURRENCIES = ['TRY', 'USD', 'EUR', 'USDT'] as const;
export type PointMarkupCurrency = (typeof POINT_MARKUP_CURRENCIES)[number];

const POINT_CURRENCY_SET = new Set<string>(POINT_MARKUP_CURRENCIES);

/** Валюта надбавки пункта? Строку из базы и из формы проверяем ЗДЕСЬ, а не приводим к типу вслепую. */
export function isPointMarkupCurrency(v: string): v is PointMarkupCurrency {
  return POINT_CURRENCY_SET.has(v);
}

/**
 * Масштаб «минорные единицы валюты → копейки»: у тезера четыре знака, у наличных и рублей два.
 * Без него цена уезжала бы в сто раз ровно на тезере — валюте, ради которой волна и делалась.
 */
function unitScale(currency: SheetAsset): bigint {
  return pow10(SHEET_MINOR_UNITS[currency] - RUB_UNITS);
}

/**
 * КУРС ПЛАТФОРМЫ по валюте — ₽ за 1 её единицу (×1e6): курс ЦБ этой валюты + надбавка провайдера
 * + наценка платформы. Та же цепочка и теми же функциями, что считает курс тезера при выбивании
 * QR (`providerRateE6` → `merchantUsdtRateE6`), — просто применённая к рублёвому курсу ЦБ нужной
 * валюты. Для тезера курс ЦБ берётся долларовый (₮ = доллар ЦБ, миграция 0072), поэтому у ₮ эта
 * функция возвращает ровно то же число, что и касса считала всегда.
 *
 * 🔴 Ниже этого курса пункт продавать не вправе: это наша себестоимость его выдачи.
 */
export function pointPlatformRateE6(p: {
  cbRubPerUnitE6: bigint;
  providerMarkupBp: number;
  platformPriceBp: number;
}): bigint {
  return merchantUsdtRateE6(providerRateE6(p.cbRubPerUnitE6, p.providerMarkupBp), p.platformPriceBp);
}

/**
 * ЦЕНА КЛИЕНТУ = курс платформы × (1 + надбавка пункта), вверх. null — надбавки нет, она
 * отрицательна или цена оказалась ниже курса платформы: пункт торговал бы себе в убыток.
 * Тот же `dealRateE6` и тот же пол, что у прежней цены тезера (`clientUsdtRateE6`), — правило
 * «ниже платформы не бывает» остаётся одно на все валюты.
 */
export function pointClientRateE6(platformRateE6: bigint, markupBp: number): bigint | null {
  if (platformRateE6 <= 0n || !Number.isInteger(markupBp) || markupBp < 0) return null;
  const rate = dealRateE6(platformRateE6, markupBp);
  return rate < platformRateE6 ? null : rate;
}

/** Цена пункта по одной валюте: что платформа, что пункт и что платит клиент — тремя числами. */
export interface PointPrice {
  currency: PointMarkupCurrency;
  /** ₽ за 1 единицу — наша себестоимость выдачи (×1e6). */
  platformRateE6: bigint;
  /** Надбавка пункта, bp. */
  markupBp: number;
  /** ₽ за 1 единицу, которые платит клиент (×1e6). */
  clientRateE6: bigint;
}

/**
 * 🔴 ЕДИНСТВЕННАЯ цена пункта: валюта + курс ЦБ дня + надбавка провайдера точки + наценка
 * платформы + надбавка пункта → три числа цепочки. Её зовут касса (взять рубли), кабинет
 * (показать цепочку), админка (показать то же оператору) и сервер (проверить, что оплата не ниже
 * себестоимости). null — цены нет: надбавка пункта не задана или она увела бы цену ниже платформы.
 */
export function pointPrice(p: {
  currency: PointMarkupCurrency;
  cbRubPerUnitE6: bigint;
  providerMarkupBp: number;
  platformPriceBp: number;
  markupBp: number;
}): PointPrice | null {
  if (p.cbRubPerUnitE6 <= 0n) return null;
  const platformRateE6 = pointPlatformRateE6(p);
  const clientRateE6 = pointClientRateE6(platformRateE6, p.markupBp);
  if (clientRateE6 === null) return null;
  return { currency: p.currency, platformRateE6, markupBp: p.markupBp, clientRateE6 };
}

/**
 * Рубли, которые платит клиент за выдачу `cashMinor` в валюте `currency` по цене `rateE6`.
 * Вверх — клиент платит, округление в пользу платформы. Для тезера повторяет число, которое
 * касса брала всегда (`usdtToRubMinor(…, 'ceil')`).
 */
export function rubForPayoutMinor(cashMinor: bigint, rateE6: bigint, currency: SheetAsset): bigint {
  if (rateE6 <= 0n) throw new Error('rubForPayoutMinor: курс > 0');
  return ceilDivBig(cashMinor * rateE6, E6 * unitScale(currency));
}

/**
 * Обратно: сколько валюты получает клиент за `rubMinor` по цене `rateE6`. Вниз — лишнего кассир
 * не отдаёт. Для тезера повторяет `rubToUsdtMinor`.
 */
export function payoutMinorForRub(rubMinor: bigint, rateE6: bigint, currency: SheetAsset): bigint {
  if (rateE6 <= 0n) throw new Error('payoutMinorForRub: курс > 0');
  return (rubMinor * unitScale(currency) * E6) / rateE6;
}

/**
 * ЗАРАБОТОК ПУНКТА НА СВОЕЙ НАДБАВКЕ — в тезере, по одной оплате.
 *
 * Владелец просил мерить именно в тезере: «сколько я заработал на своей надбавке». Считается
 * разностью двух ФАКТОВ, а не «сумма × процент»: тезер, который мы зачислили пункту, минус тезер,
 * в который обошлась выданная им наличка по курсу ПЛАТФОРМЫ. Обе величины уже округлены при
 * оплате, и умножение на процент дало бы третье число, не сходящееся ни с одной из них.
 *
 * Себестоимость считаем вверх (рубли вверх, тезер вверх) — заработок не завышаем ни на единицу.
 * Отрицательным он быть не может: цена клиенту не опускается ниже курса платформы (`pointPrice`),
 * а остаток от округлений режем нулём.
 */
export function pointEarningUsdtMinor(p: {
  payoutCurrency: SheetAsset;
  payoutMinor: bigint;
  /** Курс ПЛАТФОРМЫ валюты выдачи на момент оплаты, ₽ за единицу ×1e6. */
  payoutPlatformRateE6: bigint;
  /** Курс платформы по тезеру на момент оплаты, ₽ за 1 ₮ ×1e6 (`invoices.qr_merchant_rate_e6`). */
  merchantRateE6: bigint;
  /** Тезер, зачисленный мерчанту этой оплатой (`invoices.qr_merchant_usdt_minor`). */
  creditedUsdtMinor: bigint;
}): bigint {
  if (p.payoutPlatformRateE6 <= 0n || p.merchantRateE6 <= 0n || p.payoutMinor <= 0n || p.creditedUsdtMinor <= 0n) return 0n;
  const costRubMinor = rubForPayoutMinor(p.payoutMinor, p.payoutPlatformRateE6, p.payoutCurrency);
  // Тезер себестоимости — ВВЕРХ (зеркало `payoutMinorForRub`, которая округляет вниз): выдай мы
  // себе фору здесь, заработок оказался бы больше настоящего на единицу тезера у каждой оплаты.
  const costUsdtMinor = ceilDivBig(costRubMinor * unitScale('USDT') * E6, p.merchantRateE6);
  const earned = p.creditedUsdtMinor - costUsdtMinor;
  return earned > 0n ? earned : 0n;
}

/* ─── Утренний лист → надбавки ─────────────────────────────────────────────────────────────────
 * Лист по-прежнему приходит утром сообщением и по-прежнему хранится как пришёл — это документ
 * провайдера. Но ценой он больше не работает: из его чисел ВЫВОДИТСЯ процент пункта, а цену
 * дальше считает цепочка выше. Иначе на экране осталось бы две цены — вчерашнее число листа и
 * сегодняшняя цепочка, — и они разошлись бы в первый же день.
 */

/**
 * Сколько единиц валюты строка листа обещает за 1 тезер (×1e6). Форма записи у листа своя у каждой
 * валюты, и это единственное место, где она читается: доллар — процентом к 1:1 («−0,70 %» = клиент
 * получает на 0,7 % меньше долларов), лира — лир за тезер, евро — тезеров за евро.
 * null — направление не про выдачу клиенту (приёмные строки листа) или число бессмысленно.
 */
export function sheetUnitsPerUsdtE6(row: SheetRow): bigint | null {
  if (row.from !== 'USDT' || row.to === 'RUB' || row.to === 'USDT') return null;
  if (row.kind === 'pct') {
    const units = BP + BigInt(row.bp);
    return units <= 0n ? null : (units * E6) / BP;
  }
  if (row.rateE6 <= 0n) return null;
  // Евро котируется наоборот — тезеров за 1 евро, поэтому единиц за тезер получается делением.
  return row.to === 'EUR' ? (E6 * E6) / row.rateE6 : row.rateE6;
}

/**
 * Цена клиенту (₽ за единицу ×1e6), которую ОБЕЩАЕТ строка утреннего листа, при данном курсе
 * платформы по тезеру. Через неё выводится процент пункта: лист говорит «48,05 ₺ за ₮», а система
 * хранит «надбавка 1,21 %», и завтра эта же надбавка даст цену уже от нового курса дня.
 *
 * Строка тезера (RUB → USDT) считается прежней функцией `clientUsdtRateE6` — она и есть цена в
 * рублях за 1 ₮, второй формулы для неё не заводим.
 */
export function sheetRowClientRateE6(row: SheetRow, platformUsdtRateE6: bigint): bigint | null {
  if (platformUsdtRateE6 <= 0n) return null;
  if (isClientUsdtRow(row)) return clientUsdtRateE6(platformUsdtRateE6, row);
  const units = sheetUnitsPerUsdtE6(row);
  if (units === null || units <= 0n) return null;
  // ₽ за единицу = (₽ за тезер) ÷ (единиц за тезер). Вверх — как и всякая названная клиенту цена.
  return ceilDivBig(platformUsdtRateE6 * E6, units);
}

/**
 * Надбавка, ПОДРАЗУМЕВАЕМАЯ ценой: насколько цена клиенту выше курса платформы, в bp. Вниз
 * (floor): из листа мы не вправе вывести надбавку БОЛЬШЕ той, что в нём написана, — иначе вставка
 * утреннего сообщения молча поднимала бы цену клиенту выше присланной провайдером.
 *
 * null — цена ниже курса платформы: такую строку в надбавку не превращаем (пункт торговал бы в
 * убыток), и вставка сообщает о ней отдельно, а не записывает молча.
 */
export function impliedMarkupBp(clientRateE6: bigint, platformRateE6: bigint): number | null {
  if (clientRateE6 <= 0n || platformRateE6 <= 0n) return null;
  if (clientRateE6 < platformRateE6) return null;
  return Number(((clientRateE6 - platformRateE6) * BP) / platformRateE6);
}

/** Надбавка пункта, которую даёт строка листа. Для процентной строки тезера — ровно её процент. */
export function sheetRowMarkupBp(row: SheetRow, platform: { usdtRateE6: bigint; currencyRateE6: bigint }): number | null {
  // 🔴 «RUB → USDT +3 %» — это УЖЕ надбавка к курсу платформы, теми же словами. Выводить её
  // обратно из цены значило бы потерять на округлении тот самый процент, который назвал провайдер.
  if (isClientUsdtRow(row) && row.kind === 'pct') return row.bp >= 0 ? row.bp : null;
  const client = sheetRowClientRateE6(row, platform.usdtRateE6);
  if (client === null) return null;
  return impliedMarkupBp(client, platform.currencyRateE6);
}

/** Валюта, к которой относится строка листа как ЦЕНА КЛИЕНТУ. null — строка не про выдачу. */
export function sheetRowPayoutCurrency(row: SheetRow): PointMarkupCurrency | null {
  if (isClientUsdtRow(row)) return 'USDT';
  if (row.from !== 'USDT') return null;
  return isPointMarkupCurrency(row.to) && row.to !== 'USDT' ? row.to : null;
}
