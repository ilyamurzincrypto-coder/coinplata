/**
 * (CP PAY, Б2-2) Разложение «выставлено → тариф → к выплате» — ПРОЗРАЧНОСТЬ, не расчёт.
 *
 * Задача одна: сделать зачисленное число доказуемым с экрана. Поэтому на вход идут ТОЛЬКО
 * факты, уже записанные в леджер (сумма счёта, удержанная комиссия из проводок, зачисление
 * из проводок), и ни одна цифра здесь не пересчитывается заново.
 *
 * 🔴 Почему ставка берётся из УДЕРЖАННОГО, а не из справочника тарифов.
 * На единственной боевой конверсии эти два источника разошлись: действующий тариф мерчанта —
 * 5 %, а удержано было 2,5 % (правка оператора не применилась, причина закрыта PR-1). Экран,
 * который берёт ставку из тарифов, показывал «5 % = 2 186,30 ₽» — арифметически ложную пару,
 * потому что 5 % от 87 452,19 это 4 372,60. Разложение из проводок такую расходимость не
 * скрывает, а показывает: ставка выводится делением удержанного на сумму счёта и всегда
 * сходится с рублями рядом.
 *
 * 🔴 Почему комиссия в валюте — разность, а не деление.
 * Для зеркальной сделки (счёт выставлен сразу в валюте выплаты) комиссия в валюте берётся как
 * «сумма счёта − зачислено». Это тождество двух фактов: оно точное по построению, и цепочка на
 * экране сходится копейка-в-копейку. Пересчёт делением добавил бы своё округление, и экран мог
 * бы показать 1000 − 24,99 = 975,00 — три числа, которые не сходятся между собой.
 */
import type { Minor } from './money';
import { roundHalfEvenDiv } from './fx';
import { defaultMinorUnits } from './currencies';

/** Рубль — вторая сторона каждого перевода в разложении; знаков у него два. */
const RUB_SCALE = 100n;
/** Масштаб валюты счёта: из справочника, если пришёл; иначе запасной список ядра. */
const scaleOf = (currency: string, minorUnits?: number): bigint =>
  10n ** BigInt(minorUnits ?? defaultMinorUnits(currency));

export interface PayoutBreakdownInput {
  /** Рубли, которые заплатил клиент (invoices.amount_minor). */
  amountMinor: Minor;
  /** Удержанная комиссия эквайринга — ФАКТ, сумма проводок на счета дохода (платформы и агента). */
  feeMinor: Minor;
  /**
   * Счёт выставлен в валюте: сумма ввода и курс, замороженный в инвойсе. null → выставлен в ₽.
   * `baseRateE6`/`ourRateE6` — слои того же курса (ЦБ и наш, до наценки мерчанта): из них
   * собирается подпись «курс инвойса = ЦБ + спред», которую читатель проверяет глазами.
   */
  display: { currency: string; amountMinor: Minor; rateE6: bigint; baseRateE6?: bigint; ourRateE6?: bigint; minorUnits?: number } | null;
  /** Зачисление после автоконверсии — ФАКТ из проводок + курс сделки. null → зачислены рубли. */
  conversion: { currency: string; targetMinor: Minor; dealRateE6: bigint; minorUnits?: number } | null;
}

export type BreakdownStep = 'issued' | 'markup' | 'fee' | 'payout';

export interface BreakdownRow {
  step: BreakdownStep;
  minor: Minor;
  currency: string;
  /** Та же величина во второй валюте: счёт в валюте — сколько это рублей; комиссия — сколько это валюты. */
  alsoMinor?: Minor;
  alsoCurrency?: string;
  /** Курс, по которому строка получена (у «выставлено» в валюте и у «к выплате» через конверсию). */
  rateE6?: bigint;
  /** Счёт леджера, куда эта строка ушла — чтобы читатель мог провалиться в саму ногу. */
  accountId?: string;
}

