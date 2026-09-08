// src/lib/accountsOverview.js
// Чистая логика страницы «Счета» (эталон accounts-r9): срез Все/Фиат/Крипто,
// поиск, сортировка, агрегаты офисов и субсчетов. Без React — чтобы покрыть
// тестами и переиспользовать на share-странице.
//
// Инварианты:
//   • Все суммы-агрегаты считаются в base через toBase() — сырых умножений нет.
//   • Номер счёта леджера (ledgerAccountCode) приходит с сервера; на клиенте
//     НЕ генерится и НЕ достраивается. Нет кода — рендерим прочерк.
//   • Срез (mode) пересчитывает ВСЕ числа: полосу, колонки офиса, счётчики.
//     Статичных тоталов нет.

import { walletVM, classifyWallet, DELTA_ALERT_THRESHOLD_USD } from "./cryptoAccountsView.js";

// Разделитель разрядов — NBSP (его отдаёт ru-RU): не рвёт число переносом
// и переживает копирование. Эталон: «964 000,00».
// Общий utils/money.js:fmt() — en-US с запятой-разделителем разрядов и живёт
// во всём остальном приложении; менять его глобально вне скоупа задачи.
export function fmtSpace(n, digits = 0) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

// «Mark Antalya» → «MA», «Lara» → «LA».
export function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// TAzj2…TL3V / 0x3aD…99c2 — 5 символов головы, 4 хвоста (эталон).
export function shortAddress(addr, head = 5, tail = 4) {
  const a = String(addr || "");
  if (!a) return "";
  return a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}

const isCrypto = (a) => (a.kind ? a.kind === "crypto" : a.type === "crypto" || !!a.network);
const nearZero = (v) => Math.abs(Number(v) || 0) < 0.005;

// Порог, ниже которого остаток нативного токена считается «мало газа».
// Поле gasBalanceUsd опциональное (появится из AEGIS-синка) — пока его нет,
// подстрока кошелька заканчивается адресом. channel.gasFee (комиссия сети)
// сюда НЕ подставляется: это разные величины.
export const LOW_GAS_USD = 1;

export function gasWarning(account) {
  const g = account?.gasBalanceUsd;
  if (g == null || g === "") return null;
  const n = Number(g);
  if (!Number.isFinite(n) || n >= LOW_GAS_USD) return null;
  return n;
}

/**
 * Полная модель страницы.
 *
 * @param {object[]} accounts       — счета (фильтруются до active внутри)
 * @param {object[]} offices        — справочник офисов (порядок сохраняется)
 * @param {(id:string)=>number} balanceOf
 * @param {(id:string,from:number,to?:number)=>number} deltaOf
 * @param {(amount:number,cur:string)=>number} toBase
 * @param {'all'|'fiat'|'crypto'} mode
 * @param {string} query            — поиск: офис, город, субсчёт, адрес
 * @param {'total'|'name'} sort
 */
export function buildAccountsOverview({
  accounts = [],
  offices = [],
  balanceOf = () => 0,
  deltaOf = () => 0,
  toBase = (v) => v,
  curDict = {},
  mode = "all",
  query = "",
  sort = "total",
  dayStartMs = 0,
  yesterdayStartMs = 0,
  threshold = DELTA_ALERT_THRESHOLD_USD,
} = {}) {
  const wantFiat = mode === "all" || mode === "fiat";
  const wantCrypto = mode === "all" || mode === "crypto";
  const live = accounts.filter((a) => a.active);

  const blocks = offices.map((office) => {
    const own = live.filter((a) => a.officeId === office.id);

    const fiatRows = own
      .filter((a) => !isCrypto(a))
      .map((a) => {
        const native = balanceOf(a.id);
        const usd = toBase(native, a.currency);
        const meta = curDict[a.currency] || { code: a.currency, symbol: "" };
        return {
          id: a.id,
          account: a,
          ledgerCode: a.ledgerAccountCode || null,
          currency: a.currency,
          symbol: meta.symbol || "",
          native,
          usd,
          isZero: nearZero(native),
        };
      })
      .sort((x, y) => y.usd - x.usd || x.currency.localeCompare(y.currency));

    const cryptoRows = own
      .filter(isCrypto)
      .map((a) => {
        const native = balanceOf(a.id);
        const usd = toBase(native, a.currency);
        const vm = walletVM(a, usd);
        return {
          id: a.id,
          account: a,
          ledgerCode: a.ledgerAccountCode || null,
          currency: a.currency,
          symbol: (curDict[a.currency] || {}).symbol || "",
          network: a.network || null,
          address: a.address || null,
          addressShort: shortAddress(a.address),
          riskLevel: a.riskLevel || null,
          problem: classifyWallet(vm, threshold) === "problem",
          gasLow: gasWarning(a),
          usd,
          isZero: nearZero(native),
        };
      })
      .sort((x, y) => y.usd - x.usd);

    const cash = fiatRows.reduce((s, r) => s + r.usd, 0);
    const crypto = cryptoRows.reduce((s, r) => s + r.usd, 0);

    // Срез влияет и на суммы, и на счётчики: «N субсчетов» в режиме Крипто
    // считает только крипто-строки, иначе подпись врёт про то, что показано.
    const sliceRows = (wantFiat ? fiatRows.length : 0) + (wantCrypto ? cryptoRows.length : 0);
    const total = (wantFiat ? cash : 0) + (wantCrypto ? crypto : 0);

    const deltaFor = (from, to) =>
      own
        .filter((a) => (isCrypto(a) ? wantCrypto : wantFiat))
        .reduce((s, a) => s + toBase(deltaOf(a.id, from, to), a.currency), 0);

    return {
      office,
      initials: initials(office.name),
      subCount: sliceRows,
      warnCount: wantCrypto ? cryptoRows.filter((r) => r.problem).length : 0,
      cash,
      crypto,
      total,
      delta: deltaFor(dayStartMs),
      deltaYesterday: deltaFor(yesterdayStartMs, dayStartMs),
      isZero: nearZero(total),
      fiatRows: wantFiat ? fiatRows : [],
      cryptoRows: wantCrypto ? cryptoRows : [],
      // haystack для поиска — офис, город и всё, что видно в развороте
      haystack: [
        office.name,
        office.city,
        ...fiatRows.map((r) => `${r.currency} ${r.account.name || ""} ${r.ledgerCode || ""}`),
        ...cryptoRows.map(
          (r) => `${r.currency} ${r.account.name || ""} ${r.network || ""} ${r.address || ""} ${r.ledgerCode || ""}`
        ),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });

  const q = String(query || "").trim().toLowerCase();
  const found = q ? blocks.filter((b) => b.haystack.includes(q)) : blocks;

  const sorted = [...found].sort((a, b) => {
    if (sort === "name") return a.office.name.localeCompare(b.office.name, "ru");
    // По итогу: нулевые всегда внизу, независимо от направления.
    if (a.isZero !== b.isZero) return a.isZero ? 1 : -1;
    return b.total - a.total || a.office.name.localeCompare(b.office.name, "ru");
  });

  const sum = (key) => found.reduce((s, b) => s + b[key], 0);

  return {
    offices: sorted,
    officeCount: sorted.length,
    subCount: sorted.reduce((s, b) => s + b.subCount, 0),
    totals: {
      cash: sum("cash"),
      crypto: sum("crypto"),
      total: sum("total"),
      delta: sum("delta"),
      deltaYesterday: sum("deltaYesterday"),
    },
    mode,
  };
}
