import { describe, expect, it } from 'vitest';
import {
  cashOutForUsdt, checkSheetInput, clientUsdtRateE6, effectiveRateE6, formatSheetValueE6, parseRateSheet, parseSheetDecimalE6,
  sheetDraftToText, sheetEffectiveRateE6, sheetKindFor, sheetKindsFor, sheetRowValueText, sheetValueProblem, usdtForCashOut,
  quotedRateE6, validateSheetDraft, type SheetAsset, type SheetDraftPoint, type SheetInputPoint, type SheetRow,
} from './point-rate-sheet';
import { merchantUsdtRateE6, providerRateE6, usdtToRubMinor } from './qr-provider';
import { ceilDivBig } from './fx';

const SHEET = `ANT
USDT -> USD  -0,70%
USD -> USDT  -0,30%
USDT -> TRY  47,90
TRY -> USDT  48,8
USDT -> EUR  1,165
EUR -> USDT  1,145



IST
USDT -> USD  -0,60%
USD -> USDT  -0,10%
USDT -> TRY  47,90
TRY -> USDT  48,8
USDT -> EUR  1,165
EUR -> USDT  1,145`;

describe('утренний лист пункта', () => {
  it('разбирает оба пункта, по 6 направлений', () => {
    const r = parseRateSheet(SHEET);
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.points)).toEqual(['ANT', 'IST']);
    expect(r.points.ANT).toHaveLength(6);
    expect(r.points.ANT![0]).toEqual({ from: 'USDT', to: 'USD', kind: 'pct', bp: -70 });
    expect(r.points.ANT![2]).toEqual({ from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 47_900_000n });
    expect(r.points.IST![0]).toEqual({ from: 'USDT', to: 'USD', kind: 'pct', bp: -60 });
  });

  it('неразрывные пробелы и пустые строки не мешают', () => {
    const r = parseRateSheet('ANT\u00A0\nUSDT\u00A0->\u00A0TRY\u00A0\u00A047,90\n');
    expect(r.errors).toEqual([]);
    expect(r.points.ANT).toHaveLength(1);
  });

  it('ошибки построчно: мусор, строка до пункта, повтор направления', () => {
    const r = parseRateSheet('USDT -> TRY 47,90\nANT\nUSDT -> TRY 47,90\nUSDT -> TRY 48\nкурс хороший');
    expect(r.errors.map((e) => e.line)).toEqual([1, 4, 5]);
  });

  it('выдача по листу ANT за 99,9393 USDT', () => {
    const ant = parseRateSheet(SHEET).points.ANT!;
    const row = (to: string) => ant.find((x) => x.from === 'USDT' && x.to === to)!;
    expect(cashOutForUsdt(999_393n, row('USD'))).toBe(9_923n); // 99,23 $
    expect(cashOutForUsdt(999_393n, row('TRY'))).toBe(478_709n); // 4 787,09 ₺
    expect(cashOutForUsdt(999_393n, row('EUR'))).toBe(8_578n); // 85,78 €
  });

  it('обратно: 100,00 $ наличными требуют 100,7050 USDT', () => {
    const ant = parseRateSheet(SHEET).points.ANT!;
    const usd = ant.find((x) => x.from === 'USDT' && x.to === 'USD')!;
    expect(usdtForCashOut(10_000n, usd)).toBe(1_007_050n);
    expect(cashOutForUsdt(1_007_050n, usd)).toBeGreaterThanOrEqual(10_000n);
  });
});

