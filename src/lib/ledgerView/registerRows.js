// src/lib/ledgerView/registerRows.js
//
// Строки реестра счетов — ОДИН сборщик на все три раздела.
//
// 🔴 Лоро, Ностро и кассы, Капитал обязаны выглядеть одинаково: один набор колонок, тот же
// порядок и ширины, различаются только данные. Поэтому и сборщик один: если бы у каждого
// раздела был свой, колонки разъехались бы на первой же правке — именно так это и случилось в
// CoinPay до введения канона.

import { ROLE, SECTION, presentAmount, roleLabel, roleOf, sectionOf } from "./accountRoles.js";
import { displayDecimals, parseExact, sumExact } from "./money.js";

/**
 * Остатки приходят отдельной таблицей (`ledger.balances`) и разложены по измерениям
 * (клиент/партнёр). Для строки счёта нужен остаток ПО СЧЁТУ И ВАЛЮТЕ — суммируем измерения.
 *
 * 🔴 Суммируем только внутри одной валюты. Валюты не складываются нигде: сложение требует курса,
 * курс берётся на дату, дата — предмет спора. «Итог по всем валютам» прячет три решения в одно
 * непроверяемое число.
 */
export function balanceByAccount(balances) {
  const buckets = new Map();
  for (const b of balances || []) {
    if (!b || !b.accountId) continue;
    const key = `${b.accountId}|${b.currency || ""}`;
    if (!buckets.has(key)) buckets.set(key, { accountId: b.accountId, currency: b.currency || "", raws: [] });
    buckets.get(key).raws.push(b.balanceRaw !== undefined ? b.balanceRaw : b.balance);
  }
  const out = new Map();
  for (const { accountId, currency, raws } of buckets.values()) {
    const sum = sumExact(raws, displayDecimals(currency));
    const prev = out.get(accountId) || [];
    prev.push({ currency, raw: sum });
    out.set(accountId, prev);
  }
  return out;
}

/** Имя контрагента для колонки «Контрагент». Для наших счетов — «Платформа». */
function counterpartyName(account, balancesOfAccount, names) {
  if (account?.clientDimRequired || account?.partnerDimRequired) {
    const ids = new Set((balancesOfAccount || []).map((b) => b.ownerId).filter(Boolean));
    if (ids.size === 1) {
      const only = [...ids][0];
      return names?.get?.(only) || "—";
    }
    if (ids.size > 1) return `${ids.size} контрагентов`;
    return "—";
  }
  return "Платформа";
}

/**
 * Строки одного раздела.
 *
 * Сортировка по канону CoinPay: деньги сверху, нули вниз, при равенстве — по номеру счёта.
 * Сравнение по МОДУЛЮ остатка: «пассив с минусом — тоже крупные деньги, прятать его в конец
 * списка нельзя».
 */
export function buildRegisterRows({ accounts, balances, names, section, officeFilter = "all" }) {
  const byAccount = balanceByAccount(balances);
  const ownersByAccount = new Map();
  for (const b of balances || []) {
    if (!b?.accountId) continue;
    const list = ownersByAccount.get(b.accountId) || [];
    list.push({ ownerId: b.clientId || b.partnerId || null });
    ownersByAccount.set(b.accountId, list);
  }

  const rows = [];
  for (const acc of accounts || []) {
    if (acc?.active === false) continue;
    // 🔴 Фильтр офиса обязателен: он был в убранных вкладках, и терять его при переходе на
    // единый вид нельзя — в мультиофисном бизнесе «все офисы» вместо одного это не косметика,
    // а другие деньги на экране.
    if (officeFilter && officeFilter !== "all" && acc?.officeId !== officeFilter) continue;
    if (section && sectionOf(acc) !== section) continue;
    const role = roleOf(acc);
    const perCurrency = byAccount.get(acc.id) || [];
    // Счёт без движений показываем тоже — с остатком его собственной валюты и нулём.
    const list = perCurrency.length > 0 ? perCurrency : [{ currency: acc.currency || "", raw: null }];
    for (const { currency, raw } of list) {
      rows.push({
        id: `${acc.id}|${currency}`,
        accountId: acc.id,
        number: acc.code || "—",
        counterparty: counterpartyName(acc, ownersByAccount.get(acc.id), names),
        name: acc.name || "—",
        typeLabel: roleLabel(acc),
        currency,
        presentedRaw: presentAmount(raw, role),
        role,
        section: sectionOf(acc),
      });
    }
  }
  return rows.sort(compareRows);
}

/** Модуль суммы как BigInt — для сортировки без float. */
function magnitude(raw, currency) {
  const p = parseExact(raw);
  if (!p) return -1n; // «нет данных» — в самый низ, ниже нулей
  const decimals = displayDecimals(currency);
  const frac = (p.frac || "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(p.int) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

function compareRows(a, b) {
  const ma = magnitude(a.presentedRaw, a.currency);
  const mb = magnitude(b.presentedRaw, b.currency);
  if (ma !== mb) return mb > ma ? 1 : -1;
  return String(a.number).localeCompare(String(b.number), "ru");
}

/**
 * Итог раздела — ПО ВАЛЮТАМ, отдельными строками.
 *
 * 🔴 Одной суммы «всего» здесь нет намеренно. В CoinPay оборотно-сальдовая ведомость складывала
 * три секции в одно число и печатала как «Итого»: на боевом это давало «452,0000 ₮» при реальных
 * 226,0000 ₮ — отчёт, который читает бухгалтер, вдвое завышал остаток.
 */
export function sectionTotals(rows) {
  const byCurrency = new Map();
  for (const r of rows) {
    const list = byCurrency.get(r.currency) || [];
    list.push(r.presentedRaw);
    byCurrency.set(r.currency, list);
  }
  return [...byCurrency.entries()]
    .map(([currency, raws]) => ({ currency, raw: sumExact(raws, displayDecimals(currency)) }))
    .filter((t) => t.raw !== null)
    .sort((a, b) => String(a.currency).localeCompare(String(b.currency), "ru"));
}

export { ROLE, SECTION };
