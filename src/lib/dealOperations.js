// src/lib/dealOperations.js
//
// UI-side stub до merge Direction 2 backend (адаптер + полный switcher
// от ledger-инстанса). Когда Direction 2 будет merged в main — этот
// файл заменится полной версией через cherry-pick (см. ledger ветку
// `ledger/direction2-write-wrappers`).
//
// Текущее поведение:
//   • USE_NEW_LEDGER=false → rpcCreateDealV2 НЕ вызывается; здесь только
//     stub fallback на legacy rpcCreateDeal с camelCase → legacy mapping.
//   • USE_NEW_LEDGER=true  → прямой вызов rpcCreateDealV2 (если adapter
//     ещё не merged — payload должен быть уже camelCase from buildTx).
//
// Цель stub: build не падает + integration test пишет в новый ledger
// при VITE_USE_NEW_LEDGER=true даже без adapter (потому что buildTx
// уже формирует v2-совместимый payload напрямую).

import { rpcCreateDeal } from "./supabaseWrite.js";
import { rpcCreateDealV2, USE_NEW_LEDGER } from "./newLedger.js";

/**
 * Create deal — switched по VITE_USE_NEW_LEDGER.
 *
 * @param {Object} payload
 *   USE_NEW_LEDGER=true → v2 payload (camelCase from buildTx)
 *   USE_NEW_LEDGER=false → ожидает legacy shape (legacy ExchangeForm)
 */
export async function createDeal(payload) {
  if (USE_NEW_LEDGER) {
    return await rpcCreateDealV2(payload);
  }
  return await rpcCreateDeal(payload);
}
