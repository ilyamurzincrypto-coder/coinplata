// src/utils/money.js
// Точные денежные вычисления — всё считается в целых числах (минорные единицы),
// чтобы избежать классических float-ошибок вроде 0.1 + 0.2 !== 0.3.

const PRECISION = {
  USD: 2,
  EUR: 2,
  USDT: 2,
  TRY: 2,
  GBP: 2,
  RUB: 2,
};

export function precisionOf(currency) {
  return PRECISION[currency] ?? 2;
}

// "123.45" -> 12345 (в минорных единицах при precision=2)
export function toMinor(value, precision = 2) {
  if (value === "" || value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  if (isNaN(n)) return 0;
  // Используем Math.round, а не | 0, чтобы корректно ловить погрешности типа 1.005
  return Math.round(n * Math.pow(10, precision));
}

// 12345 -> "123.45"
export function fromMinor(minor, precision = 2) {
  const s = Math.round(minor).toString();
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor)).toString().padStart(precision + 1, "0");
  const intPart = abs.slice(0, abs.length - precision);
  const fracPart = abs.slice(abs.length - precision);
  return precision > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

// Число в минорных -> число в мажорных (для отображения/сохранения)
export function minorToNumber(minor, precision = 2) {
  return minor / Math.pow(10, precision);
}

// amount * rate с точностью через минорные единицы
export function multiplyAmount(amount, rate, outputPrecision = 2) {
  const a = typeof amount === "number" ? amount : parseFloat(String(amount).replace(",", "."));
  const r = typeof rate === "number" ? rate : parseFloat(String(rate).replace(",", "."));
  if (isNaN(a) || isNaN(r)) return 0;
  // Работаем с достаточной внутренней точностью (8 знаков на множитель).
  const internal = 8;
  const aMinor = Math.round(a * Math.pow(10, internal));
  const rMinor = Math.round(r * Math.pow(10, internal));
  // aMinor и rMinor по отдельности — безопасные целые, но их произведение
  // (до 2*internal знаков) легко вылетает за MAX_SAFE_INTEGER на больших суммах
  // → раньше Math.round(productHigh/divisor) давал float-артефакт (77226000.00000001).
  // Умножаем и делим в BigInt — точно на любом масштабе (S5).
  if (!Number.isFinite(aMinor) || !Number.isFinite(rMinor)) return 0;
  const productHigh = BigInt(aMinor) * BigInt(rMinor);
  const shift = 2 * internal - outputPrecision; // divisor = 10^shift
  const rounded =
    shift <= 0
      ? productHigh * 10n ** BigInt(-shift)
      : roundHalfUpBig(productHigh, 10n ** BigInt(shift));
  return Number(rounded) / Math.pow(10, outputPrecision);
}

// Деление BigInt с округлением к ближайшему (половина — вверх, как Math.round).
// den > 0 и кратен 10 (чётный) → den/2 точно. Отрицательные — как Math.round
// (ties к +∞): floor((num + den/2) / den).
function roundHalfUpBig(num, den) {
  const shifted = num + den / 2n;
  let q = shifted / den; // BigInt делит с усечением к нулю
  if (shifted < 0n && q * den !== shifted) q -= 1n; // корректируем усечение до floor
  return q;
}

// Процент от суммы: amount * (percent / 100)
export function percentOf(amount, percent, outputPrecision = 2) {
  const a = typeof amount === "number" ? amount : parseFloat(String(amount).replace(",", "."));
  const p = typeof percent === "number" ? percent : parseFloat(String(percent).replace(",", "."));
  if (isNaN(a) || isNaN(p)) return 0;
  return multiplyAmount(a, p / 100, outputPrecision);
}

// Применение минимальной комиссии
export function applyMinFee(fee, minFee = 10) {
  const f = typeof fee === "number" ? fee : parseFloat(String(fee).replace(",", "."));
  if (isNaN(f) || f <= 0) return minFee;
  return Math.max(f, minFee);
}

// Форматирование для отображения
export function fmt(n, currency) {
  if (n === "" || n === null || n === undefined || isNaN(n)) return "—";
  const precision = currency === "TRY" ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  }).format(n);
}