/** Слои курса инвойса: ЦБ → наш спред → наценка мерчанта. Всё выведено из сохранённых курсов. */
export interface RateLayers {
  baseRateE6: bigint;
  /** Наш спред (bp), выведенный из пары база → наш курс. */
  spreadBp: number;
  ourRateE6: bigint;
  /** Наценка мерчанта клиентам (bp), выведенная из пары наш курс → курс счёта. 0 — её нет. */
  merchantMarkupBp: number;
  finalRateE6: bigint;
}

/**
 * (Пакет 5) Заработок МЕРЧАНТА на его собственном клиенте — третий процент сделки.
 *
 * Три процента разводились весь блок 2, и путать их нельзя:
 *   тариф эквайринга — что мерчант платит нам;
 *   наш спред — что мы зарабатываем на курсе;
 *   наценка мерчанта — что зарабатывает ОН, продавая клиенту валюту дороже нашего курса.
 * Последняя к деньгам платформы отношения не имеет: эти рубли клиент заплатил мерчанту.
 *
 * Показывается ВСЕГДА, включая ноль: «нет строки» и «наценки нет» — разные утверждения, и
 * читатель не обязан их различать по отсутствию. Ноль — это ответ, а не пустое место.
 */
export interface MerchantEarning {
  /** Заработок мерчанта на этой операции, в рублях. 0 — наценки не было. */
  minor: Minor;
  /** Та же наценка в bp (наш курс → курс счёта). 0 — наценки не было. */
  bp: number;
  /** Почему ноль: рублёвый счёт наценки не несёт вовсе, у валютного она может быть нулевой. */
  basis: 'ruble_invoice' | 'currency_invoice';
}

export interface PayoutBreakdown {
  rows: BreakdownRow[];
  /** Ставка, выведенная ИЗ УДЕРЖАННОГО (bp). null — комиссия не начислялась. */
  effectiveRateBp: number | null;
  /** Цепочка на экране сходится сама с собой. false → показать предупреждение, не прятать. */
  converges: boolean;
  /** Зеркальная сделка: счёт выставлен сразу в валюте выплаты. */
  mirror: boolean;
  /**
   * Слои курса инвойса — для подписи «87,4522 = ЦБ 83,2878 + спред 5 %». null, если инвойс
   * рублёвый или слои не сохранены.
   *
   * 🔴 Для ЗЕРКАЛА спред нельзя брать из exchange_details.markup_bp: там по коду записан ноль,
   * потому что курс пришёл готовым из инвойса. Но пара «база / наш курс» сохранена, и спред из
   * неё выводится точно. Поэтому зеркало подписывается «спред зашит в курс», а не «спред 0 %».
   */
  rateLayers: RateLayers | null;
  /** (Пакет 5) Заработок мерчанта на клиенте. Присутствует всегда — в том числе нулевой. */
  merchantEarning: MerchantEarning;
}

/**
 * Ставка из удержанного: комиссия ÷ сумма счёта, до целого bp, половина вверх.
 * Ровно та величина, которую можно проверить калькулятором по двум числам на экране.
 */
export function effectiveRateBp(feeMinor: Minor, amountMinor: Minor): number | null {
  if (amountMinor <= 0n || feeMinor <= 0n) return null;
  return Number(((feeMinor * 20_000n) / amountMinor + 1n) / 2n);
}

/** Спред (bp) из пары курсов: (верхний / нижний − 1). Половина вверх, отрицательный → 0. */
export function spreadBpFromRates(lowerE6: bigint, upperE6: bigint): number {
  if (lowerE6 <= 0n || upperE6 <= lowerE6) return 0;
  return Number(((upperE6 - lowerE6) * 20_000n / lowerE6 + 1n) / 2n);
}

/** |a − b| ≤ tol — допуск в одну минорную единицу там, где в цепочке участвует деление на курс. */
function within(a: Minor, b: Minor, tol: bigint): boolean {
  const d = a - b;
  return (d < 0n ? -d : d) <= tol;
}

