// src/lib/shareAccounts.js
// Чистая сборка дерева «Счета» из СЫРОГО снапшота share-эндпоинта.
// Переиспользует тот же движок, что и приложение (pivotRate, makeToBase,
// buildAccountsTree) — НЕ копия логики. Глобальный getRate строится из плоской
// карты дефолтных пар {FROM_TO: rate} (эндпоинт уже синтезировал обратные ноги),
// с USDT-пивотом как фолбэком — 1:1 с public.pairs / RatesProvider.

import { pivotRate } from "../utils/morningRatesParser.js";
import { makeToBase } from "../store/baseCurrency.js";
import { buildAccountsTree } from "../components/accounts/buildAccountsTree.js";
import { BAL_COLUMNS } from "../components/balances/currencyMeta.js";

export const SHARE_SCOPES = ["all", "fiat", "crypto"];
export const isValidScope = (s) => SHARE_SCOPES.includes(s);
export const SCOPE_LABEL = { all: "Все счета", fiat: "Фиат", crypto: "Крипто" };

const rateKey = (from, to) => `${from}_${to}`;
const ccyOrder = (c) => {
  const i = BAL_COLUMNS.indexOf(c);
  return i < 0 ? 99 : i;
};

// Глобальный getRate из плоской карты дефолтных пар + USDT-пивот (как в RatesProvider,
// но без офис-оверрайдов — для base-конверсии они не нужны).
export function makeGetRateFromMap(rates = {}) {
  return (from, to) => {
    if (from === to) return 1;
    const direct = rates[rateKey(from, to)];
    if (Number.isFinite(direct)) return direct;
    const p = pivotRate(from, to, (a, b) => rates[rateKey(a, b)]);
    return Number.isFinite(p) ? p : undefined;
  };
}

// Снапшот эндпоинта → { tree, grandBase, base, scope } для рендера.
export function buildShareTree(snapshot) {
  const {
    accounts = [],
    offices = [],
    balances = {},
    rates = {},
    baseCurrency = "USD",
    fxRates = {},
  } = snapshot || {};
  const scope = isValidScope(snapshot?.scope) ? snapshot.scope : "all";
  const getRate = makeGetRateFromMap(rates);
  const toBase = makeToBase(baseCurrency, fxRates, getRate);
  const balanceOf = (id) => balances[id]?.total || 0;
  const reservedOf = (id) => balances[id]?.reserved || 0;
  const { tree, grandBase } = buildAccountsTree({
    accounts,
    offices,
    kindFilter: scope,
    balanceOf,
    reservedOf,
    toBase,
    ccyOrder,
  });
  return { tree, grandBase, base: baseCurrency, scope };
}
