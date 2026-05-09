// src/lib/newLedger.js
// Обёртки над новыми ledger.* RPC (подпакет 2).
//
// Каждая функция:
//   1. Валидирует isSupabaseConfigured.
//   2. Принимает frontend-friendly payload.
//   3. Генерирует idempotency_key (UUID v4) если не передан.
//   4. Считает request_hash (SHA-256 от canonical-JSON параметров).
//   5. Вызывает supabase.rpc('ledger.<name>', ...).
//   6. При ошибке бросает Error с message из БД (включая HINT/DETAIL).
//   7. При успехе вызывает bumpDataVersion().
//
// Контракт ledger RPC см. supabase migrations 2.a-2.e.
//
// Эти обёртки используются ТОЛЬКО когда VITE_USE_NEW_LEDGER=true.
// Legacy rpcCreateDeal в supabaseWrite.js остаётся неизменным до cutover.

import { supabase, isSupabaseConfigured } from "./supabase.js";
import { bumpDataVersion } from "./dataVersion.jsx";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase not configured");
  }
}

// UUID v4 generator. Использует crypto.randomUUID() везде где доступен
// (modern браузеры + Node 19+); fallback на crypto.getRandomValues для
// старых browsers.
export function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Canonical JSON serialization — детерминированный stringify с
// отсортированными ключами и no-whitespace. Гарантирует что одинаковый
// payload даёт одинаковый hash независимо от порядка ключей.
//
// Поддерживает: object, array, string, number, boolean, null, undefined→omit.
// Не поддерживает: Date (передавайте как ISO string), BigInt, functions.
export function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

// SHA-256 hex hash от canonical-JSON. Async (Web Crypto API).
export async function requestHash(payload) {
  const canonical = canonicalJson(payload);
  const data = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Standard error formatter. ledger RPC раскидывают ERRCODE: P0422 idempotency,
// P0001 insufficient balance, 22000 invalid params, P0002 not found.
function formatLedgerError(error) {
  if (!error) return "Unknown error";
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.details && error.details !== error.message) parts.push(error.details);
  if (error.hint && !parts.some((p) => p && p.includes(error.hint))) parts.push(error.hint);
  return parts.filter(Boolean).join(" · ") || "Unknown error";
}

// Wrapper for invoke + error parsing + bumpDataVersion.
async function invokeLedger(rpcName, params) {
  assertConfigured();
  const { data, error } = await supabase.rpc(rpcName, params);
  if (error) {
    throw new Error(formatLedgerError(error));
  }
  bumpDataVersion();
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// RPC wrappers
// ─────────────────────────────────────────────────────────────────────

/**
 * ledger.create_topup — клиент сдал средства на наш счёт.
 *
 * @param {Object} payload
 * @param {string} payload.clientId
 * @param {string} payload.accountCode  — куда зачислили: '1110','1316',...
 * @param {number|string} payload.amount
 * @param {string} payload.currencyCode
 * @param {string} [payload.description]
 * @param {string} [payload.externalRef]  — tx_hash, банк-ref
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string>} transaction_id (uuid)
 */
export async function rpcCreateTopupV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_client_id: payload.clientId,
    p_account_code: payload.accountCode,
    p_amount: payload.amount,
    p_currency_code: payload.currencyCode,
    p_description: payload.description ?? "Customer topup",
    p_external_ref: payload.externalRef ?? null,
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("create_topup", params);
}

/**
 * ledger.create_withdrawal — клиент снимает с баланса.
 *
 * @param {Object} payload
 * @param {string} payload.clientId
 * @param {string} payload.currencyCode
 * @param {number|string} payload.amount
 * @param {string} payload.destinationAccount  — '1316','1350','1110',...
 * @param {Object} [payload.networkFee]  — { amount, accountCode }
 * @param {'exchange'|'client'} [payload.feePaidBy='exchange']
 * @param {string} [payload.externalRef]
 * @param {string} [payload.description]
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string>} transaction_id
 */
export async function rpcCreateWithdrawalV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const metadata = { ...(payload.metadata ?? {}) };
  if (payload.feePaidBy) metadata.fee_paid_by = payload.feePaidBy;
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_client_id: payload.clientId,
    p_currency_code: payload.currencyCode,
    p_amount: payload.amount,
    p_destination_account: payload.destinationAccount,
    p_network_fee: payload.networkFee
      ? { amount: payload.networkFee.amount, account_code: payload.networkFee.accountCode }
      : null,
    p_external_ref: payload.externalRef ?? null,
    p_description: payload.description ?? "Customer withdrawal",
    p_metadata: metadata,
  };
  return await invokeLedger("create_withdrawal", params);
}

