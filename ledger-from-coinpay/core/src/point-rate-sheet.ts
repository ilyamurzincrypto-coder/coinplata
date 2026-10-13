/**
 * Утренний лист курсов пункта обмена (ANT, IST…): цена, по которой кассир отдаёт клиенту наличные.
 * На деньги платформы не влияет — нужен кассе, чтобы сказать «выдать клиенту столько-то».
 */
import { ceilDivBig, dealRateE6 } from './fx';

export type SheetAsset = 'USDT' | 'USD' | 'TRY' | 'EUR' | 'RUB';
export type SheetRow =
  | { from: SheetAsset; to: SheetAsset; kind: 'pct'; bp: number }
  | { from: SheetAsset; to: SheetAsset; kind: 'abs'; rateE6: bigint };
export interface SheetParseError { line: number; text: string; reason: string }
export interface ParsedSheet { points: Record<string, SheetRow[]>; errors: SheetParseError[] }

/** Минорные единицы в кассе QR: USDT-TRC20 — 4 знака, фиат — 2. */
export const SHEET_MINOR_UNITS: Record<SheetAsset, number> = { USDT: 4, USD: 2, TRY: 2, EUR: 2, RUB: 2 };

/** Валюты листа. Один список на разбор вставки, правку таблицей и выбор в форме «добавить пару». */
export const SHEET_ASSETS: readonly SheetAsset[] = ['USDT', 'USD', 'TRY', 'EUR', 'RUB'] as const;

const CURRENCY_CODES = new Set<string>(SHEET_ASSETS);

/** Валюта листа? Чтение сохранённых строк проверяет ЗДЕСЬ, а не приводит текст из базы к типу вслепую. */
export function isSheetAsset(v: string): v is SheetAsset {
  return CURRENCY_CODES.has(v);
}
const POINT_CODE = /^[A-Z]{2,5}$/;
const HEADER = /^([A-Z]{2,5}):?$/;
const LINE = /^(USDT|USD|TRY|EUR|RUB)\s*->\s*(USDT|USD|TRY|EUR|RUB)\s+([+-]?\d+(?:[.,]\d{1,6})?)\s*(%)?$/;

/** Границы котировки TRY (лир за 1 USDT) и EUR (USDT за 1 евро) — защита от опечатки в листе. */
const TRY_MIN_E6 = 5_000_000n;
const TRY_MAX_E6 = 500_000_000n;
const EUR_MIN_E6 = 1_000_000n;
const EUR_MAX_E6 = 3_000_000n;
/** Границы цены тезера клиенту (₽ за 1 USDT): курс платформы ходит около 80–100 ₽, «8» и «870» — опечатка. */
const RUB_MIN_E6 = 10_000_000n;
const RUB_MAX_E6 = 1_000_000_000n;
/** Потолок надбавки тезера — своё число, а не общие 50 % (см. `sheetValueProblem`). */
const CLIENT_USDT_MAX_PCT_E6 = 20_000_000n;

/**
 * Нормализация вставленного текста: неразрывный пробел → обычный, zero-width space/BOM убираются,
 * типографские минус (U+2212) и длинное тире (U+2013) → дефис, стрелка «→» → «->».
 */
function normalizeLine(raw: string): string {
  return raw
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/\u2192/g, '->')
    .trim();
}

