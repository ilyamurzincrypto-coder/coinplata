import { z } from 'zod';

/**
 * Валютная модель (фундамент Фазы 1 Волны №2 + задел Фазы 6). ДАННЫЕ живут в таблице
 * `currencies` (заводятся из UI администратором); здесь — ТИПЫ и ВАЛИДАЦИЯ.
 *
 * Принципы (эксперт):
 *  • СЕТЬ — часть кода валюты: `USDT-TRC20` ≠ `USDT-ERC20` ≠ `USDT-BEP20` — разные валюты.
 *  • ФОРМА (нал/безнал) — атрибут СЧЁТА, не валюты: RUB — одна валюта, но позиции в
 *    Капитале ведутся per-(валюта × форма) (нал-рубль и безнал-рубль — разные позиции).
 */

export type CurrencyKind = 'fiat' | 'crypto';
export type CryptoNetwork = 'TRC20' | 'ERC20' | 'BEP20';

export const CRYPTO_NETWORKS: readonly CryptoNetwork[] = ['TRC20', 'ERC20', 'BEP20'] as const;

/** Код фиата/газовой валюты — 3 заглавные буквы: RUB, USD, EUR, TRX, ETH. */
const FIAT_CODE = /^[A-Z]{3}$/;
/** Код крипто-токена — БАЗА-СЕТЬ (сеть ОБЯЗАТЕЛЬНА, она часть кода): USDT-TRC20, USDC-ERC20. */
const CRYPTO_CODE = /^[A-Z]{3,6}-(TRC20|ERC20|BEP20)$/;

/** zod: код валюты. Фиат ИЛИ крипта (с сетью или газовая). */
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => FIAT_CODE.test(c) || CRYPTO_CODE.test(c), 'Код валюты: фиат (RUB) или крипта (USDT-TRC20)');

/** Разбор кода: база + сеть (если есть). `USDT-TRC20` → {base:'USDT', network:'TRC20'}. */
export function parseCurrencyCode(code: string): { base: string; network: CryptoNetwork | null } {
  const [base, network] = code.split('-');
  return { base: base ?? code, network: (network as CryptoNetwork) ?? null };
}

/**
 * Числовой код валюты в номере счёта — ЕДИНЫЙ 4-значный сегмент (Волна №3, вердикт эксперта):
 *  • фиат — ISO-4217 числовой с ведущим нулём (0643 RUB, 0840 USD, 0978 EUR);
 *  • крипта — из служебного диапазона 0300–0399 (система присваивает последовательно).
 * Фиксированная ширина → выравнивание/сортировка номеров; парсер номера позиционный.
 */
// Крипто-диапазон 1300–1399 (13xx) — ВНЕ ISO by design. Причина: 0-паддинг ISO кладёт
// йену 0392 / тенге 0398 в 03xx → коллизия. ISO ≤ 999 (3 цифры) → padded ≤ 0999, поэтому
// 13xx гарантированно вне фиата. Система присваивает крипто-коды сама последовательно.
/**
 * 🔴 Знаков после запятой — ЗАПАСНОЙ вариант для мест, куда справочник ещё не дотянулся.
 *
 * Правда живёт в `currencies.minor_units` и правится из админки; где значение приходит из данных,
 * побеждает оно. Этот список нужен, чтобы экран не печатал деньги неверно, пока данные до него
 * не доехали.
 *
 * Появился 25.09: остаток мерчанта 218,5224 ₮ печатался как «21 852,24 ₮» — форматтер делил на 100
 * у ВСЕХ валют, кроме рубля, то есть ошибался в сто раз ровно на экране денег.
 */
export const DEFAULT_MINOR_UNITS: Record<string, number> = {
  RUB: 2,
  USD: 2,
  EUR: 2,
  TRY: 2,
  'USDT-TRC20': 4,
  'USDT-ERC20': 4,
  'USDT-BEP20': 4,
  TRX: 4,
  'TRX-TRC20': 4,
};

/** Знаков после запятой у валюты: известная — из списка, незнакомая крипта — 4, прочее — 2. */
export function defaultMinorUnits(code: string): number {
  const known = DEFAULT_MINOR_UNITS[code];
  if (known !== undefined) return known;
  return parseCurrencyCode(code).network !== null ? 4 : 2;
}

export const CRYPTO_NUM_MIN = 1300;
export const CRYPTO_NUM_MAX = 1399;
/** Число num_code в крипто-диапазоне? (фиат не может получить крипто-код и наоборот). */
export function isCryptoNumCode(numCode: string): boolean {
  const v = Number(numCode);
  return Number.isInteger(v) && v >= CRYPTO_NUM_MIN && v <= CRYPTO_NUM_MAX;
}
/** Нормализация к 4-значному коду с ведущими нулями. */
export function pad4NumCode(numCode: string | number): string {
  return String(numCode).padStart(4, '0');
}
/**
 * ISO-4217 числовой для распространённых фиатов — автоподстановка в мастере по коду.
 * (Факт-чек эксперту: ISO 301–399 активными валютами не заняты → крипто-диапазон свободен.)
 */