/**
 * ledger.create_deal_v2 — главная FX-сделка.
 *
 * @param {Object} payload
 * @param {string} payload.clientId
 * @param {string} payload.officeId
 * @param {Array<{currency, amount, source: 'fresh'|'from_balance', accountCode?, rate?, rateSource?}>} payload.inLegs
 * @param {Array<{currency, amount, destination: 'physical'|'to_balance', accountCode?, rate?, rateSource?, deferred?}>} payload.outLegs
 * @param {Array<{currency, amount, kind: 'commission'|'spread'}>} payload.commission
 * @param {string} [payload.description]
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<{deal_tx_id, settle_tx_ids, recognition_tx_id}>}
 */
export async function rpcCreateDealV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const inLegs = payload.inLegs.map((l) => ({
    currency: l.currency,
    amount: l.amount,
    source: l.source,
    account_code: l.accountCode,
    rate: l.rate,
    rate_source: l.rateSource,
  }));
  const outLegs = payload.outLegs.map((l) => ({
    currency: l.currency,
    amount: l.amount,
    destination: l.destination,
    account_code: l.accountCode,
    rate: l.rate,
    rate_source: l.rateSource,
    deferred: l.deferred ?? false,
  }));
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_client_id: payload.clientId,
    p_office_id: payload.officeId,
    p_in_legs: inLegs,
    p_out_legs: outLegs,
    p_commission: payload.commission,
    p_description: payload.description ?? null,
    p_metadata: payload.metadata ?? {},
  };
  const data = await invokeLedger("create_deal_v2", params);
  // RETURNS TABLE → Supabase возвращает массив одной строки
  return Array.isArray(data) ? data[0] : data;
}

/**
 * ledger.complete_deal_leg — закрытие deferred OUT-ноги.
 *
 * @param {Object} payload
 * @param {string} payload.dealId
 * @param {string} payload.currencyCode
 * @param {number|string} payload.amount
 * @param {string} payload.accountCode
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<{settle_tx_id, recognition_tx_id}>}
 */
export async function rpcCompleteDealLegV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_deal_id: payload.dealId,
    p_currency_code: payload.currencyCode,
    p_amount: payload.amount,
    p_account_code: payload.accountCode,
    p_metadata: payload.metadata ?? {},
  };
  const data = await invokeLedger("complete_deal_leg", params);
  return Array.isArray(data) ? data[0] : data;
}

/**
 * ledger.create_transfer — внутренний перевод между нашими счетами.
 *
 * @param {Object} payload
 * @param {string} payload.fromAccountCode
 * @param {string} payload.toAccountCode
 * @param {number|string} payload.amount
 * @param {string} payload.currencyCode
 * @param {Object} [payload.fee]  — { amount, accountCode }
 * @param {string} [payload.description]
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string>} transaction_id
 */
export async function rpcCreateTransferV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_from_account_code: payload.fromAccountCode,
    p_to_account_code: payload.toAccountCode,
    p_amount: payload.amount,
    p_currency_code: payload.currencyCode,
    p_fee: payload.fee
      ? { amount: payload.fee.amount, account_code: payload.fee.accountCode }
      : null,
    p_description: payload.description ?? "Internal transfer",
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("create_transfer", params);
}

/**
 * ledger.create_reservation — hold средств.
 *
 * @param {Object} payload
 * @param {string} payload.sourceAccount
 * @param {number|string} payload.amount
 * @param {string} payload.currencyCode
 * @param {string} payload.purposeRef  — 'deal:<uuid>' / 'withdrawal:<id>'
 * @param {string} [payload.description]
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string>} reservation_tx_id
 */
export async function rpcCreateReservationV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_source_account: payload.sourceAccount,
    p_amount: payload.amount,
    p_currency_code: payload.currencyCode,
    p_purpose_ref: payload.purposeRef,
    p_description: payload.description ?? "Reservation hold",
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("create_reservation", params);
}

/**
 * ledger.release_reservation — release без settlement.
 *
 * @param {Object} payload
 * @param {string} payload.reservationTxId
 * @param {string} [payload.description]
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string>} release_tx_id
 */
export async function rpcReleaseReservationV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_reservation_tx_id: payload.reservationTxId,
    p_description: payload.description ?? "Reservation release",
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("release_reservation", params);
}

/**
 * ledger.reverse_transaction — reverse с cascade.
 *
 * @param {Object} payload
 * @param {string} payload.targetTxId
 * @param {string} payload.reason  — обязательно (audit-trail)
 * @param {boolean} [payload.cascade=true]
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string[]>} массив reverse-tx_ids (1 или больше при cascade)
 */
export async function rpcReverseTransactionV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_target_tx_id: payload.targetTxId,
    p_reason: payload.reason,
    p_cascade: payload.cascade ?? true,
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("reverse_transaction", params);
}

/**
 * ledger.update_deal_v2 — atomic edit (reverse cascade + create new).
 * Replay через own idempotency_key возвращает cached result.
 *
 * @param {Object} payload
 * @param {string} payload.targetTxId  — tx_id оригинального deal
 * @param {Object} payload.newPayload  — full create_deal_v2 shape:
 *   { client_id, office_id, in_legs[], out_legs[], commission[],
 *     description?, metadata? }
 * @param {string} payload.reason       — обязательно (audit)
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<{reversed_tx_ids, new_deal_tx_id, new_settle_tx_ids, new_recognition_tx_id}>}
 */