function decimalE6(s: string): bigint | null {
  const m = /^([+-])?(\d+)(?:[.,](\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const v = BigInt(m[2]!) * 1_000_000n + BigInt((m[3] ?? '').padEnd(6, '0'));
  return m[1] === '-' ? -v : v;
}

export function parseRateSheet(text: string): ParsedSheet {
  const points: Record<string, SheetRow[]> = {};
  const errors: SheetParseError[] = [];
  const headerLineOf: Record<string, number> = {};
  let current: string | null = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = normalizeLine(raw);
    const n = i + 1;
    if (!line) return;
    const hm = HEADER.exec(line);
    if (hm && !CURRENCY_CODES.has(hm[1]!)) {
      current = hm[1]!;
      if (!(current in points)) {
        points[current] = [];
        headerLineOf[current] = n;
      }
      return;
    }
    const m = LINE.exec(line);
    if (!m) return void errors.push({ line: n, text: line, reason: 'Не похоже на строку курса «USDT -> TRY 47,90»' });
    if (!current) return void errors.push({ line: n, text: line, reason: 'Строка курса до названия пункта' });
    const from = m[1] as SheetAsset;
    const to = m[2] as SheetAsset;
    // Правила пары, стиля котировки и диапазона — общие с правкой листа таблицей (ниже).
    // Разойтись вставка и правка не могут: проверка физически одна.
    const pair = sheetPairProblem(from, to);
    if (pair) return void errors.push({ line: n, text: line, reason: pair });
    const rows = points[current]!;
    if (rows.some((r) => r.from === from && r.to === to)) return void errors.push({ line: n, text: line, reason: DUPLICATE_PAIR });
    const kind: SheetRow['kind'] = m[4] === '%' ? 'pct' : 'abs';
    const e6 = decimalE6(m[3]!)!;
    const bad = sheetValueProblem(from, to, kind, e6);
    if (bad) return void errors.push({ line: n, text: line, reason: bad });
    rows.push(sheetRowFromDraft({ from, to, kind, valueE6: e6 }));
  });
  // Проверяем «пусто» только после разбора всего листа — иначе повторный заголовок того же
  // пункта (курсы которого продолжаются ниже) даёт ложную ошибку на промежуточном переключении.
  for (const key of Object.keys(points)) {
    if (points[key]!.length === 0) {
      errors.push({ line: headerLineOf[key]!, text: key, reason: 'У пункта нет ни одного курса' });
    }
  }
  return { points, errors };
}

const pow10 = (n: number) => 10n ** BigInt(n);

/**
 * Сколько выдать клиенту в валюте `row.to` за `usdtMinor` (строка «USDT -> X»). Округление вниз —
 * лишнего кассир не отдаёт. Котировки: USD — процент к 1:1; TRY — лир за 1 USDT; EUR — USDT за 1 евро.
 */
export function cashOutForUsdt(usdtMinor: bigint, row: SheetRow): bigint {
  if (row.from !== 'USDT') throw new Error('cashOutForUsdt: нужна строка «USDT -> X»');
  const scale = pow10(SHEET_MINOR_UNITS.USDT - SHEET_MINOR_UNITS[row.to]);
  if (row.kind === 'pct') return (usdtMinor * BigInt(10_000 + row.bp)) / 10_000n / scale;
  if (row.to === 'EUR') return (usdtMinor * 1_000_000n) / row.rateE6 / scale;
  return (usdtMinor * row.rateE6) / 1_000_000n / scale;
}

/** Обратно: сколько USDT нужно, чтобы выдать `cashMinor` в `row.to`. Округление вверх. */
export function usdtForCashOut(cashMinor: bigint, row: SheetRow): bigint {
  if (row.from !== 'USDT') throw new Error('usdtForCashOut: нужна строка «USDT -> X»');
  const scale = pow10(SHEET_MINOR_UNITS.USDT - SHEET_MINOR_UNITS[row.to]);
  const scaled = cashMinor * scale;
  if (row.kind === 'pct') return ceilDivBig(scaled * 10_000n, BigInt(10_000 + row.bp));
  if (row.to === 'EUR') return ceilDivBig(scaled * row.rateE6, 1_000_000n);
  return ceilDivBig(scaled * 1_000_000n, row.rateE6);
}

const RATE_E6 = 1_000_000n;
const RUB_MINOR_UNITS = 2;
/** Эталонная сделка для витрины: миллион единиц выдачи — округление шага кассы в курс не пролезает. */
const PROBE_CASH_MINOR = 100_000_000n;