export const FIAT_ISO_NUM: Record<string, string> = {
  RUB: '643', USD: '840', EUR: '978', GBP: '826', CHF: '756', CNY: '156',
  JPY: '392', TRY: '949', KZT: '398', AED: '784', GEL: '981', UAH: '980',
  BYN: '933', AMD: '051', AZN: '944', UZS: '860', KGS: '417', TJS: '972',
};
/** Следующий свободный крипто-код в 0300–0399 (система присваивает, уникальность гарантирует). */
export function nextCryptoNumCode(used: readonly string[]): string {
  const taken = new Set(used.map((u) => Number(u)));
  for (let v = CRYPTO_NUM_MIN + 1; v <= CRYPTO_NUM_MAX; v++) if (!taken.has(v)) return pad4NumCode(v); // 1301 первый
  throw new Error('Крипто-диапазон 1300–1399 исчерпан');
}

/** zod-схема строки заведения валюты из UI (Капитал → «Добавить валюту»). numCode
 *  присваивает/проверяет сервер (авто-код крипты 13xx, ISO-подстановка фиата).
 *  Дискриминатор `isNative`: нативная монета сети (TRX/ETH) — контракт ЗАПРЕЩЁН;
 *  токен (USDT-TRC20 и пр.) — контракт ОБЯЗАТЕЛЕН. */
export const createCurrencySchema = z
  .object({
    code: currencyCodeSchema,
    title: z.string().trim().min(1).max(80),
    symbol: z.string().trim().min(1).max(4),
    minorUnits: z.coerce.number().int().min(0).max(18),
    numCode: z.string().trim().regex(/^\d{3,4}$/, 'Числовой код — 3–4 цифры').optional(),
    kind: z.enum(['fiat', 'crypto']),
    /** Нативная монета своей сети (TRX/ETH/BTC) — у неё нет контракта. Только для крипты. */
    isNative: z.boolean().default(false),
    /** Код сети токена (из справочника networks) — не enum-из-трёх (Правка 3). */
    network: z.string().trim().max(20).nullable().optional(),
    /** Адрес смарт-контракта токена — обязателен у токена, ЗАПРЕЩЁН у нативной/фиата. */
    contractAddress: z.string().trim().max(120).optional(),
    formDefault: z.enum(['cash', 'cashless']).default('cashless'),
    /** (Правка мастера 1) Формы, по которым создать позиции. Фиат — чекбоксы (дефолт обе),
     *  крипта — сервер форсит одну (crypto/безнал). Пусто → обе (нал+безнал). */
    forms: z.array(z.enum(['cash', 'cashless'])).optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const isToken = v.kind === 'crypto' && !v.isNative;
    // Контракт: токен → обязателен; нативная/фиат → запрещён (raise, если передан).
    if (isToken && !v.contractAddress) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contractAddress'], message: 'Для токена укажите адрес смарт-контракта' });
    }
    if (!isToken && v.contractAddress) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contractAddress'], message: v.kind === 'fiat' ? 'У фиата контракта нет' : 'У нативной монеты сети контракта нет' });
    }
    // Токен — сеть часть кода (обязательна); нативная — без сети.
    if (isToken && !v.network) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['network'], message: 'Сеть — часть кода токена (USDT-TRC20)' });
    }
    // Диапазон 1300–1399 зарезервирован за криптой: фиат туда нельзя, крипта — только туда.
    if (v.numCode) {
      const crypto = isCryptoNumCode(v.numCode);
      if (v.kind === 'fiat' && crypto) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numCode'], message: 'Код 1300–1399 зарезервирован за криптой' });
      if (v.kind === 'crypto' && !crypto) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numCode'], message: 'Крипто-код должен быть в диапазоне 1300–1399' });
    }
  });
export type CreateCurrencyInput = z.infer<typeof createCurrencySchema>;

/**
 * Числовые коды по умолчанию для сид-валют (для account-number, чист от БД). ЕДИНЫЙ
 * 4-значный формат: фиат = 0-паддинг ISO, крипта = диапазон 0300–0399 (вердикт эксперта).
 * Админ-заведённые валюты приносят num_code из БД; account-number принимает его явно.
 */
export const SEED_CURRENCY_NUM: Record<string, string> = {
  RUB: '0643',
  USD: '0840',
  EUR: '0978',
  'USDT-TRC20': '1301',
  TRX: '1302',
  'USDT-ERC20': '1303',
  ETH: '1304',
  'USDT-BEP20': '1305',
};

/** Символ валюты для отображения сумм (fallback — сам код, напр. USDT). Реальный символ
 *  берётся из справочника currencies (поле symbol); этот map — быстрый дефолт для UI. */
export const CURRENCY_SYMBOL: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', GBP: '£', CHF: '₣', CNY: '¥', JPY: '¥',
  TRY: '₺', KZT: '₸', AED: 'د.إ', 'USDT-TRC20': '₮', 'USDT-ERC20': '₮', 'USDT-BEP20': '₮',
  USDT: '₮', USDC: '$', TRX: 'TRX', ETH: 'Ξ', BTC: '₿', TON: 'TON', SOL: 'SOL', BNB: 'BNB',
};
/** Символ по коду или по БАЗЕ (USDT-TRC20 → ₮). Для автоподстановки в мастере. */
export function currencySymbol(code: string): string {
  if (CURRENCY_SYMBOL[code]) return CURRENCY_SYMBOL[code]!;
  const base = code.split('-')[0] ?? code;
  return CURRENCY_SYMBOL[base] ?? code;
}

/** Форма → цифра формы в номере счёта (01 нал, 02 безнал, 00 служебный/без формы). */
export function formDigit(form: 'cash' | 'cashless' | null | undefined): '00' | '01' | '02' {
  return form === 'cash' ? '01' : form === 'cashless' ? '02' : '00';
}
