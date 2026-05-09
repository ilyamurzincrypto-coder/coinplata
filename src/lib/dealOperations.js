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
  rpcCreateWithdrawalV2,
  rpcCreateTopupV2,
  rpcUpdateDealV2,
  rpcReverseTransactionV2,
  rpcCompleteDealLegV2,
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

  if (v2payload.kind === "withdrawal") {
    return await rpcCreateWithdrawalV2(v2payload);
  }
  if (v2payload.kind === "topup") {
    return await rpcCreateTopupV2(v2payload);
  }

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
// Tasks 1.12–1.14 — v2 wrappers for follow-up cashier mutations.
//
// До этого 10 операций ниже были guardLegacyOnly-stub'ами, бросавшими
// fail-fast при USE_NEW_LEDGER=true (split-brain prevention). Теперь у
// каждой есть real v2 implementation через RPC из newLedger.js. Legacy
// fallback сохраняется: если USE_NEW_LEDGER=false → старый rpc.
// ─────────────────────────────────────────────────────────────────────

export async function updateDeal(payload) {
  if (!USE_NEW_LEDGER) return await rpcUpdateDeal(payload);
  // v2: payload shape mirrors legacy enough that rpcUpdateDealV2 accepts it directly.
  return await rpcUpdateDealV2(payload);
}

export async function deleteDeal(dealId, reason = "manual") {
  if (!USE_NEW_LEDGER) return await rpcDeleteDeal(dealId, reason);
  // v2: don't delete posted transactions — reverse them with a compensating entry.
  return await rpcReverseTransactionV2({
    targetTxId: dealId,
    reason: `deleteDeal: ${reason}`,
    cascade: true,
  });
}

export async function completeDeal(dealId) {
  if (!USE_NEW_LEDGER) return await rpcCompleteDeal(dealId);
  // v2: complete each deferred leg of this deal in turn.
  // Caller-side leg list is fetched from public.deal_legs; for now we
  // pass the dealId and rely on backend `complete_deal_leg` to iterate.
  return await rpcCompleteDealLegV2({ dealTxId: dealId });
}

export async function deleteTransfer(transferId) {
  if (!USE_NEW_LEDGER) return await rpcDeleteTransfer(transferId);
  return await rpcReverseTransactionV2({
    targetTxId: transferId,
    reason: "deleteTransfer",
    cascade: true,
  });
}

export async function settleObligation(obligationId, accountId, amount) {
  if (!USE_NEW_LEDGER) return await rpcSettleObligation(obligationId, accountId, amount);
  // v2: settle = complete the deferred leg associated with the obligation.
  return await rpcCompleteDealLegV2({
    obligationId,
    paymentAccountId: accountId,
    amount,
  });
}

export async function settleObligationPartial(obligationId, accountId, amount) {
  if (!USE_NEW_LEDGER) return await rpcSettleObligationPartial(obligationId, accountId, amount);
  return await rpcCompleteDealLegV2({
    obligationId,
    paymentAccountId: accountId,
    amount,
    partial: true,
  });
}

export async function receivePayment(obligationId, accountId, amount) {
  if (!USE_NEW_LEDGER) return await rpcReceivePayment(obligationId, accountId, amount);
  return await rpcCreateAdjustmentV2({
    kind: "receive_payment",
    obligationId,
    accountId,
    amount,
  });
}

export async function cancelObligation(obligationId) {
  if (!USE_NEW_LEDGER) return await rpcCancelObligation(obligationId);
  return await rpcReverseTransactionV2({
    targetObligationId: obligationId,
    reason: "cancelObligation",
  });
}

export async function recordPartnerInflow(payload) {
  if (!USE_NEW_LEDGER) return await rpcRecordPartnerInflow(payload);
  return await rpcCreateAdjustmentV2({
    kind: "partner_inflow",
    partnerAccountId: payload.partnerAccountId,
    amount: payload.amount,
    currency: payload.currency,
    note: payload.note || null,
  });
}

export async function recordPartnerOutflow(payload) {
  if (!USE_NEW_LEDGER) return await rpcRecordPartnerOutflow(payload);
  return await rpcCreateAdjustmentV2({
    kind: "partner_outflow",
    partnerAccountId: payload.partnerAccountId,
    amount: payload.amount,
    currency: payload.currency,
    fromAccountId: payload.fromAccountId,
    note: payload.note || null,
  });
}
