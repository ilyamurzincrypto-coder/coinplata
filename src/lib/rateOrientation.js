// src/lib/rateOrientation.js
// ОДНО ПРАВИЛО ХРАНЕНИЯ КУРСА — и обратный перевод в то, что видит кассир.
//
// ЗАЧЕМ. В модели жили две конвенции сразу: блоки USDT и Нал хранили числа
// так, как их пишет Paramon и отдаёт Толунай («слабая за 1 сильную»), а
// Перестановки и QR — так, как их считаем мы («валюта получателя за 1 валюту
// отправителя»). Внутри кассы расхождение было незаметно. Аудит нашёл его на
// живой публикации: RUB/TRY уходил в двух разных единицах, а QR к евро
// разошёлся с рынком на 20,8% — мы отдавали бы евро в 1,37 раза дешевле.
//
// КАНОНИЧЕСКИЙ ВИД: значение строки `from → to` — это ВСЕГДА «сколько единиц
// `to` за 1 единицу `from`». Одно правило на модель, публикацию и всех
// потребителей моста.
//
// НО КАССИР ВИДИТ СВОЁ. Утром он сверяет экран с сообщением Paramon, и
// показать ему 0,8525 вместо присланных 1,173 значит сломать сверку. Поэтому
// ввод переводится в канон на входе, а вывод — обратно в вид документа.
// Хранение и показ разделены сознательно.
//
// ПРАВИЛО ОРИЕНТАЦИИ ДОКУМЕНТА перенесено из работающего парсера coinpoint
// (bot/src/util/rates-parser.ts: `sf > st ? value : 1 / value`), а не выдумано:
// Paramon всегда пишет «слабая за 1 сильную».

/**
 * Сила валюты. Чем больше, тем «дороже» единица: за одну сильную дают много
 * слабых. Таблица — копия coinpoint (RUB/RUBQR 1, TRY 2, USD/USDT 5, EUR 6),
 * расширена валютами, которые ходят через кассу.
 */
export const CURRENCY_STRENGTH = {
  RUB: 1, RUBQR: 1, RUB_QR: 1,
  TRY: 2,
  CNY: 3,
  USD: 5, USDT: 5, USDC: 5,
  EUR: 6,
  CHF: 7,
  GBP: 8,
};

/**
 * Пишет ли документ эту пару в обратную сторону к каноническому виду.
 * Инвертируем, только когда отправитель СЛАБЕЕ получателя: тогда число
 * документа — это «сколько отправителя за 1 получателя», а канон требует
 * обратного. Равная сила (USD↔USDT) инверсии не требует.
 *
 * Неизвестная валюта → false: молча переворачивать то, о чём мы ничего не
 * знаем, опаснее, чем оставить как есть.
 */
export function documentInverted(from, to) {
  const sf = CURRENCY_STRENGTH[String(from || "").toUpperCase()];
  const st = CURRENCY_STRENGTH[String(to || "").toUpperCase()];
  if (sf == null || st == null) return false;
  return sf < st;
}

const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Число из документа → канон («to за 1 from»).
 * Проценты не трогаем: `USDT → USD −0,9%` уже даёт 0,991 «USD за 1 USDT»,
 * и сила у пары равная.
 */
export function toCanonical(from, to, value) {
  const v = num(value);
  if (v == null || v === 0) return null;
  return documentInverted(from, to) ? 1 / v : v;
}

/**
 * Канон → вид документа. Преобразование обратимо само себе, но названо
 * отдельно: в вызывающем коде должно быть видно, в какую сторону перевод.
 */
export function toDocument(from, to, canonical) {
  const v = num(canonical);
  if (v == null || v === 0) return null;
  return documentInverted(from, to) ? 1 / v : v;
}

/** Подпись единицы для человека: «TRY за 1 USDT». */
export function unitLabel(from, to) {
  return documentInverted(from, to) ? `${from} за 1 ${to}` : `${to} за 1 ${from}`;
}
