// src/data/iso4217.js
// Справочник ISO 4217 (стандарт, не хардкод-набор бизнеса) для автоподстановки
// фиатов в мастере валют (слайс 1.5.c): код → num (4-значный сегмент), имя, символ.
// num = ISO numeric с 0-падингом до 4 знаков (сегмент валюты в номере счёта).
// Крипта сюда НЕ входит — её код/сеть/контракт заводятся вручную (диапазон 13xx).
//
// Набор покрывает ходовые валюты обменника + резервные; расширяется дописыванием
// строки (это стандарт ISO, значения фиксированы). Отсортировано по коду.

export const ISO4217 = [
  { code: "AED", num: "0784", name: "Дирхам ОАЭ", symbol: "د.إ" },
  { code: "AMD", num: "0051", name: "Армянский драм", symbol: "֏" },
  { code: "AUD", num: "0036", name: "Австралийский доллар", symbol: "A$" },
  { code: "AZN", num: "0944", name: "Азербайджанский манат", symbol: "₼" },
  { code: "BGN", num: "0975", name: "Болгарский лев", symbol: "лв" },
  { code: "BYN", num: "0933", name: "Белорусский рубль", symbol: "Br" },
  { code: "CAD", num: "0124", name: "Канадский доллар", symbol: "C$" },
  { code: "CHF", num: "0756", name: "Швейцарский франк", symbol: "Fr" },
  { code: "CNY", num: "0156", name: "Китайский юань", symbol: "¥" },
  { code: "CZK", num: "0203", name: "Чешская крона", symbol: "Kč" },
  { code: "DKK", num: "0208", name: "Датская крона", symbol: "kr" },
  { code: "EUR", num: "0978", name: "Евро", symbol: "€" },
  { code: "GBP", num: "0826", name: "Фунт стерлингов", symbol: "£" },
  { code: "GEL", num: "0981", name: "Грузинский лари", symbol: "₾" },
  { code: "HKD", num: "0344", name: "Гонконгский доллар", symbol: "HK$" },
  { code: "HUF", num: "0348", name: "Венгерский форинт", symbol: "Ft" },
  { code: "IDR", num: "0360", name: "Индонезийская рупия", symbol: "Rp" },
  { code: "ILS", num: "0376", name: "Израильский шекель", symbol: "₪" },
  { code: "INR", num: "0356", name: "Индийская рупия", symbol: "₹" },
  { code: "JPY", num: "0392", name: "Японская иена", symbol: "¥" },
  { code: "KGS", num: "0417", name: "Киргизский сом", symbol: "с" },
  { code: "KRW", num: "0410", name: "Южнокорейская вона", symbol: "₩" },
  { code: "KZT", num: "0398", name: "Казахстанский тенге", symbol: "₸" },
  { code: "MDL", num: "0498", name: "Молдавский лей", symbol: "L" },
  { code: "NOK", num: "0578", name: "Норвежская крона", symbol: "kr" },
  { code: "PLN", num: "0985", name: "Польский злотый", symbol: "zł" },
  { code: "RON", num: "0946", name: "Румынский лей", symbol: "lei" },
  { code: "RSD", num: "0941", name: "Сербский динар", symbol: "дин" },
  { code: "RUB", num: "0643", name: "Российский рубль", symbol: "₽" },
  { code: "SEK", num: "0752", name: "Шведская крона", symbol: "kr" },
  { code: "SGD", num: "0702", name: "Сингапурский доллар", symbol: "S$" },
  { code: "THB", num: "0764", name: "Тайский бат", symbol: "฿" },
  { code: "TJS", num: "0972", name: "Таджикский сомони", symbol: "SM" },
  { code: "TMT", num: "0934", name: "Туркменский манат", symbol: "m" },
  { code: "TRY", num: "0949", name: "Турецкая лира", symbol: "₺" },
  { code: "UAH", num: "0980", name: "Украинская гривна", symbol: "₴" },
  { code: "USD", num: "0840", name: "Доллар США", symbol: "$" },
  { code: "UZS", num: "0860", name: "Узбекский сум", symbol: "so'm" },
  { code: "ZAR", num: "0710", name: "Южноафриканский рэнд", symbol: "R" },
];

export const ISO4217_BY_CODE = Object.fromEntries(ISO4217.map((c) => [c.code, c]));

// Поиск по коду или имени (для автокомплита мастера).
export function findIso(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return ISO4217;
  return ISO4217.filter(
    (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
  );
}
