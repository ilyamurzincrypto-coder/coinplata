// src/lib/ledgerView/money.js
//
// 🔴 ЕДИНСТВЕННЫЙ ДЕНЕЖНЫЙ ФОРМАТТЕР ВИДА ЛЕДЖЕРА.
//
// Перенесено из CoinPay вместе с причиной. Там текстовых денежных форматтеров однажды стало два,
// и журнал напечатал расчёт по тезеру как «21 852,24 $» — чужой символ и два знака вместо
// четырёх, то есть неверная валюта и ошибка в сто раз в одной строке. Один форматтер на весь
// вид — не стиль, а защита.
//
// 🔴 ТОЧНОСТЬ НЕ ТЕРЯЕМ. В базе суммы лежат как `numeric(20,8)` — это ТОЧНАЯ десятичная, с ней
// всё хорошо. Теряет её JavaScript: `ledgerReaders.js` делает `Number(r.amount)`, и точное число
// становится float. На восьми знаках и крупных суммах float64 начинает врать в последних
// разрядах — тихо, без ошибки. Поэтому здесь суммы живут СТРОКОЙ и форматируются строкой:
// ни одного арифметического действия над float.
//
// 🔴 НЕИЗВЕСТНОЕ — ПРОЧЕРК, А НЕ НОЛЬ. В `ledgerReaders` стоит `Number(r.amount) || 0`: null,
// пустая строка и NaN молча превращаются в ноль. В деньгах «нет данных» и «ноль» — разные вещи,
// и путать их нельзя: ноль утверждает, что на счёте пусто.

/** Что показываем вместо суммы, когда её нет. Никогда не «0,00». */
export const NO_VALUE = "—";

/**
 * Символы валют. Берём из справочника, а не угадываем: в CoinPay локальный форматтер знал лишь
 * RUB/USD/EUR и любую другую валюту печатал долларом — евровый счёт читался долларами.
 */
const SYMBOLS = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  TRY: "₺",
  USDT: "₮",
  "USDT-TRC20": "₮",
  "USDT-ERC20": "₮",
  "USDT-BEP20": "₮",
};

/**
 * Сколько знаков после запятой показывать.
 *
 * 🔴 НЕ КОНСТАНТА «2». У тезера их четыре (в CoinPay) или восемь (здесь, `numeric(20,8)`), у
 * фиата два. Пока форматтер делил на 100 всегда, 2 185 224 минорных единиц тезера читались как
 * «21 852,24 ₮» вместо «218,5224 ₮» — ошибка в сто раз на экране остатков.
 *
 * Здесь суммы приходят в МАЖОРНЫХ единицах (numeric), поэтому речь о том, сколько знаков
 * ПОКАЗЫВАТЬ, а не на что делить. Крипте оставляем больше.
 */
const DECIMALS = { RUB: 2, USD: 2, EUR: 2, TRY: 2 };
const CRYPTO_DECIMALS = 8;

export function currencySymbol(currency) {
  if (!currency) return "";
  return SYMBOLS[currency] || currency;
}

export function displayDecimals(currency) {
  if (!currency) return 2;
  const known = DECIMALS[currency];
  if (known !== undefined) return known;
  // Неизвестная валюта считается криптой: лучше показать лишние знаки, чем отрезать значащие.
  return CRYPTO_DECIMALS;
}

/**
 * Разбор суммы-строки на знак, целую и дробную часть — БЕЗ float.
 * Возвращает null, если это не число: вызывающий покажет прочерк.
 */
export function parseExact(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const m = /^(-?)(\d+)(?:[.,](\d*))?$/.exec(s);
  if (!m) return null;
  return { negative: m[1] === "-", int: m[2], frac: m[3] || "" };
}

/** Группировка разрядов неразрывными пробелами — как в CoinPay. */
function groupInt(int) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Дробная часть ровно нужной длины: лишнее отбрасываем (не округляем — округление денег тихо
 * меняет сумму), недостающее дополняем нулями.
 *
 * Отбрасывание безопасно: это ВИТРИНА, исходная сумма остаётся в базе нетронутой. Округлять же
 * на экране нельзя — человек сверяет показанное с базой.
 */
function fitFrac(frac, decimals) {
  if (decimals <= 0) return "";
  return frac.slice(0, decimals).padEnd(decimals, "0");
}

/**
 * Сумма текстом: «1 234,56». Без символа валюты — его добавляет компонент,
 * чтобы приглушить отдельно (правило дизайн-системы CoinPay).
 */
export function formatAmountText(raw, currency) {
  const parsed = parseExact(raw);
  if (!parsed) return NO_VALUE;
  const decimals = displayDecimals(currency);
  const frac = fitFrac(parsed.frac, decimals);
  const body = groupInt(parsed.int) + (frac ? "," + frac : "");
  return (parsed.negative && /[1-9]/.test(parsed.int + parsed.frac) ? "−" : "") + body;
}

/** Сумма с символом — для мест, где JSX не нужен (CSV, подписи, заголовки). */
export function formatMoneyText(raw, currency) {
  const text = formatAmountText(raw, currency);
  if (text === NO_VALUE) return NO_VALUE;
  const sym = currencySymbol(currency);
  return sym ? `${text} ${sym}` : text;
}

/** Отрицательная ли сумма — для подкраски, без обращения к float. */
export function isNegative(raw) {
  const parsed = parseExact(raw);
  if (!parsed) return false;
  return parsed.negative && /[1-9]/.test(parsed.int + parsed.frac);
}

/**
 * Сложение сумм-строк одной валюты без float.
 *
 * 🔴 Валюты НЕ складываются — функция принимает суммы уже отобранные по одной валюте, и это
 * ответственность вызывающего. Сложение разных валют требует курса, курс берётся на дату, дата —
 * предмет спора; «итог по всем валютам» прячет три решения в одно непроверяемое число.
 */
export function sumExact(values, decimals) {
  const scale = 10n ** BigInt(decimals);
  let total = 0n;
  let seen = false;
  for (const raw of values) {
    const p = parseExact(raw);
    if (!p) continue; // неизвестное не превращаем в ноль — просто не учитываем
    seen = true;
    const frac = fitFrac(p.frac, decimals);
    const units = BigInt(p.int) * scale + BigInt(frac || "0");
    total += p.negative ? -units : units;
  }
  if (!seen) return null;
  const neg = total < 0n;
  const abs = neg ? -total : total;
  const int = (abs / scale).toString();
  const frac = decimals > 0 ? (abs % scale).toString().padStart(decimals, "0") : "";
  return (neg ? "-" : "") + int + (frac ? "." + frac : "");
}
