// src/utils/ratesCoverage.js
// Анализ покрытия валютных пар. Определяет:
//   • bidirectional — есть и FROM→TO и TO→FROM (полное покрытие)
//   • oneWay — есть только одно направление (асимметрия — risky)
//   • missing — нет ни одного направления
//   • isolated — валюта без единой пары (orphan)
//
// Dismissed pairs хранятся в localStorage — пользователь может пометить
// missing как "не нужно" и скрыть из списка.

const DISMISSED_KEY = "coinplata.dismissedMissingPairs";

export function loadDismissed() {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveDismissed(set) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {}
}

export function dismissPair(from, to) {
  const s = loadDismissed();
  s.add(`${from}_${to}`);
  saveDismissed(s);
  return s;
}

export function undismissPair(from, to) {
  const s = loadDismissed();
  s.delete(`${from}_${to}`);
  saveDismissed(s);
  return s;
}

export function clearDismissed() {
  try {
    localStorage.removeItem(DISMISSED_KEY);
  } catch {}
}

/**
 * analyzeCoverage:
 *   currencies — array of {code, type, ...} активные
 *   pairs — массив pair'ов (frontend shape с fromChannelId/toChannelId)
 *   channels — массив каналов (для резолва channelId → currencyCode)
 *
 * Возвращает:
 *   {
 *     total:         int (N*(N-1) возможных направлений),
 *     existingCount: int (default pairs с валидными channels),
 *     bidirectional: [{from, to}],      // есть FROM→TO и TO→FROM
 *     oneWay:        [{from, to, direction}], // только одно
 *     missing:       [{from, to}],      // ни одного направления (excluding dismissed)
 *     dismissed:     [{from, to}],      // пользователь скрыл
 *     isolated:      [code],            // валюта без единой пары
 *     matrix:        Map<"FROM_TO", "existing"|"missing"|"dismissed"|"self">
 *   }
 */
export function analyzeCoverage(currencies, pairs, channels, dismissedSet) {
  const codes = (currencies || []).map((c) => c.code);
  const active = codes; // пока всех считаем активными
  const dismissed = dismissedSet || loadDismissed();

  const channelCur = new Map();
  (channels || []).forEach((ch) => {
    channelCur.set(ch.id, ch.currencyCode);
  });

  // Existing default-pairs → Set("FROM_TO")
  const existingSet = new Set();
  (pairs || []).forEach((p) => {
    if (!p.isDefault) return;
    const f = channelCur.get(p.fromChannelId);
    const t = channelCur.get(p.toChannelId);
    if (f && t) existingSet.add(`${f}_${t}`);
  });

  const bidirectional = [];
  const oneWay = [];
  const missing = [];
  const dismissedOut = [];
  const matrix = new Map();
  const checkedBidi = new Set(); // чтобы не повторять пары

  for (const from of active) {
    for (const to of active) {
      if (from === to) {
        matrix.set(`${from}_${to}`, "self");
        continue;
      }
      const key = `${from}_${to}`;
      const rev = `${to}_${from}`;
      const hasFwd = existingSet.has(key);
      const hasRev = existingSet.has(rev);
      if (hasFwd) {
        matrix.set(key, "existing");
      } else if (dismissed.has(key)) {
        matrix.set(key, "dismissed");
      } else {
        matrix.set(key, "missing");
      }
      // Группируем по неориентированной паре — обрабатываем только один раз
      const sortedKey = [from, to].sort().join("_");
      if (checkedBidi.has(sortedKey)) continue;
      checkedBidi.add(sortedKey);

      if (hasFwd && hasRev) {
        bidirectional.push({ from, to });
      } else if (hasFwd || hasRev) {
        oneWay.push({
          from: hasFwd ? from : to,
          to: hasFwd ? to : from,
          missingDirection: hasFwd ? `${to}→${from}` : `${from}→${to}`,
        });
      } else {
        // Оба направления отсутствуют
        const fwdDismissed = dismissed.has(key);
        const revDismissed = dismissed.has(rev);
        if (fwdDismissed && revDismissed) {
          dismissedOut.push({ from, to });
        } else {
          missing.push({ from, to });
        }
      }
    }
  }

  // Isolated currencies — ни одной existing пары
  const isolated = [];
  for (const code of active) {
    const hasAny = [...existingSet].some(
      (k) => k.startsWith(`${code}_`) || k.endsWith(`_${code}`)
    );
    if (!hasAny) isolated.push(code);
  }

  return {
    total: active.length * (active.length - 1),
    existingCount: existingSet.size,
    bidirectional,
    oneWay,
    missing,
    dismissed: dismissedOut,
    isolated,
    matrix,
    currencies: active,
  };
}