describe('котировки по валюте — только свой стиль', () => {
  // Каждый лист держит валидную вторую строку — точка не должна оставаться пустой,
  // иначе сработает отдельная проверка «У пункта нет ни одного курса» и собьёт счётчик ошибок.
  it('USD — только процент, абсолютное число ошибка', () => {
    const r = parseRateSheet('ANT\nUSDT -> USD 0,99\nUSD -> USDT -0,30%');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(2);
    expect(r.points.ANT).toEqual([{ from: 'USD', to: 'USDT', kind: 'pct', bp: -30 }]);
  });

  it('TRY — только абсолютный курс, процент ошибка', () => {
    const r = parseRateSheet('ANT\nUSDT -> TRY -1%\nTRY -> USDT 48,8');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(2);
    expect(r.points.ANT).toEqual([{ from: 'TRY', to: 'USDT', kind: 'abs', rateE6: 48_800_000n }]);
  });

  it('TRY вне диапазона 5..500 — ошибка', () => {
    const low = parseRateSheet('ANT\nUSDT -> TRY 4,99\nTRY -> USDT 48,8');
    expect(low.errors).toHaveLength(1);
    const high = parseRateSheet('ANT\nUSDT -> TRY 500,01\nTRY -> USDT 48,8');
    expect(high.errors).toHaveLength(1);
    const okLow = parseRateSheet('ANT\nUSDT -> TRY 5');
    expect(okLow.errors).toEqual([]);
    const okHigh = parseRateSheet('ANT\nUSDT -> TRY 500');
    expect(okHigh.errors).toEqual([]);
  });

  it('EUR — только абсолютный курс, «USDT за 1 евро», меньше 1 — ошибка', () => {
    const r = parseRateSheet('ANT\nUSDT -> EUR 0,858\nEUR -> USDT 1,145');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(2);
    expect(r.points.ANT).toEqual([{ from: 'EUR', to: 'USDT', kind: 'abs', rateE6: 1_145_000n }]);
  });

  it('EUR вне диапазона 1..3 сверху — ошибка', () => {
    const r = parseRateSheet('ANT\nUSDT -> EUR 3,5\nEUR -> USDT 1,145');
    expect(r.errors).toHaveLength(1);
  });
});

describe('заголовок пункта', () => {
  it('не может совпадать с валютным кодом (USDT/USD/TRY/EUR)', () => {
    const r = parseRateSheet('USD\nUSDT -> TRY 47,90');
    expect(r.errors.map((e) => e.line)).toEqual([1, 2]);
    expect(r.points).toEqual({});
  });

  it('допускает конечное двоеточие', () => {
    const r = parseRateSheet('ANT:\nUSDT -> TRY 47,90');
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.points)).toEqual(['ANT']);
    expect(r.points.ANT).toHaveLength(1);
  });
});

describe('пункт без единого курса', () => {
  it('ошибка на строке заголовка, когда следом идёт другой заголовок', () => {
    const r = parseRateSheet('ANT\nIST\nUSDT -> TRY 47,90');
    expect(r.errors).toEqual([{ line: 1, text: 'ANT', reason: 'У пункта нет ни одного курса' }]);
    expect(r.points.ANT).toEqual([]);
    expect(r.points.IST).toHaveLength(1);
  });

  it('ошибка на строке заголовка, когда пункт последний в листе', () => {
    const r = parseRateSheet('ANT\nUSDT -> TRY 47,90\nIST');
    expect(r.errors).toEqual([{ line: 3, text: 'IST', reason: 'У пункта нет ни одного курса' }]);
    expect(r.points.ANT).toHaveLength(1);
    expect(r.points.IST).toEqual([]);
  });

  it('повторный заголовок пункта сразу за первым — не ложная ошибка «пусто», если курс придёт позже', () => {
    const r = parseRateSheet('ANT\nANT\nUSDT -> TRY 47,90');
    expect(r.errors).toEqual([]);
    expect(r.points.ANT).toHaveLength(1);
  });

  it('повторный заголовок пункта после другого пункта — курсы обеих частей суммируются, ошибки нет', () => {
    const r = parseRateSheet('ANT\nIST\nUSDT -> TRY 47,90\nANT\nUSDT -> TRY 47,90');
    expect(r.errors).toEqual([]);
    expect(r.points.ANT).toHaveLength(1);
    expect(r.points.IST).toHaveLength(1);
  });
});

describe('нормализация вставленного текста', () => {
  it('убирает zero-width/BOM, длинное тире и минус, стрелку →, принимает + перед числом', () => {
    const raw = '\ufeff\u200bANT\nUSDT\u2192TRY\u00a0+47,90\nUSD->USDT\u00a0\u22120,30%';
    const r = parseRateSheet(raw);
    expect(r.errors).toEqual([]);
    expect(r.points.ANT).toEqual([
      { from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 47_900_000n },
      { from: 'USD', to: 'USDT', kind: 'pct', bp: -30 },
    ]);
  });

  it('en dash (U+2013) вместо минуса тоже нормализуется', () => {
    const raw = 'ANT\nUSDT -> USD \u20130,70%';
    const r = parseRateSheet(raw);
    expect(r.errors).toEqual([]);
    expect(r.points.ANT).toEqual([{ from: 'USDT', to: 'USD', kind: 'pct', bp: -70 }]);
  });
});