/**
 * Заработок мерчанта на ОДНОЙ операции, в рублях.
 *
 * Разность двух фактов: что заплатил клиент по курсу счёта − сколько то же самое стоило бы по
 * НАШЕМУ курсу. Не «сумма × наценка»: обе величины уже округлены при выставлении, умножение дало
 * бы третье число, не сходящееся ни с одним из них.
 *
 * Функция общая для карточки операции и для сводки в кабинете. Это принципиально: одна и та же
 * величина, посчитанная в двух местах, обязательно разойдётся — за этот класс в блоке 2 заплачено
 * шестью правками. Сводка обязана быть суммой ровно тех чисел, что мерчант видит по операциям.
 */
export function merchantEarningOnInvoice(p: {
  amountMinor: Minor;
  displayAmountMinor: Minor | null;
  ourRateE6: bigint | null;
  /**
   * 🔴 Валюта счёта — обязательна. Её знаки масштабируют перевод «валюта → рубли», и без них
   * экран врал молча: у четырёхзначной валюты `display × курс / 1e6` завышало рублёвую оценку
   * В СТО РАЗ, разность уходила в минус и функция ВСЕГДА возвращала 0. Наружу это выглядело
   * невинно — «Вы заработали 0,00 ₽» по любому тезерному счёту, — а в деньгах означало, что
   * наценка мерчанта не зачислялась ему (`mirrorCreditInTarget`), а доставалась доходу обмена.
   */
  displayCurrency: string;
  /** Знаков у валюты счёта (`currencies.minor_units`). Нет — запасной список ядра. */
  displayMinorUnits?: number;
}): Minor {
  if (p.displayAmountMinor === null || p.ourRateE6 === null || p.ourRateE6 <= 0n) return 0n;
  const atOurRate = (p.displayAmountMinor * p.ourRateE6 * RUB_SCALE) / (1_000_000n * scaleOf(p.displayCurrency, p.displayMinorUnits));
  const diff = p.amountMinor - atOurRate;
  return diff > 0n ? diff : 0n;
}