export async function rpcUpdateDealV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_target_tx_id: payload.targetTxId,
    p_new_payload: payload.newPayload,
    p_reason: payload.reason,
    p_metadata: payload.metadata ?? {},
  };
  const data = await invokeLedger("update_deal_v2", params);
  return Array.isArray(data) ? data[0] : data;
}

/**
 * ledger.create_adjustment — manual adjustment (admin-only).
 *
 * @param {Object} payload
 * @param {string} payload.accountCode
 * @param {number|string} payload.amount   — может быть negative
 * @param {string} payload.currencyCode
 * @param {string} payload.reason          — обязательно
 * @param {'reconciliation'|'transfer'|'opening'} payload.adjustmentKind
 * @param {string} [payload.balancingAccount]  — REQUIRED для transfer kind
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string>} tx_id
 */
export async function rpcCreateAdjustmentV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_account_code: payload.accountCode,
    p_amount: payload.amount,
    p_currency_code: payload.currencyCode,
    p_reason: payload.reason,
    p_adjustment_kind: payload.adjustmentKind,
    p_balancing_account: payload.balancingAccount ?? null,
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("create_adjustment", params);
}

/**
 * ledger.update_tx_metadata — whitelist patch для tx.metadata.
 *
 * @param {Object} payload
 * @param {string} payload.txId
 * @param {Object} payload.patch  — JSONB merge object
 * @param {string} [payload.idempotencyKey]
 */
export async function rpcUpdateTxMetadataV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_tx_id: payload.txId,
    p_patch: payload.patch,
  };
  return await invokeLedger("update_tx_metadata", params);
}

// ─────────────────────────────────────────────────────────────────────
// Operations Workflow Layer (operations.* RPCs)
// ─────────────────────────────────────────────────────────────────────

/**
 * operations.create_workflow — создать workflow для ledger transaction.
 *
 * @param {Object} payload
 * @param {string} payload.ledgerTxId
 * @param {'draft'|'awaiting_payment'|'awaiting_release'|'partial'|'done'|'cancelled'} [payload.initialStatus='awaiting_release']
 * @param {Array<{leg_id, currency, amount, kind, account_code, due_at?}>} [payload.openLegs=[]]
 * @param {string} [payload.notes]
 * @param {string} [payload.assignedTo]
 * @param {string} [payload.dueDate]
 * @param {Object} [payload.metadata]
 * @returns {Promise<string>} workflow_id
 */
export async function rpcCreateWorkflowV2(payload) {
  const params = {
    p_ledger_tx_id: payload.ledgerTxId,
    p_initial_status: payload.initialStatus || "awaiting_release",
    p_open_legs: payload.openLegs ?? [],
    p_notes: payload.notes ?? null,
    p_assigned_to: payload.assignedTo ?? null,
    p_due_date: payload.dueDate ?? null,
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("create_workflow", params);
}

/**
 * operations.update_workflow_status — manual status transition.
 *
 * @param {Object} payload
 * @param {string} payload.workflowId
 * @param {string} payload.newStatus
 * @param {string} [payload.note]
 * @param {string} [payload.idempotencyKey]
 */
export async function rpcUpdateWorkflowStatusV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_workflow_id: payload.workflowId,
    p_new_status: payload.newStatus,
    p_note: payload.note ?? null,
    p_idempotency_key: key,
  };
  return await invokeLedger("update_workflow_status", params);
}

/**
 * operations.cancel_workflow — cancel с обязательным reason.
 *
 * @param {Object} payload
 * @param {string} payload.workflowId
 * @param {string} payload.reason — required
 */
export async function rpcCancelWorkflowV2(payload) {
  const params = {
    p_workflow_id: payload.workflowId,
    p_reason: payload.reason,
  };
  return await invokeLedger("cancel_workflow", params);
}

// ─────────────────────────────────────────────────────────────────────
// Feature-flag helper — проверяет VITE_USE_NEW_LEDGER.
//
// EMERGENCY ROLLBACK (2026-05-10): production cutover вызвал белый экран
// на coinplata.vercel.app. Возвращаем kill-switch до выяснения причины.
// USE_NEW_LEDGER теперь требует ОБА VITE_USE_NEW_LEDGER=true И
// VITE_FORCE_V2=true (последняя в Vercel отсутствует → kill-switch активен).
// После диагностики — убрать опять и заново задеплоить.
// ─────────────────────────────────────────────────────────────────────
const _ENV = typeof import.meta !== "undefined" ? import.meta.env : null;
const _V2_FORCE_OPT_IN = _ENV?.VITE_FORCE_V2 === "true";

export const USE_NEW_LEDGER =
  _V2_FORCE_OPT_IN && _ENV?.VITE_USE_NEW_LEDGER === "true";