/**
 * Правка листа таблицей ходит через ТЕ ЖЕ правила, что и вставка текста. Проверяем сами правила
 * (кто виноват — пункт или строка) и обратную дорогу «строки → канонический текст → разбор»:
 * она держит равенство двух путей. Если текст перестанет разбираться в те же строки, лист,
 * поправленный в таблице, и лист, вставленный утром, начнут означать разное — а лист говорит
 * кассиру, сколько отдать клиенту.
 */
describe('правка листа таблицей: общие правила', () => {
  const pct = (from: string, to: string, percent: number): SheetDraftPoint['rows'][number] => ({ from, to, kind: 'pct', valueE6: BigInt(Math.round(percent * 1_000_000)) });
  const abs = (from: string, to: string, rate: number): SheetDraftPoint['rows'][number] => ({ from, to, kind: 'abs', valueE6: BigInt(Math.round(rate * 1_000_000)) });
  const draft = (rows: SheetDraftPoint['rows'], code = 'ANT'): SheetDraftPoint[] => [{ code, rows }];

  it('верный лист — ни одной претензии', () => {
    expect(validateSheetDraft(draft([pct('USDT', 'USD', -0.7), abs('USDT', 'TRY', 47.9), abs('EUR', 'USDT', 1.145)]))).toEqual([]);
  });

  it('повтор пары внутри пункта — претензия ко второй строке', () => {
    expect(validateSheetDraft(draft([pct('USDT', 'USD', -0.7), pct('USDT', 'USD', -0.5)]))).toEqual([
      { point: 'ANT', row: 1, reason: 'Направление уже есть в этом пункте' },
    ]);
  });

  it('та же пара в ДРУГОМ пункте — не повтор', () => {
    expect(validateSheetDraft([{ code: 'ANT', rows: [pct('USDT', 'USD', -0.7)] }, { code: 'IST', rows: [pct('USDT', 'USD', -0.7)] }])).toEqual([]);
  });

  it('неизвестная валюта — претензия к строке', () => {
    expect(validateSheetDraft(draft([abs('USDT', 'GBP', 1.2)]))).toEqual([
      { point: 'ANT', row: 0, reason: 'Валюта не поддерживается — USDT, USD, TRY, EUR, RUB' },
    ]);
  });

  it('направление не через USDT — претензия к строке', () => {
    expect(validateSheetDraft(draft([abs('USD', 'TRY', 40)]))[0]!.reason).toBe('Направление должно быть к USDT или от USDT');
  });

  it('пустой лист и пункт без строк', () => {
    expect(validateSheetDraft([])).toEqual([{ point: '', row: null, reason: 'В листе нет ни одного курса' }]);
    expect(validateSheetDraft(draft([]))).toEqual([
      { point: 'ANT', row: null, reason: 'У пункта нет ни одного курса — верните пару или уберите пункт через „Заменить вставкой“' },
      { point: '', row: null, reason: 'В листе нет ни одного курса' },
    ]);
  });

  it('🔴 «%» в поле абсолютного курса отвергается тем же текстом, что и при вставке', () => {
    // 47,90% и 47,90 — процент и курс: срежь знак молча, и касса выдаст клиенту другие деньги.
    const table = checkSheetInput([{ code: 'ANT', rows: [{ from: 'USDT', to: 'TRY', kind: 'abs', value: '47,90%' }] }]);
    expect(table.issues).toEqual([{ point: 'ANT', row: 0, reason: 'TRY — только абсолютный курс, не процент' }]);
    expect(parseRateSheet('ANT\nUSDT -> TRY 47,90%').errors[0]!.reason).toBe(table.issues[0]!.reason);

    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'USDT', to: 'EUR', kind: 'abs', value: '1,165 %' }] }]).issues[0]!.reason)
      .toBe('EUR — только абсолютный курс, не процент');
    // В процентной строке знак «%» законен — поле и без него подписано процентом.
    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'USDT', to: 'USD', kind: 'pct', value: '-0,70%' }] }]).issues).toEqual([]);
    // И претензия к «%» не заслоняет более важную — о валюте.
    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'USDT', to: 'GBP', kind: 'abs', value: '1,20%' }] }]).issues)
      .toEqual([{ point: 'ANT', row: 0, reason: 'Валюта не поддерживается — USDT, USD, TRY, EUR, RUB' }]);
  });

  it('sheetKindFor называет тот стиль, который примет проверка', () => {
    for (const other of ['USD', 'TRY', 'EUR'] as SheetAsset[]) {
      for (const [from, to] of [['USDT', other], [other, 'USDT']] as [SheetAsset, SheetAsset][]) {
        const kind = sheetKindFor(from, to);
        const value = kind === 'pct' ? -700_000n : other === 'EUR' ? 1_165_000n : 47_900_000n;
        expect(sheetValueProblem(from, to, kind, value)).toBeNull();
      }
    }
  });

  it('код пункта — 2–5 латинских букв и не код валюты', () => {
    expect(validateSheetDraft(draft([pct('USDT', 'USD', -0.7)], 'USD'))[0]!.reason).toContain('Код пункта');
    expect(validateSheetDraft(draft([pct('USDT', 'USD', -0.7)], 'A'))[0]!.reason).toContain('Код пункта');
    expect(validateSheetDraft(draft([pct('USDT', 'USD', -0.7)], 'ANTALYA'))[0]!.reason).toContain('Код пункта');
  });

  it('пункт дважды в одном листе — претензия к пункту', () => {
    expect(validateSheetDraft([{ code: 'ANT', rows: [pct('USDT', 'USD', -0.7)] }, { code: 'ANT', rows: [abs('USDT', 'TRY', 47.9)] }])).toEqual([
      { point: 'ANT', row: null, reason: 'Пункт уже есть в листе' },
    ]);
  });

  it('процент: стиль валюты и диапазон — те же, что при вставке', () => {
    expect(validateSheetDraft(draft([abs('USDT', 'USD', 0.99)]))[0]!.reason).toBe('USD — только процент');
    expect(validateSheetDraft(draft([pct('USDT', 'TRY', -1)]))[0]!.reason).toBe('TRY — только абсолютный курс, не процент');
    expect(validateSheetDraft(draft([pct('USDT', 'EUR', -1)]))[0]!.reason).toBe('EUR — только абсолютный курс, не процент');
    expect(validateSheetDraft(draft([pct('USDT', 'USD', 50)]))[0]!.reason).toBe('Процент — до сотых, по модулю меньше 50');
    expect(validateSheetDraft(draft([pct('USDT', 'USD', -50)]))[0]!.reason).toBe('Процент — до сотых, по модулю меньше 50');
    expect(validateSheetDraft(draft([{ from: 'USDT', to: 'USD', kind: 'pct', valueE6: -701_000n }]))[0]!.reason).toBe('Процент — до сотых, по модулю меньше 50');
    expect(validateSheetDraft(draft([pct('USDT', 'USD', 49.99)]))).toEqual([]);
  });

  it('курс: ноль и границы TRY/EUR — те же, что при вставке', () => {
    expect(validateSheetDraft(draft([abs('USDT', 'TRY', 0)]))[0]!.reason).toBe('Курс должен быть больше нуля');
    expect(validateSheetDraft(draft([abs('USDT', 'TRY', 4.99)]))[0]!.reason).toBe('TRY — курс должен быть от 5 до 500 лир за 1 USDT');
    expect(validateSheetDraft(draft([abs('USDT', 'TRY', 500.01)]))[0]!.reason).toBe('TRY — курс должен быть от 5 до 500 лир за 1 USDT');
    expect(validateSheetDraft(draft([abs('USDT', 'EUR', 0.858)]))[0]!.reason).toBe('EUR — USDT за 1 евро, число больше 1');
    expect(validateSheetDraft(draft([abs('USDT', 'EUR', 3.5)]))[0]!.reason).toBe('EUR — USDT за 1 евро, курс должен быть не больше 3');
    expect(validateSheetDraft(draft([abs('USDT', 'TRY', 5), abs('USDT', 'EUR', 3)]))).toEqual([]);
  });

  it('значение из поля: запятая, плюс, пробелы и знак процента', () => {
    expect(parseSheetDecimalE6('47,90')).toBe(47_900_000n);
    expect(parseSheetDecimalE6(' -0,70 %')).toBe(-700_000n);
    expect(parseSheetDecimalE6('+1,165')).toBe(1_165_000n);
    expect(parseSheetDecimalE6('')).toBeNull();
    expect(parseSheetDecimalE6('сорок семь')).toBeNull();
  });

  it('нечитаемое число — одна претензия к строке, диапазон при этом не проверяется', () => {
    const points: SheetInputPoint[] = [{ code: 'ANT', rows: [{ from: 'USDT', to: 'TRY', kind: 'abs', value: 'сорок' }] }];
    expect(checkSheetInput(points).issues).toEqual([{ point: 'ANT', row: 0, reason: 'Число не распознано — например «47,90» или «-0,70»' }]);
  });

  it('checkSheetInput приводит код пункта и валюты к верхнему регистру', () => {
    const { issues, draft: d } = checkSheetInput([{ code: ' ant ', rows: [{ from: 'usdt', to: 'try', kind: 'abs', value: '47,90' }] }]);
    expect(issues).toEqual([]);
    expect(d).toEqual([{ code: 'ANT', rows: [{ from: 'USDT', to: 'TRY', kind: 'abs', valueE6: 47_900_000n }] }]);
  });

  it('значение на экране: запятая, минимум два знака, хвостовые нули срезаны', () => {
    expect(formatSheetValueE6(-700_000n)).toBe('-0,70');
    expect(formatSheetValueE6(47_900_000n)).toBe('47,90');
    expect(formatSheetValueE6(1_165_000n)).toBe('1,165');
    expect(formatSheetValueE6(48_800_000n)).toBe('48,80');
    expect(sheetRowValueText({ from: 'USDT', to: 'USD', kind: 'pct', bp: -70 })).toBe('-0,70');
    expect(sheetRowValueText({ from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 47_900_000n })).toBe('47,90');
  });

  it('строки → канонический текст → разбор дают ровно те же строки', () => {
    const parsed = parseRateSheet(SHEET);
    const points: SheetDraftPoint[] = Object.entries(parsed.points).map(([code, rows]) => ({
      code,
      rows: rows.map((r) => ({ from: r.from, to: r.to, kind: r.kind, valueE6: r.kind === 'pct' ? BigInt(r.bp) * 10_000n : r.rateE6 })),
    }));
    const again = parseRateSheet(sheetDraftToText(points));
    expect(again.errors).toEqual([]);
    expect(again.points).toEqual(parsed.points);
  });
});

