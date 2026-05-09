// src/lib/dealOperations.js
// Direction 2 step 3 — feature-flag switcher layer.
//
// Все consumers вызывают эти функции вместо `rpc*` из supabaseWrite.js.
// Switcher решает по VITE_USE_NEW_LEDGER какой backend дёргать.

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
  rpcCreateWorkflowV2,
  USE_NEW_LEDGER,
} from "./newLedger.js";
import {
  adaptLegacyDealPayload,
  adaptLegacyTopupPayload,
  adaptLegacyTransferPayload,
  adaptLegacyAdjustmentPayload,
} from "./newLedgerAdapter.js";

export async function createDeal(payload) {
  if (!USE_NEW_LEDGER) return await rpcCreateDeal(payload);
  const v2payload = await adaptLegacyDealPayload(payload);
  const result = await rpcCreateDealV2(v2payload);

  const deferredLegs = (v2payload.outLegs || [])
    .filter((l) => l.deferred)
    .map((l, i) => ({
      leg_id: `out_${i}`,
      currency: l.currency,
      amount: Number(l.amount),
      kind: "out",
      account_code: l.accountCode,
    }));

  if (deferredLegs.length > 0 && result.deal_tx_id) {
    try {
      await rpcCreateWorkflowV2({
        ledgerTxId: result.deal_tx_id,
        initialStatus: "awaiting_release",
        openLegs: deferredLegs,
        metadata: { source: "auto_from_deal_v2" },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[dealOperations] workflow auto-create failed", err);
    }
  }

  return result.deal_tx_id;
}

export async function createTransfer(payload) {
  if (!USE_NEW_LEDGER) return await rpcCreateTransfer(payload);
  const v2payload = await adaptLegacyTransferPayload(payload);
  return await rpcCreateTransferV2(v2payload);
}

export async function createTopup(payload) {
  if (!USE_NEW_LEDGER) return await rpcTopUp(payload);
  const v2payload = await adaptLegacyTopupPayload(payload);
  return await rpcCreateAdjustmentV2(v2payload);
}

export async function createBalanceAdjustment(payload) {
  if (!USE_NEW_LEDGER) return await rpcCreateBalanceAdjustment(payload);
  const v2payload = await adaptLegacyAdjustmentPayload(payload);
  return await rpcCreateAdjustmentV2(v2payload);
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3.2 — guardLegacyOnly
//
// 10 операций ниже ещё не имеют v2-обёрток (Edit/Delete/Settle/Partner-IO).
// Когда USE_NEW_LEDGER=true, новый createDeal пишет в ledger.transactions,
// но эти follow-up действия молча шли бы в legacy public.deals → split-brain.
// Здесь fail-fast: бросаем понятный Error, UI поймает через withToast.
// ─────────────────────────────────────────────────────────────────────
function guardLegacyOnly(name, fn) {
  return async (...args) => {
    if (USE_NEW_LEDGER) {
      throw new Error(
        `${name}: v2 routing not supported yet. ` +
        `Disable VITE_USE_NEW_LEDGER (in Vercel env or .env.local) to perform this operation, ` +
        `or wait for v2 ${name} support to land.`
      );
    }
    return await fn(...args);
  };
}

export const updateDeal               = guardLegacyOnly("updateDeal",               rpcUpdateDeal);
export const deleteDeal               = guardLegacyOnly("deleteDeal",               rpcDeleteDeal);
export const completeDeal             = guardLegacyOnly("completeDeal",             rpcCompleteDeal);
export const deleteTransfer           = guardLegacyOnly("deleteTransfer",           rpcDeleteTransfer);
export const settleObligation         = guardLegacyOnly("settleObligation",         rpcSettleObligation);
export const settleObligationPartial  = guardLegacyOnly("settleObligationPartial",  rpcSettleObligationPartial);
export const receivePayment           = guardLegacyOnly("receivePayment",           rpcReceivePayment);
export const cancelObligation         = guardLegacyOnly("cancelObligation",         rpcCancelObligation);
export const recordPartnerInflow      = guardLegacyOnly("recordPartnerInflow",      rpcRecordPartnerInflow);
export const recordPartnerOutflow     = guardLegacyOnly("recordPartnerOutflow",     rpcRecordPartnerOutflow);
