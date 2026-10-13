/**
 * (Правка владельца) Подпись ИСТОЧНИКА базового курса. Чистая функция, без БД.
 *
 * 🔴 Почему это отдельный файл, а не строка «ЦБ» в вёрстке. Слово «ЦБ» было зашито в пять
 * экранов подряд — и на счёте USDT-TRC20 владелец прочитал «ЦБ 90,8161 + спред 5 %». У тезера
 * нет и не может быть курса ЦБ: это число он сам вписал руками в «Курсах». Подпись утверждала
 * то, чего нет, — а по такой подписи принимают решения о деньгах.
 *
 * Правило: подписываем ТЕМ, что реально стоит за числом. Не знаем источник — пишем нейтральное
 * «база», но НИКОГДА не выдаём ручной курс за официальный.
 */
const LABELS: Record<string, string> = {
  cbr: 'ЦБ',
  manual: 'ручной курс',
  coingecko: 'CoinGecko',
  binance: 'Binance',
  frankfurter: 'ЕЦБ',
};

/** Человеческая подпись источника курса: 'manual' → «ручной курс», 'cbr' → «ЦБ». */
export function rateSourceLabel(source: string | null | undefined): string {
  if (!source) return 'база';
  const key = source.trim().toLowerCase();
  if (LABELS[key]) return LABELS[key]!;
  // Источники приходят и в человеческом виде ('Frankfurter (ЕЦБ)', 'CoinGecko') — их не портим.
  return source.trim();
}

/** Нужна ли пояснительная сноска «курс задан вручную» рядом с числом. */
export function isManualRateSource(source: string | null | undefined): boolean {
  return (source ?? '').trim().toLowerCase() === 'manual';
}