describe('курс сделки: рубли клиента ÷ выданное', () => {
  const ant = parseRateSheet(SHEET).points.ANT!;
  const row = (to: string) => ant.find((x) => x.from === 'USDT' && x.to === to)!;
  /** Курс платформы «₽ за 1 USDT»: ЦБ 84,2362 + 3 % надбавки провайдера. */
  const PLATFORM_E6 = 86_763_286n;
  /** Как сумму клиенту считает касса (usdtToRubMinor, вверх) — та же функция, что в бою. */
  const toRub = (usdtMinor: bigint, rateE6: bigint) => usdtToRubMinor(usdtMinor, rateE6, 'ceil');
  /** Курс, каким его печатает экран (4 знака вверх), — ровно то, что читает человек. */
  const shown = (rateE6: bigint | null) => (rateE6 === null ? null : quotedRateE6(rateE6));

  it('абсолютная строка (TRY 47,90) даёт 1,8113 ₽ за ₺', () => {
    const rate = sheetEffectiveRateE6(PLATFORM_E6, row('TRY'), toRub);
    expect(Number(rate) / 1e6).toBeCloseTo(1.8113, 4);
  });

  it('процентная строка (USD −0,70 %) считается тем же путём: 87,3749 ₽ за $', () => {
    const rate = sheetEffectiveRateE6(PLATFORM_E6, row('USD'), toRub);
    expect(Number(rate) / 1e6).toBeCloseTo(87.3749, 3);
  });

  it('евро котируется USDT за 1 евро — курс растёт, а не падает', () => {
    const rate = sheetEffectiveRateE6(PLATFORM_E6, row('EUR'), toRub); // 1,165 USDT за €
    expect(Number(rate) / 1e6).toBeCloseTo(101.08, 2);
  });

  it('🔴 касса и кабинет показывают ОДИН курс: 2 000,00 ₺ на кассе = строка листа в кабинете', () => {
    for (const to of ['TRY', 'USD', 'EUR'] as const) {
      const r = row(to);
      // Путь кассы: клиент получает 2 000 единиц → сколько USDT → сколько рублей платит.
      const cash = 200_000n;
      const usdt = usdtForCashOut(cash, r);
      const rub = toRub(usdt, PLATFORM_E6);
      const atDesk = effectiveRateE6(rub, cash, to);
      // Путь кабинета: та же строка листа против курса платформы.
      expect(shown(atDesk)).toEqual(shown(sheetEffectiveRateE6(PLATFORM_E6, r, toRub)));
    }
  });

  it('числа эталона сходятся: 2 000,00 ₺ — это 41,7537 USDT и 3 622,69 ₽ по курсу 1,8114', () => {
    const usdt = usdtForCashOut(200_000n, row('TRY'));
    expect(usdt).toBe(417_537n);
    const rub = toRub(usdt, PLATFORM_E6);
    expect(rub).toBe(362_269n);
    // Точный курс 1,811345 экран печатает вверх — 1,8114: меньше кассового чека он обещать не вправе.
    expect(shown(effectiveRateE6(rub, 200_000n, 'TRY'))).toBe(1_811_400n);
  });

  it('округление курса — только вверх', () => {
    expect(effectiveRateE6(3n, 2_000_000n, 'TRY')).toBe(2n); // ровно 1,5 → 2
    expect(effectiveRateE6(1n, 300n, 'TRY')).toBe(3_334n); // 3,333… → 3 334
    expect(effectiveRateE6(2n, 300n, 'TRY')).toBe(6_667n); // 6,666… → 6 667
    expect(quotedRateE6(1_811_301n)).toBe(1_811_400n); // и печать 4 знаков — тоже вверх
    expect(quotedRateE6(1_811_400n)).toBe(1_811_400n); // ровное значение не растёт
  });

  it('🔴 названный курс никогда не обещает меньше, чем касса берёт с клиента', () => {
    const provider = providerRateE6(84_236_200n, 300); // ЦБ + 3 % надбавки провайдера
    // 19 807,00 ₺ — случай из ревью: к оплате 35 877,27 ₽, а курс «к ближайшему» обещал 35 876,41 ₽.
    const amounts = [1n, 7n, 99n, 1_000n, 12_345n, 200_000n, 1_980_700n, 99_999_999n];
    for (const priceBp of [0, 250]) {
      const merchantRate = merchantUsdtRateE6(provider, priceBp);
      for (const to of ['TRY', 'USD', 'EUR'] as const) {
        const r = row(to);
        for (const cash of amounts) {
          const charged = toRub(usdtForCashOut(cash, r), merchantRate);
          const quoted = quotedRateE6(effectiveRateE6(charged, cash, to)!);
          // Клиент умножает названный курс на свою выдачу — результат обязан покрыть «К оплате».
          expect(ceilDivBig(quoted * cash, 1_000_000n)).toBeGreaterThanOrEqual(charged);
        }
      }
    }
  });

  it('делить нечего — курса нет', () => {
    expect(effectiveRateE6(0n, 200_000n, 'TRY')).toBeNull();
    expect(effectiveRateE6(362_269n, 0n, 'TRY')).toBeNull();
    expect(sheetEffectiveRateE6(0n, row('TRY'), toRub)).toBeNull();
  });

  it('обратная строка листа (USD -> USDT) выдачи не задаёт', () => {
    const back = ant.find((x) => x.from === 'USD' && x.to === 'USDT')!;
    expect(sheetEffectiveRateE6(PLATFORM_E6, back, toRub)).toBeNull();
  });
});

