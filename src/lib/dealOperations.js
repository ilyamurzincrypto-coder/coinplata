// src/lib/dealOperations.js
//
// ⚠️ TEMPORARY STUB — DO NOT EDIT WITHOUT COORDINATION WITH LEDGER INSTANCE
//
// Full dealOperations.js lives in `ledger/direction2-write-wrappers` branch.
// When that branch merges to main, it MUST OVERWRITE this stub completely
// (full adapter has account_code resolution, error mapping, partner support,
// idempotency, legacy_only protection, cross-currency transfer routing).
//
// Verify after merge:
//   • All 7+ export functions present
//   • Each calls correct V2 wrapper from newLedger.js
//   • USE_NEW_LEDGER switcher in each (with adapter for legacy → v2 shape)
//   • Tests in tests/dealOperations.test.js pass (from ledger branch)
//
// Why a stub:
//   • UI track (этап 4 Submit) needs `createDeal` to compile and run
//   • Direction 2 backend (full version) is in separate branch
//   • Both branches will converge при final merge
//
// Behavior:
//   • USE_NEW_LEDGER=true  → calls rpcCreate*V2 directly
//                            (UI buildTx output is already v2-shape camelCase)
//   • USE_NEW_LEDGER=false → calls legacy rpc*  (для legacy ExchangeForm path)

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
  rpcCreateTopupV2,
  rpcCreateWithdrawalV2,
  rpcCreateTransferV2,
  rpcCreateReservationV2,
  rpcReleaseReservationV2,
  USE_NEW_LEDGER,
} from "./newLedger.js";

// rpcCreateAdjustmentV2, rpcUpdateDealV2, rpcUpdateTxMetadataV2 — добавлены
// в ledger/direction2-write-wrappers ветке. На main пока их нет.
// Stub fallback на legacy для createAdjustment до merge Direction 2.

// ─── CREATE operations (switched по USE_NEW_LEDGER) ───

export async function createDeal(payload) {
  if (USE_NEW_LEDGER) return await rpcCreateDealV2(payload);
  return await rpcCreateDeal(payload);
}

export async function createTopup(payload) {
  if (USE_NEW_LEDGER) return await rpcCreateTopupV2(payload);
  return await rpcTopUp(payload);
}

export async function createWithdrawal(payload) {
  if (USE_NEW_LEDGER) return await rpcCreateWithdrawalV2(payload);
  // Legacy не имеет direct withdrawal RPC — fallback на partner outflow
  // (semantics-mismatch, но stub-only). Полный switcher в Direction 2.
  return await rpcRecordPartnerOutflow(payload);
}

export async function createTransfer(payload) {
  if (USE_NEW_LEDGER) return await rpcCreateTransferV2(payload);
  return await rpcCreateTransfer(payload);
}

export async function createReservation(payload) {
  if (USE_NEW_LEDGER) return await rpcCreateReservationV2(payload);
  // Legacy не имеет direct reservation RPC. Direction 2 adapter
  // обработает через obligations. Stub: throw для явного сигнала.
  throw new Error(
    "createReservation: legacy path not supported in stub. " +
    "Wait for Direction 2 merge or enable VITE_USE_NEW_LEDGER=true."
  );
}

export async function releaseReservation(payload) {
  if (USE_NEW_LEDGER) return await rpcReleaseReservationV2(payload);
  throw new Error(
    "releaseReservation: legacy path not supported in stub. " +
    "Wait for Direction 2 merge."
  );
}

export async function createAdjustment(payload) {
  // rpcCreateAdjustmentV2 не доступен в main до Direction 2 merge.
  // Под USE_NEW_LEDGER=true сейчас все равно legacy (полный switcher
  // от ledger-инстанса заменит).
  return await rpcCreateBalanceAdjustment(payload);
}

// ─── EDIT/DELETE — legacy passthrough (Direction 3 mapping) ───

export const updateDeal = rpcUpdateDeal;
export const deleteDeal = rpcDeleteDeal;
export const completeDeal = rpcCompleteDeal;
export const deleteTransfer = rpcDeleteTransfer;
export const settleObligation = rpcSettleObligation;
export const settleObligationPartial = rpcSettleObligationPartial;
export const receivePayment = rpcReceivePayment;
export const cancelObligation = rpcCancelObligation;
export const recordPartnerInflow = rpcRecordPartnerInflow;
export const recordPartnerOutflow = rpcRecordPartnerOutflow;
