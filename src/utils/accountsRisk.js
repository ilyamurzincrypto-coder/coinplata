// src/utils/accountsRisk.js
// Чистые хелперы отображения AEGIS-мониторинга в разделе «Счета». Никакой
// деньги-математики: on-chain оценка (balanceUsdEst) — строка из AEGIS, здесь
// коэрсим в Number ТОЛЬКО для грубого сравнения-расхождения и вывода. В леджер
// эти значения не ходят.

// Порог подсветки расхождения «учётный остаток ↔ он-чейн (AEGIS)», в USD.
export const DISCREPANCY_THRESHOLD_USD = 50;

// Бейдж риска для криптосчёта. Возвращает null если мониторинг не подключён
// (тогда UI показывает кнопку «Подключить»).
//   tone: ok | warning | critical | muted
export function riskBadge({ riskLevel, capability, aegisWalletId } = {}) {
  if (!aegisWalletId) return null; // не подключён
  if (capability === "degraded") {
    return { tone: "muted", label: "нет данных (сеть)", dot: false };
  }
  switch (riskLevel) {
    case "ok":
      return { tone: "ok", label: "OK", dot: true };
    case "warning":
      return { tone: "warning", label: "пред-бан", dot: true };
    case "critical":
      return { tone: "critical", label: "критично", dot: true };
    default:
      return { tone: "muted", label: "нет данных", dot: false };
  }
}

// Расхождение учётного (в base/USD) и он-чейн (AEGIS, USD-строка).
// Возвращает { hasOnchain, onchainUsd, diff, flagged }. flagged=true когда
// |учёт − он-чейн| ≥ порога И он-чейн доступен.
export function walletDiscrepancy({ ledgerUsd, balanceUsdEst, threshold = DISCREPANCY_THRESHOLD_USD } = {}) {
  if (balanceUsdEst == null || balanceUsdEst === "") {
    return { hasOnchain: false, onchainUsd: null, diff: null, flagged: false };
  }
  const onchainUsd = Number(balanceUsdEst);
  if (!Number.isFinite(onchainUsd)) {
    return { hasOnchain: false, onchainUsd: null, diff: null, flagged: false };
  }
  const led = Number(ledgerUsd) || 0;
  const diff = led - onchainUsd;
  return { hasOnchain: true, onchainUsd, diff, flagged: Math.abs(diff) >= threshold };
}

// «данные на HH:MM» из synced_at (локальное время). null → пусто.
export function syncedLabel(syncedAt) {
  if (!syncedAt) return "";
  const d = new Date(syncedAt);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `данные на ${hh}:${mm}`;
}

// Криптосчёт ли (для показа AEGIS-колонок): kind crypto ИЛИ есть адрес+сеть.
export function isCryptoAccount(a) {
  return a?.kind === "crypto" || (!!a?.address && !!a?.network);
}

// Можно ли подключить мониторинг: крипта с адресом и сетью, ещё не подключён.
export function canConnectMonitoring(a) {
  return isCryptoAccount(a) && !!a?.address && !!a?.network && !a?.aegisWalletId;
}
