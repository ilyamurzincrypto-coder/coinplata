// src/lib/treasury/leafLabel.js
// Лейбл листа дерева Казначейства (Активы/Пассивы). Внутри офиса-кассы (или у
// контрагента в Пассивах) строки различаются ТОЛЬКО валютой — офис/контрагент
// уже в заголовке группы, а тип счёта одинаков на всю группу. Поэтому показываем
// НАЗВАНИЕ ВАЛЮТЫ, а не повтор «Касса»/«Обязательства…». Для крипто добавляем
// сеть, чтобы TRC20/ERC20 не слиплись: «Tether · TRC20».
// Капитал намеренно НЕ использует этот хелпер — там другой формат имён.

// Сети из плана счетов (data.js channels: TRC20/ERC20/BEP20) + запас на будущее.
const NETWORKS = new Set(["TRC20", "ERC20", "BEP20", "ARBITRUM", "POLYGON", "SOL", "TON", "AVAX", "OP", "BASE"]);

// Сеть вытаскиваем из имени счёта вида «Hot · USDT TRC20 · Istanbul».
function extractNetwork(name) {
  for (const raw of String(name || "").split(/[·\s]+/)) {
    const tok = raw.trim().toUpperCase();
    if (NETWORKS.has(tok)) return tok;
  }
  return null;
}

// Локализованное название валюты (t(`ccyName_USD`) → «Доллар США»); fallback на код.
function currencyName(code, t) {
  if (!code) return "";
  const key = `ccyName_${code}`;
  const tr = t(key);
  return tr && tr !== key ? tr : code;
}

// @param {{name, currency}} a
// @param {(key:string)=>string} t  — i18n-функция (useTranslation().t)
export function leafLabel(a, t) {
  const name = currencyName(a.currency, t);
  const net = extractNetwork(a.name);
  return net ? `${name} · ${net}` : name;
}