export function buildPayoutBreakdown(p: PayoutBreakdownInput): PayoutBreakdown {
  if (p.amountMinor < 0n || p.feeMinor < 0n) throw new Error('buildPayoutBreakdown: суммы не могут быть отрицательными');

  const conv = p.conversion;
  const mirror = Boolean(conv && p.display && p.display.currency === conv.currency);
  const rows: BreakdownRow[] = [];

  // 1. ВЫСТАВЛЕНО. Счёт в валюте показываем в валюте — так его и выставляли, — а рубли даём рядом.
  rows.push(
    p.display
      ? { step: 'issued', minor: p.display.amountMinor, currency: p.display.currency, rateE6: p.display.rateE6, alsoMinor: p.amountMinor, alsoCurrency: 'RUB' }
      : { step: 'issued', minor: p.amountMinor, currency: 'RUB' },
  );

  // 1б. НАЦЕНКА МЕРЧАНТА (только зеркало). (правка владельца 15.09.2026) Зеркало зачисляет наценку
  //     мерчанту в валюте — строка нужна, иначе «выставлено − тариф» не даёт зачисленного. Рубли
  //     наценки — той же функцией, что сводка «Вы заработали»; в валюту — по нашему курсу вниз.
  const ourForMarkup = p.display ? p.display.ourRateE6 ?? p.display.rateE6 : null;
  // Масштаб валюты счёта — один на всё разложение: и вперёд (рубли → валюта), и обратно.
  const dScale = p.display ? scaleOf(p.display.currency, p.display.minorUnits) : RUB_SCALE;
  const markupRub = mirror && ourForMarkup
    ? merchantEarningOnInvoice({ amountMinor: p.amountMinor, displayAmountMinor: p.display!.amountMinor, ourRateE6: ourForMarkup, displayCurrency: p.display!.currency, ...(p.display!.minorUnits !== undefined ? { displayMinorUnits: p.display!.minorUnits } : {}) })
    : 0n;
  // Округление — как у зачисления (`mirrorCreditInTarget`, режим по умолчанию bankers): иначе тариф
  // в валюте, выведенный разностью, разъедется на цент.
  let markupInTarget = mirror && markupRub > 0n ? roundHalfEvenDiv(markupRub * dScale * 1_000_000n, ourForMarkup! * RUB_SCALE) : 0n;
  if (markupInTarget > 0n) {
    // Зеркальные сделки до 15.09.2026 зачисляли БЕЗ наценки (она уходила в доход обмена). Разложение
    // показывает факты: если зачисленное сходится с тарифом без наценки — строки наценки в пути
    // денег нет, иначе экран нарисовал бы деньги, которых мерчант не получил.
    const legacyFee = p.display!.amountMinor - conv!.targetMinor;
    const legacyBack = (legacyFee * conv!.dealRateE6 * RUB_SCALE) / (1_000_000n * dScale);
    if (legacyFee >= 0n && within(legacyBack, p.feeMinor, conv!.dealRateE6 / 1_000_000n + 1n)) markupInTarget = 0n;
  }
  if (markupInTarget > 0n) {
    rows.push({ step: 'markup', minor: markupInTarget, currency: conv!.currency, alsoMinor: markupRub, alsoCurrency: 'RUB' });
  }

  // 2. ТАРИФ. Всегда удержан в рублях (comission эквайринга рублёвая). У зеркала показываем его
  //    ещё и в валюте — как разность фактов, чтобы строка «к выплате» сошлась точно:
  //    тариф_вал = выставлено + наценка_вал − зачислено.
  const feeInTarget = mirror ? p.display!.amountMinor + markupInTarget - conv!.targetMinor : null;
  rows.push({
    step: 'fee',
    minor: p.feeMinor,
    currency: 'RUB',
    ...(feeInTarget !== null ? { alsoMinor: feeInTarget, alsoCurrency: conv!.currency } : {}),
  });

  // 3. К ВЫПЛАТЕ.
  rows.push(
    conv
      ? { step: 'payout', minor: conv.targetMinor, currency: conv.currency, rateE6: conv.dealRateE6 }
      : { step: 'payout', minor: p.amountMinor - p.feeMinor, currency: 'RUB' },
  );

  // Сходимость — своя для каждой формы сделки; проверяем то, что читатель видит глазами.
  let converges: boolean;
  if (!conv) {
    // выставлено ₽ − тариф ₽ = к выплате ₽
    converges = true; // построено вычитанием, иначе быть не может
  } else if (mirror) {
    // выставлено вал. − тариф вал. = к выплате вал. (точно по построению) И тариф в валюте,
    // возвращённый в рубли ПО КУРСУ СДЕЛКИ, совпадает с удержанным.
    //
    // Курс здесь именно сделки, а не счёта: когда у мерчанта есть своя наценка клиентам, курс
    // счёта выше нашего, и обратный пересчёт по нему разошёлся бы законно. Допуск — половина
    // цента в рублях: комиссия в валюте округлена до целого цента, и это её честная цена.
    const feeBack = (feeInTarget! * conv!.dealRateE6 * RUB_SCALE) / (1_000_000n * dScale);
    // Наценка в валюте округлена своим режимом при зачислении — ещё один цент допуска.
    converges = feeInTarget! >= 0n && within(feeBack, p.feeMinor, conv!.dealRateE6 / 1_000_000n + 1n);
  } else {
    // выставлено ₽ − тариф ₽ = нетто ₽, нетто по курсу сделки = к выплате.
    const cScale = scaleOf(conv.currency, conv.minorUnits);
    const expected = ((p.amountMinor - p.feeMinor) * cScale * 1_000_000n) / (conv.dealRateE6 * RUB_SCALE);
    converges = within(expected, conv.targetMinor, 1n);
  }

  // Слои курса — только когда инвойс валютный и база сохранена.
  let rateLayers: RateLayers | null = null;
  if (p.display?.baseRateE6 && p.display.baseRateE6 > 0n) {
    const our = p.display.ourRateE6 ?? p.display.rateE6;
    rateLayers = {
      baseRateE6: p.display.baseRateE6,
      spreadBp: spreadBpFromRates(p.display.baseRateE6, our),
      ourRateE6: our,
      merchantMarkupBp: spreadBpFromRates(our, p.display.rateE6),
      finalRateE6: p.display.rateE6,
    };
  }

  // (Пакет 5) Заработок мерчанта = что клиент заплатил − сколько это стоило бы по НАШЕМУ курсу.
  // Считаем разностью двух фактов, а не «сумма × наценка»: обе величины уже округлены при
  // выставлении, и умножение на процент дало бы третье число, не сходящееся ни с одним из них.
  let merchantEarning: MerchantEarning;
  if (!p.display || !rateLayers) {
    merchantEarning = { minor: 0n, bp: 0, basis: 'ruble_invoice' };
  } else {
    merchantEarning = {
      minor: merchantEarningOnInvoice({ amountMinor: p.amountMinor, displayAmountMinor: p.display.amountMinor, ourRateE6: rateLayers.ourRateE6, displayCurrency: p.display.currency, ...(p.display.minorUnits !== undefined ? { displayMinorUnits: p.display.minorUnits } : {}) }),
      bp: rateLayers.merchantMarkupBp,
      basis: 'currency_invoice',
    };
  }

  return { rows, effectiveRateBp: effectiveRateBp(p.feeMinor, p.amountMinor), converges, mirror, rateLayers, merchantEarning };
}

