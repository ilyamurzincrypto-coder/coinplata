/**
 * Сумма прописью на русском (F2c) — для печатных ордеров/квитанций.
 * Рубли и доллары (выдача у нас долларовая). Целая часть — прописью, дробная —
 * цифрами + слово в нужном склонении: «десять тысяч рублей 00 копеек»,
 * «десять тысяч долларов США 00 центов».
 */
import { defaultMinorUnits } from './currencies';
import { formatMoneyText } from './money';

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** Русское склонение по числу: [1, 2–4, 5–20/0]. */
export function pluralRu(n: bigint, forms: [string, string, string]): string {
  const nn = Number(n % 100n < 0n ? -(n % 100n) : n % 100n);
  if (nn >= 11 && nn <= 14) return forms[2];
  const u = nn % 10;
  if (u === 1) return forms[0];
  if (u >= 2 && u <= 4) return forms[1];
  return forms[2];
}

function group3(n: number, gender: 'm' | 'f'): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const tu = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (tu >= 10 && tu <= 19) {
    parts.push(ONES_M[tu]!);
  } else {
    const t = Math.floor(tu / 10);
    const u = tu % 10;
    if (t) parts.push(TENS[t]!);
    if (u) parts.push((gender === 'f' ? ONES_F : ONES_M)[u]!);
  }
  return parts.join(' ');
}

const SCALES: { div: bigint; gender: 'm' | 'f'; forms: [string, string, string] | null }[] = [
  { div: 1_000_000_000n, gender: 'm', forms: ['миллиард', 'миллиарда', 'миллиардов'] },
  { div: 1_000_000n, gender: 'm', forms: ['миллион', 'миллиона', 'миллионов'] },
  { div: 1_000n, gender: 'f', forms: ['тысяча', 'тысячи', 'тысяч'] },
  { div: 1n, gender: 'm', forms: null }, // единицы — пол задаёт вызывающий
];

/** Целое число прописью. gender — пол для группы единиц (рубль/доллар — м). */
export function numberToWordsRu(n: bigint, gender: 'm' | 'f' = 'm'): string {
  if (n < 0n) throw new Error('numberToWordsRu: число ≥ 0');
  if (n === 0n) return 'ноль';
  const out: string[] = [];
  for (const sc of SCALES) {
    const group = Number((n / sc.div) % 1000n);
    if (group === 0) continue;
    const g = sc.forms ? sc.gender : gender;
    out.push(group3(group, g));
    if (sc.forms) out.push(pluralRu(BigInt(group), sc.forms));
  }
  return out.join(' ');
}

interface CurrencyWords {
  major: [string, string, string];
  minor: [string, string, string];
  suffix?: string;
  /** Валюта не склоняется (евро) — форма одна на все числа. */
  invariable?: boolean;
  /**
   * Род валюты: числительное обязано согласоваться. «одна лира», но «один рубль».
   * Без этого ордер печатал «один лира турецкая» — грамматика на подписываемом документе.
   */
  gender?: 'm' | 'f';
}

/**
 * (Хвост Б2-1) Словесные формы валют кассового ордера.
 *
 * Раньше здесь были только рубль и доллар, а тип функции — `'RUB' | 'USD'`, поэтому ордер на
 * евро/лиру печатался рублём: тернарник выше по стеку молча подменял валюту. Документ подписывают
 * и отдают клиенту, так что цена такой подмены выше, чем у той же ошибки на экране.
 */
const CURRENCY: Record<string, CurrencyWords> = {
  RUB: { major: ['рубль', 'рубля', 'рублей'], minor: ['копейка', 'копейки', 'копеек'] },
  USD: { major: ['доллар', 'доллара', 'долларов'], minor: ['цент', 'цента', 'центов'], suffix: 'США' },
  // Евро в русском не склоняется — форма одна; разменная единица — цент.
  EUR: { major: ['евро', 'евро', 'евро'], minor: ['цент', 'цента', 'центов'], invariable: true },
  TRY: { major: ['лира', 'лиры', 'лир'], minor: ['куруш', 'куруша', 'курушей'], suffix: 'турецкая', gender: 'f' },
};

/** Согласование определения при валюте: «лир турецких», но «долларов США». */
function suffixForm(n: bigint, cur: CurrencyWords): string {
  if (cur.suffix !== 'турецкая') return cur.suffix ?? '';
  return pluralRu(n, ['турецкая', 'турецкие', 'турецких']);
}

/**
 * Сумма прописью: целая часть словами, дробная (копейки/центы) цифрами.
 * «десять тысяч рублей 00 копеек» · «десять тысяч долларов США 00 центов».
 */
export function amountInWordsRu(minor: bigint, currency: string, minorUnits?: number): string {
  if (minor < 0n) throw new Error('amountInWordsRu: сумма ≥ 0');
  const units = minorUnits ?? defaultMinorUnits(currency);
  /**
   * 🔴 Словесная форма есть только у ДВУЗНАЧНОЙ валюты: «копеек», «центов», «курушей» — это
   * сотые доли. У тезера долей четыре, и слова для них в русском языке нет.
   *
   * Поэтому словарь берётся, только когда у валюты ровно два знака; иначе сумма печатается
   * цифрами общим денежным форматтером. Прежде тезер уходил в цифровую ветку с делением на 100
   * и печатал «21 852,24 USDT-TRC20» там, где «Сумма» строкой выше показывала 218,5224 ₮:
   * две разные величины в одной рамке на бумаге, которую подписывает клиент.
   */
  const cur = units === 2 ? CURRENCY[currency] : undefined;
  /**
   * Валюты без словесной формы (крипта: USDT-TRC20, TRX) печатаем цифрами с символом.
   * Выдумывать «тысяча ЮСДТ» на документе нельзя: такой формы в языке нет, а ордер — бумага,
   * которую читает человек и подписывает клиент. Честнее «218,5224 ₮», чем изобретение.
   */
  if (!cur) return formatMoneyText(minor, currency, units);
  const major = minor / 100n;
  const cents = minor % 100n;
  const majorWords = numberToWordsRu(major, cur.gender ?? 'm');
  // Несклоняемая валюта (евро) — одна форма на любое число.
  const majorUnit = (cur.invariable ? cur.major[0] : pluralRu(major, cur.major)) + (cur.suffix ? ` ${suffixForm(major, cur)}` : '');
  const centsStr = cents.toString().padStart(2, '0');
  const centsUnit = pluralRu(cents, cur.minor);
  return `${majorWords} ${majorUnit} ${centsStr} ${centsUnit}`;
}
