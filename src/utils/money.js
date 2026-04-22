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
  // Работаем с достаточной внутренней точностью
  const internal = 8;
  const aMinor = Math.round(a * Math.pow(10, internal));
  const rMinor = Math.round(r * Math.pow(10, internal));
  // Результат в 2*internal минорных единицах
  const productHigh = aMinor * rMinor;
  // Приводим к outputPrecision
  const divisor = Math.pow(10, 2 * internal - outputPrecision);
  return Math.round(productHigh / divisor) / Math.pow(10, outputPrecision);
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

export const curSymbol = (c) => ({ USD: "$", EUR: "€", TRY: "₺", USDT: "₮", GBP: "£", RUB: "₽" }[c] || "");

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
  const EPS = 0.01;
  const exceedsInput = remaining < -EPS;

  return { remaining, feeInCurIn, consumed, exceedsInput };
}

// Авто-расчёт прибыли от разницы между rate менеджера и рыночным rate.
//
// Для каждого output:
//   market_rate = getRate(curIn, out.currency)  // сколько outCurrency за 1 unit curIn
//   actual_rate = out.rate
//   marginInOut = out.amount × (actual_rate − market_rate) / actual_rate
//     — положительное если actual > market (office заработал на марже)
//     — отрицательное иначе
// ВНИМАНИЕ: в exchange формате "rate" = сколько outCurrency за 1 curIn.
//   actual_rate > market_rate значит клиент получает больше outCurrency за тот же input,
//   что для офиса означает меньшую маржу. Значит правильно: marginInOut positive когда
//   actual < market (менеджер дал хуже рыночного).
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
