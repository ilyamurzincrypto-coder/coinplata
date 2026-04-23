// src/utils/dealTemplates.js
// User-local история часто используемых пар. Считаем use-count по (curIn, curOut)
// в localStorage. При открытии ExchangeForm показываем top-N как quick-buttons.
//
// Fallback defaults если история пуста (новый пользователь).

const STORAGE_KEY = "coinplata.dealUsage";
const MAX_TEMPLATES = 6;

const DEFAULT_TEMPLATES = [
  { from: "USDT", to: "TRY" },
  { from: "TRY", to: "USDT" },
  { from: "USDT", to: "USD" },
  { from: "USD", to: "TRY" },
  { from: "USDT", to: "EUR" },
  { from: "EUR", to: "USDT" },
];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function save(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

export function recordDealUsage(from, to) {
  if (!from || !to || from === to) return;
  const key = `${from}_${to}`;
  const obj = load();
  obj[key] = (obj[key] || 0) + 1;
  save(obj);
}

export function getTopTemplates(maxCount = MAX_TEMPLATES) {
  const obj = load();
  const entries = Object.entries(obj)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([k, count]) => {
      const [from, to] = k.split("_");
      return { from, to, count };
    });
  if (entries.length >= 3) return entries;
  // Добавляем defaults для заполнения если мало истории
  const seen = new Set(entries.map((e) => `${e.from}_${e.to}`));
  for (const d of DEFAULT_TEMPLATES) {
    const k = `${d.from}_${d.to}`;
    if (seen.has(k)) continue;
    entries.push({ ...d, count: 0 });
    if (entries.length >= maxCount) break;
  }
  return entries;
}

export function clearDealUsage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
