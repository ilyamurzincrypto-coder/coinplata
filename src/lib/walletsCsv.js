// src/lib/walletsCsv.js
// Парсер CSV импорта кошельков: колонки name,address,network. Офис НЕ выводим
// из имени (выбирается вручную в UI). Чистый — тестируется отдельно.

// Сети, которые понимает касса (network_id) / AEGIS. Нормализуем к нижнему.
export const KNOWN_NETWORKS = ["trc20", "erc20", "bep20", "btc"];

// Разбить строку CSV с учётом кавычек (простые случаи; наши поля без запятых).
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i += 1; } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// text → { rows:[{name,address,network,line}], errors:[{line,message}] }.
// Дубли адреса ВНУТРИ файла (по network+address) помечаются ошибкой.
export function parseWalletsCsv(text) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  const lines = String(text || "").split(/\r?\n/);
  let started = false;

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    const lineNo = idx + 1;
    if (!line) return;
    const cols = splitCsvLine(line);
    const lower = cols.map((c) => c.toLowerCase());
    // Заголовок (в любом порядке слов name/address/network) — пропускаем один раз.
    if (!started && lower.includes("address") && lower.includes("network")) {
      started = true;
      return;
    }
    started = true;
    const [name, address, networkRaw] = cols;
    if (!address || !networkRaw) {
      errors.push({ line: lineNo, message: "нужны address и network" });
      return;
    }
    const network = networkRaw.toLowerCase();
    if (!KNOWN_NETWORKS.includes(network)) {
      errors.push({ line: lineNo, message: `неизвестная сеть «${networkRaw}» (${KNOWN_NETWORKS.join("/")})` });
      return;
    }
    const key = `${network}:${address.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push({ line: lineNo, message: "дубль в файле — пропущен" });
      return;
    }
    seen.add(key);
    rows.push({ name: name || "", address, network, line: lineNo });
  });

  return { rows, errors };
}

// Сопоставление с существующими счетами по (network, address). Возвращает
// множество ключей `${NETWORK_UPPER}:${address}` уже заведённых крипто-счетов.
export function existingWalletKeys(accounts) {
  const set = new Set();
  (accounts || []).forEach((a) => {
    if (a.address && a.network) set.add(`${String(a.network).toLowerCase()}:${String(a.address).toLowerCase()}`);
  });
  return set;
}

export function isDuplicateRow(row, existingKeys) {
  return existingKeys.has(`${row.network}:${String(row.address).toLowerCase()}`);
}