/**
 * 🔴 ЕДИНСТВЕННЫЙ курс сделки «₽ за 1 единицу выдачи» (×1e6): рубли клиента ÷ выданное ему.
 * Его показывает касса клиенту, и он же стоит в кабинете мерчанта против строки листа — поэтому
 * считается ОДНОЙ функцией. Второе вычисление «того же» курса рано или поздно разошлось бы с
 * первым, а клиент читает курс с экрана кассы, мерчант — из кабинета, и сверяют их между собой.
 * Нечего делить (сумма ещё не введена) — курса нет, null.
 *
 * 🔴 Округление — ТОЛЬКО ВВЕРХ. Терминал повёрнут к клиенту: названный курс не имеет права обещать
 * сумму МЕНЬШЕ той, которую касса берёт. К ближайшему было дешевле на копейки в другую сторону —
 * при 19 807,00 ₺ касса брала 35 877,27 ₽, а названный курс обещал 35 876,41 ₽, и правым в этом
 * споре был бы клиент. Вверх такой разрыв невозможен: `quotedRateE6(курс) × выдача ≥ к оплате`.
 */
export function effectiveRateE6(rubMinor: bigint, cashMinor: bigint, asset: SheetAsset): bigint | null {
  if (cashMinor <= 0n || rubMinor <= 0n) return null;
  // Рубли — 2 знака, выдача — свои: приводим к одной шкале, иначе курс уехал бы в сто раз.
  const n = rubMinor * pow10(SHEET_MINOR_UNITS[asset]) * RATE_E6;
  const d = pow10(RUB_MINOR_UNITS) * cashMinor;
  return ceilDivBig(n, d);
}

/** Знаков после запятой в курсе на экране. */
const QUOTED_RATE_DECIMALS = 4;

/**
 * Курс, каким его ПЕЧАТАЕТ экран: 4 знака, тоже вверх. Формат — дело вёрстки, а вот сторона
 * округления — денежная: экран режет знаки после `effectiveRateE6`, и округли он вниз, обещание
 * снова стало бы меньше кассового чека. Поэтому решение живёт здесь, а форматтер только печатает.
 */
export function quotedRateE6(rateE6: bigint): bigint {
  const step = pow10(6 - QUOTED_RATE_DECIMALS);
  return ceilDivBig(rateE6, step) * step;
}

/**
 * 🔴 ЕДИНСТВЕННАЯ цена тезера клиенту: «₽ за 1 ₮» по строке «RUB -> USDT» и курсу платформы.
 * Её спрашивают и касса (чтобы взять рубли), и кабинет (чтобы показать строку листа), и проверка
 * листа при сохранении — поэтому она одна.
 *
 * Два стиля строки, оба от курса платформы:
 *  • процент — НАДБАВКА к курсу платформы: «+3 %» значит, что за 1 ₮ клиент платит на 3 % больше
 *    рублей, чем платформа считает мерчанту (так цену и называет провайдер). Считается тем же
 *    `dealRateE6`, что применяет обмен, — «база × (1 + наценка)», вверх;
 *  • курс — цена в рублях за 1 ₮, набранная руками.
 *
 * 🔴 Ниже курса платформы цены не бывает: пункт отдавал бы клиенту тезер дешевле, чем платформа
 * этот тезер ему считает, то есть торговал бы себе в убыток. Такая строка — null, и её одинаково
 * не пропускают сохранение листа и касса (проверка на ЧТЕНИИ, чтобы старая строка не дожила до
 * кассы, если курс платформы за ночь ушёл выше неё).
 */
export function clientUsdtRateE6(platformRubPerUsdtE6: bigint, row: SheetRow): bigint | null {
  if (!isClientUsdtRow(row) || platformRubPerUsdtE6 <= 0n) return null;
  if (row.kind === 'pct' && row.bp < 0) return null; // надбавка вниз — не надбавка
  const rate = row.kind === 'pct' ? dealRateE6(platformRubPerUsdtE6, row.bp) : row.rateE6;
  return rate < platformRubPerUsdtE6 ? null : rate;
}

