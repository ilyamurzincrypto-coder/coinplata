/**
 * Валидация российских идентификаторов организаций по контрольным цифрам
 * (не только формат). Отсекает опечатки до платформенной проверки KYB.
 * Чистые функции: только строка цифр на вход.
 *
 * ИНН: 10 знаков (юрлицо) — 1 контрольная цифра; 12 знаков (ИП/физлицо) — 2.
 * ОГРН: 13 знаков (юрлицо), ОГРНИП: 15 знаков (ИП) — 1 контрольная цифра каждый.
 */

const onlyDigits = (v: string): string => v.replace(/\D/g, '');

function digits(v: string): number[] | null {
  const clean = onlyDigits(v);
  if (clean.length !== v.trim().replace(/\s/g, '').length) return null; // были не-цифры (кроме пробелов)
  return [...clean].map((c) => c.charCodeAt(0) - 48);
}

function weightedMod11Mod10(d: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += d[i]! * weights[i]!;
  return (sum % 11) % 10;
}

/** ИНН: 10 или 12 цифр с корректными контрольными разрядами. */
export function isValidInn(value: string): boolean {
  const d = digits(value);
  if (!d) return false;
  if (d.length === 10) {
    const c = weightedMod11Mod10(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]);
    return c === d[9];
  }
  if (d.length === 12) {
    const c1 = weightedMod11Mod10(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
    const c2 = weightedMod11Mod10(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
    return c1 === d[10] && c2 === d[11];
  }
  return false;
}

/**
 * ОГРН (13) / ОГРНИП (15): контрольная цифра = остаток от деления числа из
 * старших разрядов на (n−1), взятый по модулю 10, где n — длина.
 * 13 → делим первые 12 на 11; 15 → первые 14 на 13.
 */
function isValidOgrnLike(value: string, len: 13 | 15, divisor: bigint): boolean {
  const d = digits(value);
  if (!d || d.length !== len) return false;
  if (d[0] === 0) return false; // ОГРН не начинается с 0 (признак записи)
  const head = value.replace(/\D/g, '').slice(0, len - 1);
  const control = Number((BigInt(head) % divisor) % 10n);
  return control === d[len - 1];
}

/** ОГРН юрлица: 13 цифр. */
export function isValidOgrn(value: string): boolean {
  return isValidOgrnLike(value, 13, 11n);
}

/** ОГРНИП: 15 цифр. */
export function isValidOgrnip(value: string): boolean {
  return isValidOgrnLike(value, 15, 13n);
}

/** ОГРН любой формы (13 или 15) — для приёма как юрлиц, так и ИП. */
export function isValidOgrnAny(value: string): boolean {
  const clean = onlyDigits(value);
  if (clean.length === 13) return isValidOgrn(value);
  if (clean.length === 15) return isValidOgrnip(value);
  return false;
}
