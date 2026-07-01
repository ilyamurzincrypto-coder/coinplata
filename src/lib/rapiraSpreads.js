// src/lib/rapiraSpreads.js
// Дефолтные спреды авто-курса от Rapira. Выведены эмпирически из 10 дней курсов
// Paramon (вариант A — симметрично вокруг рыночной середины Rapira):
//   покупка USDT (USDT→RUB) = mid × (1 − spread)
//   продажа USDT (RUB→USDT) = mid × (1 + spread)   [в БД хранится как 1/цена]
// Итоговый bid-ask спред = 2×spread. Значения — на СТОРОНУ (доля).
//   MSK ≈ 1,8% итого → ±0,9%   ·   SPB ≈ 2,4% → ±1,2%
// Пока данные есть только по USDT↔RUB; для остальных пар — _default.

export const RAPIRA_SPREADS = {
  MSK: { USDT_RUB: 0.009 },
  SPB: { USDT_RUB: 0.012 },
  _default: 0.011,
};

// Код города из офиса (city/name) — для выбора спреда.
export function officeCityCode(office) {
  const h = `${office?.city || ""} ${office?.name || ""}`;
  if (/antal|анталь/i.test(h)) return "ANT";
  if (/istanbul|стамбул/i.test(h)) return "IST";
  if (/питер|спб|spb|peterburg|petersburg|санкт/i.test(h)) return "SPB";
  if (/москв|moscow/i.test(h)) return "MSK";
  return null;
}

// Спред на сторону для офиса+пары (доля). Пара — в формате "USDT_RUB".
export function spreadFor(office, pair) {
  const code = officeCityCode(office);
  const cfg = code ? RAPIRA_SPREADS[code] : null;
  if (cfg && cfg[pair] != null) return cfg[pair];
  return RAPIRA_SPREADS._default;
}

// Авто-курс от Rapira mid (RUB за 1 USDT) в формате хранения office override:
//   USDT→RUB → RUB за USDT = mid×(1−spread)
//   RUB→USDT → USDT за RUB = 1 / (mid×(1+spread))   (обратное направление хранится сторно)
export function rapiraRateFor(mid, spread, from, to) {
  const m = Number(mid);
  if (!(m > 0)) return null;
  if (from === "USDT") return m * (1 - spread);
  if (to === "USDT") return 1 / (m * (1 + spread));
  return null;
}
