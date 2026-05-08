// src/lib/dealOperations.js
// Direction 2 step 3 — feature-flag switcher layer.
//
// Все consumers (CashierPage, ExchangeForm, OtcDealWizard, TransferModal etc.)
// вызывают эти функции вместо `rpc*` из supabaseWrite.js. Switcher
// решает по VITE_USE_NEW_LEDGER какой backend дёргать.
//
// USE_NEW_LEDGER=true → v2 RPC (через newLedger.js + adapter)
// USE_NEW_LEDGER=false → legacy rpc* (passthrough к supabaseWrite.js)
//
// Edit/delete operations (updateDeal/deleteDeal/completeDeal/etc) — ВСЕГДА
// legacy passthrough пока Direction 3 (v2 readers) не сделает legacy_id →
// ledger_tx_id mapping. Это accept'имо для integration test "legacy form
// + новый ledger" — пишем в новый, читаем legacy.

import {
  rpcCreateDeal,
  rpcUpdateDeal,
  rpcDeleteDeal,
  rpcCompleteDeal,
  rpcCreateTransfer,
  rpcDeleteTransfer,
  rpcTopUp,
  rpcCreateBalanceAdjustment,
  rpcRecordPartnerInflow,
  rpcRecordPartnerOutflow,
  rpcSettleObligation,
  rpcSettleObligationPartial,
  rpcReceivePayment,
  rpcCancelObligation,
} from "./supabaseWrite.js";
import {
  rpcCreateDealV2,
  rpcCreateTransferV2,
  rpcCreateAdjustmentV2,
  USE_NEW_LEDGER,
} from "./newLedger.js";
import {
  adaptLegacyDealPayload,
  adaptLegacyTopupPayload,
  adaptLegacyTransferPayload,
  adaptLegacyAdjustmentPayload,
} from "./newLedgerAdapter.js";

// ─────────────────────────────────────────────────────────────────────
// CREATE operations — switched по VITE_USE_NEW_LEDGER
// ─────────────────────────────────────────────────────────────────────

/**
 * Create deal. Legacy payload shape (как rpcCreateDeal принимает).
 * Возвращает legacy bigint deal_id ИЛИ v2 uuid deal_tx_id (зависит от flag).
 *
 * Operations workflow auto-create для deferred OUT legs — добавлено в
 * operations/workflow-layer (PR #12) после merge этой ветки.
 */
export async function createDeal(payload) {
  if (!USE_NEW_LEDGER) return await rpcCreateDeal(payload);
  const v2payload = await adaptLegacyDealPayload(payload);
  const result = await rpcCreateDealV2(v2payload);
  return result.deal_tx_id;
}

/**
 * Create transfer. Legacy payload shape.
 * v2 поддерживает только same-currency. Cross-currency throws.
 */
export async function createTransfer(payload) {
  if (!USE_NEW_LEDGER) return await rpcCreateTransfer(payload);
  const v2payload = await adaptLegacyTransferPayload(payload);
  return await rpcCreateTransferV2(v2payload);
}

/**
 * Top-up наш asset-счёт (admin action). Legacy: { accountId, amount, note, sourceKind }.
 * v2: маппится в create_adjustment(kind='opening'|'reconciliation').
 */
export async function createTopup(payload) {
  if (!USE_NEW_LEDGER) return await rpcTopUp(payload);
  const v2payload = await adaptLegacyTopupPayload(payload);
  return await rpcCreateAdjustmentV2(v2payload);
}

/**
 * Balance adjustment. Legacy: { accountId, newBalance, note } → set absolute balance.
 * v2: переводится в delta-based create_adjustment(kind='reconciliation').
 */
export async function createBalanceAdjustment(payload) {
  if (!USE_NEW_LEDGER) return await rpcCreateBalanceAdjustment(payload);
  const v2payload = await adaptLegacyAdjustmentPayload(payload);
  return await rpcCreateAdjustmentV2(v2payload);
}

// ─────────────────────────────────────────────────────────────────────
// EDIT/DELETE — legacy passthrough (Direction 3 добавит v2 mapping)
// ─────────────────────────────────────────────────────────────────────

export const updateDeal       = rpcUpdateDeal;
export const deleteDeal       = rpcDeleteDeal;
export const completeDeal     = rpcCompleteDeal;
export const deleteTransfer   = rpcDeleteTransfer;
export const settleObligation = rpcSettleObligation;
export const settleObligationPartial = rpcSettleObligationPartial;
export const receivePayment   = rpcReceivePayment;
export const cancelObligation = rpcCancelObligation;
export const recordPartnerInflow  = rpcRecordPartnerInflow;
export const recordPartnerOutflow = rpcRecordPartnerOutflow;