// Hardcoded fallback для well-known валют — используется пока
// CurrenciesProvider не зарегистрировал dict (первый рендер до hydration).
const HARDCODED_SYMBOLS = { USD: "$", EUR: "€", TRY: "₺", USDT: "₮", GBP: "£", RUB: "₽" };

// Module-local registry для symbols из БД. CurrenciesProvider вызывает
// registerCurrencyDict({USD:{symbol:"$"},...}) на каждое изменение
// currencies — чтобы curSymbol(code) в неконтекстных utilities видел
// свежие данные (например CHF после редактирования в Master Data).
let REGISTERED_DICT = null;

export function registerCurrencyDict(dict) {
  // Принимаем {code: {symbol, type, ...}} или {code: "sym"} для гибкости.
  REGISTERED_DICT = dict || null;
}

export const curSymbol = (c) => {
  if (REGISTERED_DICT && REGISTERED_DICT[c]) {
    const entry = REGISTERED_DICT[c];
    const sym = typeof entry === "string" ? entry : entry?.symbol;
    if (sym) return sym;
  }
  return HARDCODED_SYMBOLS[c] || "";
};

// ----------------------------------------------------------------
// computeRemaining — единая точка расчёта остатка транзакции
// ----------------------------------------------------------------
// Возвращает остаток в валюте curIn после вычитания всех outputs и комиссии.
// Правило:
//   remaining = amtIn
//               − Σ (output.amount / output.rate)          // каждый output обратно в curIn
//               − feeInCurIn (только если feeType === "USD", абсолютная)
//
// Для feeType === "%" комиссию НЕ вычитаем — она уже заложена в маржу курса.
//
// Возвращает { remaining, feeInCurIn, consumed, exceedsInput }
//   — remaining: число в curIn (может быть отрицательным → exceedsInput=true)
//   — consumed: сумма всех outputs в curIn (без fee)
//   — feeInCurIn: сколько curIn занимает комиссия (0 если feeType="%")
//   — exceedsInput: boolean, true если распределили больше чем amtIn
export function computeRemaining({ amtIn, curIn, outputs, fee, feeType, getRate }) {
  const inNum = parseFloat(amtIn) || 0;

  const consumed = (outputs || []).reduce((sum, o) => {
    const amt = parseFloat(o.amount) || 0;
    const r = parseFloat(o.rate) || 0;
    if (amt <= 0 || r <= 0) return sum;
    return sum + amt / r;
  }, 0);

  // Одностороннее OUT (нет IN) — нечего «превышать», remaining не имеет
  // смысла. Без этого short-circuit canSubmit блокировал submit:
  // remaining=-consumed<0 → exceedsInput=true → кнопка disabled.
  if (inNum <= 0) {
    return { remaining: 0, feeInCurIn: 0, consumed, exceedsInput: false };
  }

  let feeInCurIn = 0;
  const feeNum = parseFloat(fee) || 0;
  if (feeType === "USD" && feeNum > 0) {
    if (curIn === "USD") {
      feeInCurIn = feeNum;
    } else {
      // fee в долларах → сколько это curIn? Делим на rate(curIn → USD).
      // rate(X, USD) = сколько USD в 1 X. Значит 1 USD = 1 / rate(X, USD) единиц X.
      const r = typeof getRate === "function" ? getRate(curIn, "USD") : undefined;
      if (r && r > 0) {
        feeInCurIn = feeNum / r;
      }
    }
  }
  // Для feeType === "%" fee уже сидит в маржинальном курсе output'ов — не вычитаем

  const remaining = inNum - consumed - feeInCurIn;
  // EPS относительный к inNum — толерантность для exceedsInput. Раньше
  // было 0.01% (для $234 ловило превышение в 0.03), и блокировало
  // обычные обменные сделки где OUT округляется относительно курса.
  // 1% — стандартная толерантность для обменника: курс гуляет в этом
  // диапазоне, и сумма OUT может слегка перекрывать IN. Минимум $0.01
  // чтобы для совсем мелких сумм всё равно ловилась явная ошибка.
  const EPS = Math.max(0.01, Math.abs(inNum) * 0.01);
  const exceedsInput = remaining < -EPS;

  return { remaining, feeInCurIn, consumed, exceedsInput };
}