/**
 * Тот же курс для кабинета: строка листа + курс платформы «₽ за 1 USDT» → «₽ за 1 ₺» (а для
 * строки тезера — «₽ за 1 ₮»). Считается НЕ отдельной формулой, а прогоном эталонной сделки через
 * ту же цепочку, что работает в кассе: сколько USDT нужно на выдачу → рубли по курсу платформы →
 * `effectiveRateE6`. Рубли берутся тем же `usdtToRub`, что считает сумму клиенту
 * (`usdtToRubMinor(…, 'ceil')`) — параметром, чтобы лист курсов не тянул за собой модуль
 * провайдера. Строки, по которым пункт ничего не выдаёт (обратные направления листа), — null.
 */
export function sheetEffectiveRateE6(
  rubPerUsdtE6: bigint,
  row: SheetRow,
  usdtToRub: (usdtMinor: bigint, rateE6: bigint) => bigint,
): bigint | null {
  if (rubPerUsdtE6 <= 0n) return null;
  // Тезер клиенту: «выдача» и есть USDT, пересчёта через лист нет — цена берётся сразу.
  if (isClientUsdtRow(row)) {
    const client = clientUsdtRateE6(rubPerUsdtE6, row);
    return client === null ? null : effectiveRateE6(usdtToRub(PROBE_CASH_MINOR, client), PROBE_CASH_MINOR, 'USDT');
  }
  if (row.from !== 'USDT') return null;
  const usdt = usdtForCashOut(PROBE_CASH_MINOR, row);
  if (usdt <= 0n) return null;
  return effectiveRateE6(usdtToRub(usdt, rubPerUsdtE6), PROBE_CASH_MINOR, row.to);
}

/* ─── Правка листа таблицей ───────────────────────────────────────────────────────────────
 * Тот же лист, но пришедший не текстом, а строками формы (админка правит пары прямо в таблице).
 * Проверки НЕ дублируются: и разбор вставки, и клиентская форма, и сервер-экшен зовут одни и те
 * же чистые функции ниже. Второй набор правил рано или поздно разошёлся бы с первым, а лист
 * говорит кассиру, сколько отдать клиенту, — расхождение здесь стоит денег.
 */

const DUPLICATE_PAIR = 'Направление уже есть в этом пункте';

/** Строка листа «как её ввели»: значение ещё текстом (русская запятая допустима). */
export interface SheetInputRow { from: string; to: string; kind: string; value: string }
export interface SheetInputPoint { code: string; rows: SheetInputRow[] }

/** Строка листа со значением в e6: процент ×1e6 для `pct`, курс ×1e6 для `abs`. */
export interface SheetDraftRow { from: string; to: string; kind: string; valueE6: bigint }
export interface SheetDraftPoint { code: string; rows: SheetDraftRow[] }

/** Претензия к листу: к строке (`row` — её индекс в пункте) или к пункту целиком (`row: null`). */
export interface SheetDraftIssue { point: string; row: number | null; reason: string }

/** Число из поля ввода: «47,90», «-0,70», «+1,165 %». Не число — null. */
export function parseSheetDecimalE6(value: string): bigint | null {
  return decimalE6(normalizeLine(value).replace(/\s+/g, '').replace(/%$/, ''));
}

/** Направление: одна сторона обязана быть USDT, сама в себя — нельзя. */
export function sheetPairProblem(from: string, to: string): string | null {
  if (from === to || (from !== 'USDT' && to !== 'USDT')) return 'Направление должно быть к USDT или от USDT';
  // 🔴 Рубли пункт только ПРИНИМАЕТ (клиент платит их по QR), выдаёт он валюту или тезер. Строка
  // «USDT -> RUB» означала бы обратную кассу — выдачу рублей за тезер, которой в этом канале нет.
  if (from === 'USDT' && to === 'RUB') return 'USDT → RUB не бывает: рубли пункт принимает по QR, а выдаёт валюту или тезер';
  return null;
}

