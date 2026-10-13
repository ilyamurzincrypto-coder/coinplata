/**
 * (Волна10a) Разрешение тарифа мерчант-конверсии — НАША цена (маржа платформы) за приём
 * в валюте по каналу выдачи. Чистая функция: вход — строки тарифа мерчанта, валюта, канал, дата.
 *
 * Лестница разрешения (канон `tariffs` — «с даты», задним числом нельзя):
 *   1) точное совпадение (currency + channel), действующее на дату → берём с макс. valid_from;
 *   2) fallback канала: (currency, channel=null «любой»), макс. valid_from;
 *   3) дефолт платформы (fx_settings.defaultMarkupBp), если тарифа нет.
 *
 * Итоговый курс клиенту (в вызывающем коде) = базовый × (1 + price_bp + client_markup_bp мерчанта).
 * price_bp здесь — только НАША часть. Наценку мерчанта складывает вызывающий (реш.2).
 */
export interface ConversionTariffRow {
  currency: string;
  channel: string | null; // 'cash' | 'crypto' | null (любой)
  priceBp: number;
  validFrom: Date;
}

export function resolveConversionTariff(opts: {
  rows: ConversionTariffRow[];
  currency: string;
  channel: string | null;
  at: Date;
  fallbackBp: number;
}): { priceBp: number; matched: 'exact' | 'any-channel' | 'default' } {
  const eligible = opts.rows
    .filter((r) => r.currency === opts.currency && r.validFrom.getTime() <= opts.at.getTime())
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime()); // новее первым

  const exact = eligible.find((r) => r.channel === opts.channel);
  if (exact) return { priceBp: exact.priceBp, matched: 'exact' };

  // channel=null трактуем как «любой канал» — fallback, если точного нет.
  const anyChannel = eligible.find((r) => r.channel === null);
  if (anyChannel) return { priceBp: anyChannel.priceBp, matched: 'any-channel' };

  return { priceBp: opts.fallbackBp, matched: 'default' };
}

/** Целочисленное деление ВВЕРХ (ceil) для неотрицательных bigint. Округление в пользу платформы/мерчанта. */
function ceilDivPos(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * (Волна10b) Итоговый курс клиенту (₽ за 1 единицу валюты, ×1e6): базовый курс дня × (1 + price_bp
 * платформы + client_markup_bp мерчанта), где 1 = 10000 bp. Округление ВВЕРХ — в пользу платформы/мерчанта.
 * baseRubPerUnitE6 — курс дня из getRatesView (rubEquivE6). Только НАШ курс (без наценки мерчанта) =
 * finalMerchantRateE6 с clientMarkupBp=0.
 */
export function finalMerchantRateE6(opts: { baseRubPerUnitE6: bigint; priceBp: number; clientMarkupBp: number }): bigint {
  if (!Number.isInteger(opts.priceBp) || !Number.isInteger(opts.clientMarkupBp) || opts.priceBp < 0 || opts.clientMarkupBp < 0) {
    throw new Error('finalMerchantRateE6: bp должны быть целыми ≥ 0');
  }
  const bp = BigInt(10000 + opts.priceBp + opts.clientMarkupBp);
  return ceilDivPos(opts.baseRubPerUnitE6 * bp, 10000n);
}

/**
 * Рубли (копейки), которые платит клиент за сумму в валюте ввода, по зафиксированному курсу мерчанта.
 * displayAmountMinor — сумма в минорных единицах валюты ввода (100 $ = 10000). finalRateE6 — ₽/ед ×1e6.
 * Округление ВВЕРХ. rub-копейки = displayAmountMinor × finalRateE6 / 1e6.
 */
export function clientRubMinorForDisplay(displayAmountMinor: bigint, finalRateE6: bigint): bigint {
  return ceilDivPos(displayAmountMinor * finalRateE6, 1_000_000n);
}

/**
 * (Волна10b) Кап наценки мерчанта по умолчанию, если в fx_settings нет отдельного поля.
 * README-вопрос: закрепить ли коридор наценки на уровне fx_settings (нижняя/верхняя граница)?
 */
export const DEFAULT_CLIENT_MARKUP_CAP_BP = 1000; // 10%

/**
 * (Волна10b доработка) Per-валюта наценка мерчанта. Валюта со своей строкой → её значение;
 * иначе наследует общую (merchants.client_markup_bp). Наценка = 100% прибыль мерчанта.
 */
export interface CurrencyMarkupRow {
  currency: string;
  markupBp: number;
}
export function resolveMerchantMarkup(opts: {
  rows: CurrencyMarkupRow[];
  currency: string;
  generalBp: number;
}): { markupBp: number; source: 'own' | 'inherited' } {
  const own = opts.rows.find((r) => r.currency === opts.currency);
  if (own) return { markupBp: Math.max(0, own.markupBp), source: 'own' };
  return { markupBp: Math.max(0, opts.generalBp), source: 'inherited' };
}

/**
 * Floor наценки = денежная граница: итоговый курс мерчанта ≥ НАШЕГО итога (база + наша цена, в
 * которой уже НСПК+банк). В `finalMerchantRateE6` наценка сидит ПОВЕРХ priceBp, значит «≥ наш итог»
 * ⇔ markup_bp ≥ 0. 0 → курс мерчанта = наш ровно (он не зарабатывает, но и не в убыток). <0 запрещён.
 */
export const MARKUP_FLOOR_ERROR =
  'Курс не может быть ниже базового курса платформы — вы будете продавать в убыток';
export function validateMarkupBp(
  markupBp: number,
  capBp: number = DEFAULT_CLIENT_MARKUP_CAP_BP,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(markupBp) || markupBp < 0) return { ok: false, error: MARKUP_FLOOR_ERROR };
  if (markupBp > capBp) return { ok: false, error: `Наценка не может превышать ${capBp / 100}%` };
  return { ok: true };
}

/**
 * (Волна10b доработка) Заработок мерчанта в рублях-копейках с одной оплаты = (курс мерчанта −
 * наш курс) × сумма_в_валюте. Это дельта его наценки, полностью его прибыль (платформа с неё
 * ничего не берёт). ourRateE6 = finalMerchantRateE6(..., clientMarkupBp:0). Округление ВВЕРХ у
 * обоих курсов — разница неотрицательна при floor'е.
 */
export function merchantEarningMinor(opts: {
  displayAmountMinor: bigint;
  finalRateE6: bigint;
  ourRateE6: bigint;
}): bigint {
  const client = clientRubMinorForDisplay(opts.displayAmountMinor, opts.finalRateE6);
  const ours = clientRubMinorForDisplay(opts.displayAmountMinor, opts.ourRateE6);
  return client - ours;
}
