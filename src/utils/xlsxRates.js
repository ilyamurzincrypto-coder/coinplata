// src/utils/xlsxRates.js
// Парсинг и валидация .xlsx файла с курсами + diff с текущими парами.
//
// Формат файла:
//   Первая строка — headers: From | To | Rate (case-insensitive, trim)
//   Каждая следующая — одна пара (одно направление).
//
// Lookup по currency code (USD, USDT, EUR...). Unknown коды → errors.
// Rate: positive number, локаль "45,10" → "45.10" авто-фикс.
//
// Результат parseAndValidate():
//   {
//     valid:     [{from, to, rate, oldRate, delta, deltaPct, status: "updated"|"new"|"unchanged"}],
//     errors:    [{row, rawFrom, rawTo, rawRate, reason}],
//     duplicates:[{from, to, count}],          // info-only (оставляем последнюю)
//     summary:   {totalRows, updated, added, unchanged, errors}
//   }
//
// Не мутирует DOM, не делает RPC — чистая функция.

import * as XLSX from "xlsx";

const HEADER_ALIASES = {
  from: ["from", "from_currency", "cur_from", "source", "откуда"],
  to: ["to", "to_currency", "cur_to", "target", "куда"],
  rate: ["rate", "price", "value", "курс"],
};

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

function findColumnIndex(headerRow, aliases) {
  return headerRow.findIndex((h) => aliases.includes(normalizeHeader(h)));
}

function parseRate(raw) {
  if (raw === null || raw === undefined || raw === "") return NaN;
  if (typeof raw === "number") return raw;
  const s = String(raw).trim().replace(/\s+/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

/**
 * parseXlsxFile: File → { rows: [[...], ...], sheetCount: number }
 * Бросает Error с понятным сообщением для UI.
 */
export async function parseXlsxFile(file) {
  if (!file) throw new Error("No file provided");
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("File is larger than 5 MB. Rate sheets should be small.");
  }
  const buf = await file.arrayBuffer();
  let wb;
  try {
    wb = XLSX.read(buf, { type: "array" });
  } catch (err) {
    throw new Error("Could not read file. Make sure it's a valid .xlsx.");
  }
  const sheetNames = wb.SheetNames || [];
  if (sheetNames.length === 0) throw new Error("Workbook has no sheets.");
  const firstSheet = wb.Sheets[sheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, blankrows: false });
  return { rows, sheetCount: sheetNames.length };
}

/**
 * validateRows: raw AoA → {valid, errors, duplicates}
 * knownCurrencies: array of codes (USD, USDT, EUR, ...) из currencies store
 * currentRates: Map<"FROM_TO", number> — текущие курсы для diff (может быть пустой)
 */
export function validateRows(rows, knownCurrencies, currentRates) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error("File is empty or has no data rows.");
  }
  const headerRow = rows[0];
  const fromIdx = findColumnIndex(headerRow, HEADER_ALIASES.from);
  const toIdx = findColumnIndex(headerRow, HEADER_ALIASES.to);
  const rateIdx = findColumnIndex(headerRow, HEADER_ALIASES.rate);
  if (fromIdx < 0 || toIdx < 0 || rateIdx < 0) {
    throw new Error(
      'Header row must contain columns: "From", "To", "Rate". Case-insensitive.'
    );
  }

  const knownSet = new Set(knownCurrencies.map((c) => normalizeCode(c)));
  const valid = [];
  const errors = [];
  const seenKeys = new Map(); // "FROM_TO" → last index in valid
  let updated = 0;
  let added = 0;
  let unchanged = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const from = normalizeCode(row[fromIdx]);
    const to = normalizeCode(row[toIdx]);
    const rawRate = row[rateIdx];
    const rate = parseRate(rawRate);

    // Skip полностью пустых строк
    if (!from && !to && !Number.isFinite(rate)) continue;

    if (!from || !to) {
      errors.push({ row: i + 1, rawFrom: row[fromIdx], rawTo: row[toIdx], rawRate, reason: "Missing From or To" });
      continue;
    }
    if (from === to) {
      errors.push({ row: i + 1, rawFrom: from, rawTo: to, rawRate, reason: "From and To are the same currency" });
      continue;
    }
    if (!knownSet.has(from)) {
      errors.push({ row: i + 1, rawFrom: from, rawTo: to, rawRate, reason: `Unknown currency: ${from}` });
      continue;
    }
    if (!knownSet.has(to)) {
      errors.push({ row: i + 1, rawFrom: from, rawTo: to, rawRate, reason: `Unknown currency: ${to}` });
      continue;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      errors.push({ row: i + 1, rawFrom: from, rawTo: to, rawRate, reason: "Rate must be a positive number" });
      continue;
    }
    if (rate > 1e10) {
      errors.push({ row: i + 1, rawFrom: from, rawTo: to, rawRate, reason: "Rate too large" });
      continue;
    }

    // Округление до 10 знаков (ограничение numeric(20,10) в pairs)
    const normRate = Number(rate.toFixed(10));
    const key = `${from}_${to}`;

    if (seenKeys.has(key)) {
      // Дубль — переписываем предыдущий
      const prevIdx = seenKeys.get(key);
      const prev = valid[prevIdx];
      valid[prevIdx] = { ...prev, rate: normRate };
    } else {
      const oldRate = currentRates?.get?.(key);
      const isNew = oldRate === undefined || oldRate === null;
      const delta = isNew ? null : normRate - Number(oldRate);
      const deltaPct = isNew || !oldRate ? null : (delta / Number(oldRate)) * 100;
      let status;
      if (isNew) {
        status = "new";
        added += 1;
      } else if (Math.abs(delta) < 1e-12) {
        status = "unchanged";
        unchanged += 1;
      } else {
        status = "updated";
        updated += 1;
      }
      valid.push({ from, to, rate: normRate, oldRate: isNew ? null : Number(oldRate), delta, deltaPct, status });
      seenKeys.set(key, valid.length - 1);
    }
  }

  // Duplicates report (только для UI info — уже merged)
  const dupMap = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const f = normalizeCode(r[fromIdx]);
    const t = normalizeCode(r[toIdx]);
    if (!f || !t) continue;
    const k = `${f}_${t}`;
    dupMap.set(k, (dupMap.get(k) || 0) + 1);
  }
  const duplicates = [];
  dupMap.forEach((count, key) => {
    if (count > 1) {
      const [from, to] = key.split("_");
      duplicates.push({ from, to, count });
    }
  });

  return {
    valid,
    errors,
    duplicates,
    summary: {
      totalRows: rows.length - 1,
      updated,
      added,
      unchanged,
      errors: errors.length,
    },
  };
}

/**
 * Собрать template.xlsx из текущих пар. currencyPairs: [{from, to, rate}]
 * Возвращает Blob.
 */
export function buildTemplateBlob(currencyPairs) {
  const rows = [["From", "To", "Rate"]];
  currencyPairs.forEach((p) => {
    rows.push([p.from, p.to, p.rate]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rates");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