/** Строка «клиентский тезер» — единственное направление, где выдача клиенту идёт в USDT. */
export function isClientUsdtRow(row: { from: string; to: string }): boolean {
  return row.from === 'RUB' && row.to === 'USDT';
}

/**
 * Стили котировки, которые валюта допускает: доллар — процентом к 1:1, лира и евро — курсом,
 * тезер клиенту (RUB → USDT) — и тем и другим (провайдер называет цену процентом, но набрать
 * рубли за 1 ₮ руками тоже законно). Форма «добавить пару» гасит по этому списку негодные
 * варианты. Проверку это не заменяет: правило живёт в `sheetValueProblem`, здесь — подсказка экрану.
 */
export function sheetKindsFor(from: string, to: string): readonly SheetRow['kind'][] {
  if (from === 'USD' || to === 'USD') return ['pct'];
  if (isClientUsdtRow({ from, to })) return ['pct', 'abs'];
  return ['abs'];
}

/** Стиль по умолчанию — первый допустимый: его форма и подставляет при выборе пары. */
export function sheetKindFor(from: string, to: string): SheetRow['kind'] {
  return sheetKindsFor(from, to)[0]!;
}

/**
 * Стиль котировки и диапазон значения: USD — только процент, TRY и EUR — только курс.
 * `kind` уже известен: во вставленном тексте его задаёт знак «%», в таблице — выбор в строке.
 */
export function sheetValueProblem(from: string, to: string, kind: string, valueE6: bigint): string | null {
  const other = from === 'USDT' ? to : from;
  const isPct = kind === 'pct';
  if (other === 'USD' && !isPct) return 'USD — только процент';
  if (other === 'TRY' && isPct) return 'TRY — только абсолютный курс, не процент';
  if (other === 'EUR' && isPct) return 'EUR — только абсолютный курс, не процент';
  // 🔴 Знак процента в строке тезера. У строк «USDT -> X» процент двигает КОЛИЧЕСТВО на руки
  // клиенту (−0,70 % = клиент получает меньше долларов), у «RUB -> USDT» — ЦЕНУ (+3 % = клиент
  // платит больше рублей за 1 ₮). В обоих случаях зарабатывает пункт, но знак «в пользу пункта»
  // получается разный, поэтому здесь он закреплён жёстко: надбавка только вверх. Минус означал
  // бы цену НИЖЕ курса платформы — пункт продавал бы тезер дешевле, чем платформа его ему считает.
  if (other === 'RUB' && isPct && valueE6 < 0n) return 'Процент к курсу платформы — только надбавка: минус означал бы цену ниже курса платформы';
  // 🔴 Потолок надбавки — своё число, а не общие 50 %. У этой строки два прочтения одного числа:
  // «40» в поле процента при задуманных 40 ₽ за 1 ₮ даёт клиенту цену на 40 % выше курса
  // платформы, и снизу такую опечатку не ловит никто — пол защищает лишь от убытка пункта.
  // На 20 % она упирается в отказ, который называет ОБА прочтения.
  if (other === 'RUB' && isPct && valueE6 > CLIENT_USDT_MAX_PCT_E6) return 'Надбавка тезера — не больше 20 %. Если это цена в рублях за 1 ₮, выберите вид «Курс»';
  if (isPct) {
    if (valueE6 % 10_000n !== 0n || valueE6 <= -50_000_000n || valueE6 >= 50_000_000n) return 'Процент — до сотых, по модулю меньше 50';
    return null;
  }
  if (valueE6 <= 0n) return 'Курс должен быть больше нуля';
  if (other === 'TRY' && (valueE6 < TRY_MIN_E6 || valueE6 > TRY_MAX_E6)) return 'TRY — курс должен быть от 5 до 500 лир за 1 USDT';
  if (other === 'EUR' && valueE6 < EUR_MIN_E6) return 'EUR — USDT за 1 евро, число больше 1';
  if (other === 'EUR' && valueE6 > EUR_MAX_E6) return 'EUR — USDT за 1 евро, курс должен быть не больше 3';
  if (other === 'RUB' && (valueE6 < RUB_MIN_E6 || valueE6 > RUB_MAX_E6)) return 'RUB → USDT — цена в рублях за 1 USDT, от 10 до 1000';
  return null;
}

