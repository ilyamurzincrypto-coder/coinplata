// src/utils/resolveCrypto.js
// Эвристики и стаб-резолвер для blockchain-адресов/хешей.
//
// ВНИМАНИЕ: это клиент-сайд DEMO. Реальная реализация resolveTxHash должна
// дергать explorer API (etherscan / tronscan / bscscan). Здесь — детерминированный
// псевдо-адрес на основе хеша, чтобы флоу auto-detection кошелька можно было
// прогнать без блокчейн-бэкенда.

export function detectNetworkFromAddress(address) {
  const a = (address || "").trim();
  if (!a) return null;
  if (a.startsWith("0x") && a.length === 42) return "ERC20"; // также BEP20-совместимый формат
  if (/^T[A-Za-z0-9]{33}$/.test(a)) return "TRC20";
  if (a.startsWith("bnb1")) return "BEP2";
  return null;
}

export function detectNetworkFromHash(hash) {
  const h = (hash || "").trim();
  if (!h) return null;
  if (h.startsWith("0x") && h.length === 66) return "ERC20"; // 0x + 64 hex
  if (/^[A-Fa-f0-9]{64}$/.test(h)) return "TRC20"; // TRON tx hash = 64 hex без 0x
  return null;
}

// Стаб: в проде — fetch('https://api.tronscan.org/...') и т.д.
// Возвращает { from_address, network } или null, если формат не распознан.
export function resolveTxHash(txHash) {
  const h = (txHash || "").trim();
  if (!h) return null;
  const network = detectNetworkFromHash(h);
  if (!network) return null;
  const from_address =
    network === "ERC20"
      ? `0x${h.slice(2, 42)}`
      : `T${h.slice(0, 33)}`;
  return { from_address, network };
}

// Извлекает network из имени account (например "TRC20 Main" → "TRC20").
// Полезно когда адрес неоднозначен (0x… подходит под ERC20/BEP20).
const NETWORK_FROM_NAME_RX = /\b(TRC20|ERC20|BEP20|BEP2|POLYGON|MATIC)\b/i;
export function detectNetworkFromAccountName(name) {
  const m = (name || "").match(NETWORK_FROM_NAME_RX);
  return m ? m[1].toUpperCase() : null;
}