/**
 * (Б2-2b) Заработок платформы на сделке — ВТОРОЕ тождество, отдельно от пути денег мерчанта.
 *
 * 🔴 Почему отдельно, а не одной колонкой с удержаниями мерчанта. Затраты банка и НСПК с мерчанта
 * НЕ удерживались: он заплатил только тариф. Банк платформа платит из своей доли. Поставь эти
 * рубли в колонку «удержано с мерчанта» — и тождество «выставлено = к выплате + удержания»
 * перестанет сходиться, а именно ради его сходимости всё и делается.
 *
 * Сходимость здесь своя и проверяемая глазами: «клиент заплатил − валюта мерчанта по курсу ЦБ»
 * должно равняться сумме двух заработков. Допуск — пара копеек: нога позиции пишется усечением.
 */
export interface PlatformEarningsInput {
  /** Рубли клиента (та же сумма, что в разложении). */
  clientPaidMinor: Minor;
  /** Эквайринг (счёт 370) — ФАКТ из проводок. */
  acquiringMinor: Minor;
  /** Курсовая маржа (счёт 374) — ФАКТ из проводок. */
  spreadMinor: Minor;
  /** Затраты банка и НСПК (счёт 372) — ФАКТ, положительным числом. */
  bankFeeMinor: Minor;
  /** Во сколько нам обошлась выданная валюта по базовому курсу: сумма × база / 1e6. */
  payoutBaseValueMinor: Minor;
}

export interface PlatformEarnings {
  /** Рубли клиента — левая половина видимого тождества. */
  clientPaidMinor: Minor;
  acquiringMinor: Minor;
  spreadMinor: Minor;
  bankFeeMinor: Minor;
  /** Чистыми = эквайринг + спред − банк. */
  netMinor: Minor;
  /** Валовая маржа из курсов = клиент − стоимость валюты по ЦБ. */
  grossMarginMinor: Minor;
  /** Валовая маржа сходится с суммой двух заработков. */
  converges: boolean;
}

export function buildPlatformEarnings(p: PlatformEarningsInput): PlatformEarnings {
  const gross = p.clientPaidMinor - p.payoutBaseValueMinor;
  return {
    clientPaidMinor: p.clientPaidMinor,
    acquiringMinor: p.acquiringMinor,
    spreadMinor: p.spreadMinor,
    bankFeeMinor: p.bankFeeMinor,
    netMinor: p.acquiringMinor + p.spreadMinor - p.bankFeeMinor,
    grossMarginMinor: gross,
    converges: within(gross, p.acquiringMinor + p.spreadMinor, 2n),
  };
}