/** Значение строки для хранения: процент → базисные пункты (−0,70 % → −70). */
export function sheetPctBp(valueE6: bigint): number {
  return Number(valueE6 / 10_000n);
}

export function sheetRowFromDraft(d: { from: SheetAsset; to: SheetAsset; kind: string; valueE6: bigint }): SheetRow {
  return d.kind === 'pct'
    ? { from: d.from, to: d.to, kind: 'pct', bp: sheetPctBp(d.valueE6) }
    : { from: d.from, to: d.to, kind: 'abs', rateE6: d.valueE6 };
}

/** Сохранённая строка → значение в e6 (обратно к тому, что вводят в поле). */
export function sheetRowValueE6(r: SheetRow): bigint {
  return r.kind === 'pct' ? BigInt(r.bp) * 10_000n : r.rateE6;
}

/** Значение для экрана и для канонического текста: русская запятая, не меньше двух знаков. */
export function formatSheetValueE6(valueE6: bigint): string {
  const neg = valueE6 < 0n;
  const abs = neg ? -valueE6 : valueE6;
  let frac = (abs % 1_000_000n).toString().padStart(6, '0');
  while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${neg ? '-' : ''}${abs / 1_000_000n},${frac}`;
}

/** Значение сохранённой строки для поля ввода: «-0,70», «47,90», «1,165». */
export function sheetRowValueText(r: SheetRow): string {
  return formatSheetValueE6(sheetRowValueE6(r));
}

/**
 * Проверка листа, собранного из строк формы. Возвращает претензии, привязанные к пункту и строке,
 * чтобы экран показал ошибку РЯДОМ с виноватой парой, а не одной кучей внизу.
 */
export function validateSheetDraft(points: SheetDraftPoint[]): SheetDraftIssue[] {
  const issues: SheetDraftIssue[] = [];
  const seenPoints = new Set<string>();
  let total = 0;
  for (const p of points) {
    const at = (row: number | null, reason: string) => void issues.push({ point: p.code, row, reason });
    if (!POINT_CODE.test(p.code) || CURRENCY_CODES.has(p.code)) {
      at(null, 'Код пункта — 2–5 латинских букв и не код валюты (ANT, IST)');
      continue;
    }
    if (seenPoints.has(p.code)) {
      at(null, 'Пункт уже есть в листе');
      continue;
    }
    seenPoints.add(p.code);
    if (p.rows.length === 0) {
      // Текст отличается от разбора вставки намеренно: у правки таблицей есть чем помочь —
      // вернуть пару или заменить лист целиком; у вставленного текста таких кнопок нет.
      at(null, 'У пункта нет ни одного курса — верните пару или уберите пункт через „Заменить вставкой“');
      continue;
    }
    const seen = new Set<string>();
    p.rows.forEach((r, i) => {
      total += 1;
      if (!CURRENCY_CODES.has(r.from) || !CURRENCY_CODES.has(r.to)) return at(i, `Валюта не поддерживается — ${SHEET_ASSETS.join(', ')}`);
      if (r.kind !== 'pct' && r.kind !== 'abs') return at(i, 'Вид курса — процент или курс');
      const pair = sheetPairProblem(r.from, r.to);
      if (pair) return at(i, pair);
      const key = `${r.from}->${r.to}`;
      if (seen.has(key)) return at(i, DUPLICATE_PAIR);
      seen.add(key);
      const bad = sheetValueProblem(r.from, r.to, r.kind, r.valueE6);
      if (bad) return at(i, bad);
    });
  }
  if (total === 0) issues.push({ point: '', row: null, reason: 'В листе нет ни одного курса' });
  return issues;
}

/**
 * Единственный вход для правки таблицей: числа из полей + те же правила, что у вставки.
 * `draft` отдаётся всегда — сервер берёт его, только когда `issues` пуст.
 */
export function checkSheetInput(points: SheetInputPoint[]): { issues: SheetDraftIssue[]; draft: SheetDraftPoint[] } {
  const numbers: SheetDraftIssue[] = [];
  /** `instead` — претензия к «%» важнее претензии к числу и ЗАМЕЩАЕТ её (см. ниже). */
  const percents: { issue: SheetDraftIssue; instead: boolean }[] = [];
  const draft: SheetDraftPoint[] = points.map((p) => {
    const code = p.code.trim().toUpperCase();
    return {
      code,
      rows: p.rows.map((r, i) => {
        const valueE6 = parseSheetDecimalE6(r.value);
        if (valueE6 === null) numbers.push({ point: code, row: i, reason: 'Число не распознано — например «47,90» или «-0,70»' });
        const from = r.from.trim().toUpperCase();
        const to = r.to.trim().toUpperCase();
        // 🔴 «%» в поле абсолютного курса молча срезать нельзя: «47,90%» и «47,90» — процент и
        // курс, то есть разные деньги на руки клиенту. Вставка такую строку отвергает — значит
        // и таблица обязана, тем же текстом: иначе один и тот же лист прошёл бы одним путём и
        // не прошёл другим.
        if (valueE6 !== null && r.kind !== 'pct' && r.value.includes('%')) {
          // У пары, где процент ЗАКОНЕН (тезер клиенту), «%» в поле цены — не опечатка в числе,
          // а невыбранный вид строки. Тогда эта претензия замещает претензию к числу: «цена от 10
          // до 1000» увела бы правку в сторону — человек начал бы менять 3 на 30, хотя менять
          // нужно вид. Там, где процент не применяется вовсе, всё как было: знак лишний.
          const pctAllowed = sheetKindsFor(from, to).includes('pct');
          const asPct = sheetValueProblem(from, to, 'pct', valueE6);
          const fallback = pctAllowed
            ? 'Для процента выберите вид «Процент» — иначе число читается как цена в рублях'
            : 'Процент здесь не применяется — уберите знак «%»';
          percents.push({ issue: { point: code, row: i, reason: asPct ?? fallback }, instead: pctAllowed && asPct === null });
        }
        return { from, to, kind: r.kind, valueE6: valueE6 ?? 0n };
      }),
    };
  });
  // Пока число не прочитано, проверять его диапазон нечем: вторая претензия к той же строке
  // только запутает — сперва пусть введут число.
  if (numbers.length > 0) return { issues: numbers, draft };
  const issues = validateSheetDraft(draft);
  // Претензия к «%» — последняя в очереди: если со строкой не так ещё и валюта, назвать нужно
  // её, а не знак процента. Исключение — `instead` выше: там знак и есть настоящая причина.
  for (const p of percents) {
    const at = issues.findIndex((i) => i.point === p.issue.point && i.row === p.issue.row);
    if (at < 0) issues.push(p.issue);
    else if (p.instead) issues[at] = p.issue;
  }
  return { issues, draft };
}

/**
 * Лист обратно в канонический текст — он и хранится в `raw_text`. Правка таблицей и утренняя
 * вставка кладут в базу ОДИН формат, поэтому лист читается одинаково, как бы его ни внесли,
 * и повторный разбор сохранённого текста даёт ровно те же строки.
 */
export function sheetDraftToText(points: SheetDraftPoint[]): string {
  return points
    .map((p) => [p.code, ...p.rows.map((r) => `${r.from} -> ${r.to}  ${formatSheetValueE6(r.valueE6)}${r.kind === 'pct' ? '%' : ''}`)].join('\n'))
    .join('\n\n') + '\n';
}
