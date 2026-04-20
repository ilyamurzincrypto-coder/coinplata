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