/**
 * Клиентский тезер — строка «RUB -> USDT». Пункт выдаёт клиенту не наличные, а USDT, и цену за
 * него провайдер называет так: «курс платформы + процент». Проверяем то, что стоит денег: какие
 * строки лист принимает, куда смотрит знак процента, что ниже курса платформы цены не бывает —
 * и что касса с кабинетом называют клиенту ОДНО число.
 */
describe('клиентский тезер: RUB → USDT', () => {
  /** Курс платформы «₽ за 1 USDT»: ЦБ 84,2362 + 3 % надбавки провайдера. */
  const PLATFORM_E6 = 86_763_286n;
  const toRub = (usdtMinor: bigint, rateE6: bigint) => usdtToRubMinor(usdtMinor, rateE6, 'ceil');
  const pct = (percent: number): SheetRow => ({ from: 'RUB', to: 'USDT', kind: 'pct', bp: Math.round(percent * 100) });
  const abs = (rub: number): SheetRow => ({ from: 'RUB', to: 'USDT', kind: 'abs', rateE6: BigInt(Math.round(rub * 1_000_000)) });
  const row = (rows: SheetRow[]) => [{ code: 'ANT', rows: rows.map((r) => ({ from: r.from, to: r.to, kind: r.kind, valueE6: r.kind === 'pct' ? BigInt(r.bp) * 10_000n : r.rateE6 })) }];

  it('вставка принимает обе записи строки — процент и цену в рублях', () => {
    const r = parseRateSheet('ANT\nRUB -> USDT  3%\nUSDT -> TRY  47,90\n\nIST\nRUB -> USDT  89,50');
    expect(r.errors).toEqual([]);
    expect(r.points.ANT![0]).toEqual({ from: 'RUB', to: 'USDT', kind: 'pct', bp: 300 });
    expect(r.points.IST![0]).toEqual({ from: 'RUB', to: 'USDT', kind: 'abs', rateE6: 89_500_000n });
    // Обратная дорога через канонический текст — как у остальных строк листа.
    expect(parseRateSheet(sheetDraftToText(row([pct(3)]))).points.ANT).toEqual([pct(3)]);
    expect(parseRateSheet(sheetDraftToText(row([abs(89.5)]))).points.ANT).toEqual([abs(89.5)]);
  });

  it('🔴 рубли не становятся валютой выдачи: USDT → RUB и RUB → TRY отвергаются', () => {
    const back = parseRateSheet('ANT\nUSDT -> RUB  87,50\nUSDT -> TRY  47,90');
    expect(back.errors).toHaveLength(1);
    expect(back.errors[0]!.reason).toBe('USDT → RUB не бывает: рубли пункт принимает по QR, а выдаёт валюту или тезер');
    expect(back.points.ANT).toEqual([{ from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 47_900_000n }]);
    expect(validateSheetDraft([{ code: 'ANT', rows: [{ from: 'RUB', to: 'TRY', kind: 'abs', valueE6: 2_000_000n }] }])[0]!.reason)
      .toBe('Направление должно быть к USDT или от USDT');
  });

  it('🔴 знак процента: только надбавка вверх — минус отвергают и вставка, и таблица', () => {
    const minus = 'Процент к курсу платформы — только надбавка: минус означал бы цену ниже курса платформы';
    expect(parseRateSheet('ANT\nRUB -> USDT  -3%\nUSDT -> TRY  47,90').errors[0]!.reason).toBe(minus);
    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'RUB', to: 'USDT', kind: 'pct', value: '-3' }] }]).issues[0]!.reason).toBe(minus);
    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'RUB', to: 'USDT', kind: 'pct', value: '3' }] }]).issues).toEqual([]);
    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'RUB', to: 'USDT', kind: 'pct', value: '0' }] }]).issues).toEqual([]);
  });

  it('🔴 потолок надбавки 20 %: «40» в поле процента отвергают оба пути, называя оба прочтения', () => {
    // 40 в поле процента при задуманных 40 ₽ за ₮ — цена клиенту на 40 % выше курса платформы.
    const cap = 'Надбавка тезера — не больше 20 %. Если это цена в рублях за 1 ₮, выберите вид «Курс»';
    expect(parseRateSheet('ANT\nRUB -> USDT  40%\nUSDT -> TRY  47,90').errors[0]!.reason).toBe(cap);
    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'RUB', to: 'USDT', kind: 'pct', value: '40' }] }]).issues[0]!.reason).toBe(cap);
    expect(validateSheetDraft(row([pct(20.01)]))[0]!.reason).toBe(cap);
    expect(validateSheetDraft(row([pct(20)]))).toEqual([]); // ровно 20 — граница открыта
  });

  it('цена в рублях: ноль и промах в разряде отсекаются', () => {
    const range = 'RUB → USDT — цена в рублях за 1 USDT, от 10 до 1000';
    expect(validateSheetDraft(row([abs(0)]))[0]!.reason).toBe('Курс должен быть больше нуля');
    expect(validateSheetDraft(row([abs(8.75)]))[0]!.reason).toBe(range);
    expect(validateSheetDraft(row([abs(8750)]))[0]!.reason).toBe(range);
    expect(validateSheetDraft(row([abs(87.5)]))).toEqual([]);
  });

  it('форма предлагает оба стиля, а «%» в поле цены зовёт переключить вид, а не стереть знак', () => {
    expect(sheetKindsFor('RUB', 'USDT')).toEqual(['pct', 'abs']);
    expect(sheetKindFor('RUB', 'USDT')).toBe('pct'); // цену провайдер называет процентом
    for (const kind of sheetKindsFor('RUB', 'USDT')) {
      expect(sheetValueProblem('RUB', 'USDT', kind, kind === 'pct' ? 3_000_000n : 87_500_000n)).toBeNull();
    }
    expect(checkSheetInput([{ code: 'ANT', rows: [{ from: 'RUB', to: 'USDT', kind: 'abs', value: '3 %' }] }]).issues)
      .toEqual([{ point: 'ANT', row: 0, reason: 'Для процента выберите вид «Процент» — иначе число читается как цена в рублях' }]);
  });

  it('процент — надбавка к курсу платформы: +3 % значит на 3 % больше рублей за 1 ₮', () => {
    expect(clientUsdtRateE6(PLATFORM_E6, pct(3))).toBe(89_366_185n); // 86,763286 × 1,03, вверх
    expect(clientUsdtRateE6(PLATFORM_E6, pct(0))).toBe(PLATFORM_E6); // ровно по себестоимости — можно
    expect(clientUsdtRateE6(PLATFORM_E6, abs(89.5))).toBe(89_500_000n); // цена руками — как набрали
  });

  it('🔴 ниже курса платформы касса строку не берёт — проверка на ЧТЕНИИ, не только на сохранении', () => {
    expect(clientUsdtRateE6(PLATFORM_E6, abs(80))).toBeNull(); // пункт продавал бы тезер себе в убыток
    expect(clientUsdtRateE6(PLATFORM_E6, pct(-1))).toBeNull(); // в лист не попадёт, но чтение не доверяет
    expect(clientUsdtRateE6(PLATFORM_E6, abs(86.763286))).toBe(PLATFORM_E6); // ровно курс платформы — граница открыта
    expect(clientUsdtRateE6(0n, abs(89.5))).toBeNull(); // курса платформы нет — цены нет
    expect(clientUsdtRateE6(PLATFORM_E6, { from: 'USDT', to: 'TRY', kind: 'abs', rateE6: 47_900_000n })).toBeNull();
    expect(sheetEffectiveRateE6(PLATFORM_E6, abs(80), toRub)).toBeNull(); // и в кабинете такой строки нет
  });

  it('🔴 касса и кабинет называют клиенту ОДИН курс на тех же входах', () => {
    for (const r of [pct(3), abs(89.5)]) {
      const client = clientUsdtRateE6(PLATFORM_E6, r)!;
      const inCabinet = quotedRateE6(sheetEffectiveRateE6(PLATFORM_E6, r, toRub)!);
      for (const usdt of [1_000_000n, 100_000_000n]) { // 100 ₮ и 10 000 ₮ — ровные суммы
        expect(quotedRateE6(effectiveRateE6(toRub(usdt, client), usdt, 'USDT')!)).toBe(inCabinet);
      }
      // Мелкие суммы округляются В ПОЛЬЗУ КЛИЕНТА НЕ БЫВАЕТ: курс на чеке не ниже витринного.
      for (const usdt of [1n, 137n, 5_000n, 417_537n]) {
        const rub = toRub(usdt, client);
        const quoted = quotedRateE6(effectiveRateE6(rub, usdt, 'USDT')!);
        expect(quoted).toBeGreaterThanOrEqual(inCabinet);
        // Клиент умножает названный курс на выданный тезер — результат обязан покрыть «К оплате».
        expect(ceilDivBig(quoted * usdt, 100_000_000n)).toBeGreaterThanOrEqual(rub);
      }
    }
  });
});