// Net output amount: gross − feeOut. Fee сперва конвертируется из USD в output currency.
//
//   grossOut = amtIn × rate
//   feeOut   = convert(feeUsd, USD → outputCurrency)
//   netOut   = max(0, grossOut − feeOut)
//
// Используется в ExchangeForm для авто-заполнения первого output так, чтобы
// "You receive" было финальной суммой с учётом комиссии (не gross).
export function computeNetOutput({ amtIn, rate, feeUsd, outputCurrency, getRate }) {
  const a = typeof amtIn === "number" ? amtIn : parseFloat(String(amtIn || "").replace(",", "."));
  const r = typeof rate === "number" ? rate : parseFloat(String(rate || "").replace(",", "."));
  if (!a || a <= 0 || !r || r <= 0) return 0;
  const precision = outputCurrency === "TRY" ? 0 : 2;
  const gross = multiplyAmount(a, r, precision);
  const fee = typeof feeUsd === "number" ? feeUsd : parseFloat(String(feeUsd || "").replace(",", "."));
  if (!fee || fee <= 0) return gross;
  let feeOut = 0;
  if (outputCurrency === "USD") {
    feeOut = fee;
  } else if (typeof getRate === "function") {
    const r2 = getRate("USD", outputCurrency);
    if (r2 && r2 > 0) feeOut = multiplyAmount(fee, r2, precision);
  }
  const net = gross - feeOut;
  return net > 0 ? Math.round(net * Math.pow(10, precision)) / Math.pow(10, precision) : 0;
}

// Авто-расчёт прибыли от разницы между rate менеджера и рыночным rate.
//
// В exchange-формате "rate" = сколько outCurrency за 1 curIn. Считаем через
// «сколько curIn забрали на этот output»:
//   market_rate = getRate(curIn, out.currency)
//   actual_rate = out.rate
//   margin_in_curIn = out.amount/actual_rate − out.amount/market_rate
//
// ЗНАК (единственно верный, совпадает с кодом ниже и тестом money.test.js):
//   actual_rate < market_rate  ⇒  клиент получил МЕНЬШЕ рынка за тот же input
//                               ⇒  офис заработал  ⇒  margin ПОЛОЖИТЕЛЬНА.
//   actual_rate > market_rate  ⇒  клиенту дали лучше рынка  ⇒  margin отрицательна.
//   (Прежняя шапка утверждала обратное — это была ошибка комментария, не кода. B8.)
//
// Возвращает суммарную маржу в USD (суммируем margin по всем outputs).
// Если market rate недоступен для какого-то output — его margin = 0.
export function computeProfitFromRates({ amtIn, curIn, outputs, getRate }) {
  const inNum = parseFloat(amtIn) || 0;
  if (inNum <= 0 || typeof getRate !== "function") return 0;

  let marginUsd = 0;

  (outputs || []).forEach((o) => {
    const amt = parseFloat(o.amount) || 0;
    const actualRate = parseFloat(o.rate) || 0;
    if (amt <= 0 || actualRate <= 0 || !o.currency) return;

    const marketRate = getRate(curIn, o.currency);
    if (!marketRate || marketRate <= 0) return;

    // Сколько curIn забрали на этот output:
    //   consumed_curIn_actual = amt / actualRate
    //   consumed_curIn_at_market = amt / marketRate
    //   margin_in_curIn = consumed_curIn_actual − consumed_curIn_at_market
    //     положительно если actualRate < marketRate (клиент получил меньше чем при рыночном)
    const marginInCurIn = amt / actualRate - amt / marketRate;

    // Конвертируем в USD через rate(curIn → USD)
    let marginInUsd;
    if (curIn === "USD") {
      marginInUsd = marginInCurIn;
    } else {
      const toUsd = getRate(curIn, "USD");
      if (!toUsd || toUsd <= 0) return; // не можем оценить в USD — пропускаем
      marginInUsd = marginInCurIn * toUsd;
    }
    marginUsd += marginInUsd;
  });

  return Math.round(marginUsd * 100) / 100;
}
