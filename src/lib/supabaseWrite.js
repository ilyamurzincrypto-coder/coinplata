// src/lib/supabaseWrite.js
// Writers — обёртки над Supabase RPC / direct insert. Все писатели:
//   1. Валидируют isSupabaseConfigured (иначе fall-through на legacy in-memory).
//   2. Выполняют операцию.
//   3. При ошибке бросают err с человеческим message.
//   4. При успехе вызывают bumpDataVersion() → stores рефетчат данные.
//
// Вызывающий код оборачивает в try/catch и тоcтит success/error.

import { supabase, isSupabaseConfigured } from "./supabase.js";
import { bumpDataVersion } from "./dataVersion.jsx";
import { emitToast } from "./toast.jsx";

// Supabase возвращает ошибки в виде { message, details, hint, code }.
// Формируем человекочитаемый message без дублирования кода.
function formatSupabaseError(error, context) {
  if (!error) return "Unknown error";
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.details && error.details !== error.message) parts.push(error.details);
  if (error.hint && !parts.some((p) => p && p.includes(error.hint))) parts.push(error.hint);
  const msg = parts.filter(Boolean).join(" · ") || "Unknown error";
  // Логируем в консоль с контекстом — для debug, но не шумим stack trace'ами.
  // eslint-disable-next-line no-console
  console.warn(`[supabaseWrite]${context ? " " + context : ""} RPC error`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
  return msg;
}

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase not configured");
  }
}

function unwrap({ data, error }, context) {
  if (error) {
    throw new Error(formatSupabaseError(error, context));
  }
  return data;
}

// Guards — выбрасывают error если payload невалиден. Ловятся withToast выше по стеку.
function requireNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${field}: invalid number (${value})`);
  }
  return n;
}

function requirePositive(value, field) {
  const n = requireNumber(value, field);
  if (n <= 0) {
    throw new Error(`${field}: must be > 0 (got ${n})`);
  }
  return n;
}

function requireCurrency(value, field) {
  if (typeof value !== "string" || value.length < 2 || value.length > 10) {
    throw new Error(`${field}: invalid currency "${value}"`);
  }
  return value.toUpperCase();
}

function requireUuid(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field}: required`);
  }
  return value;
}

// Проверка — похоже ли значение на UUID (DB-ID), а не on локальный in-memory
// префикс (cp_, u_, a_, tx_, ob_, m_, rs_, cat_, ie_, w_, tr_, p_, ch_, office_, evt_).
// Используется чтобы не слать FK-битые строки в RPC.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

// Возвращает value если это UUID, иначе null.
// Nickname сохранится в client_nickname столбце deal'а — связь не теряется.
export function uuidOrNull(value) {
  return isUuid(value) ? value : null;
}

// Переводит frontend deal.outputs → jsonb[] для RPC create_deal / update_deal.
// Бросает error если outputs пустой или какой-то leg без amount/currency/rate.
//
// Опциональное поле pay_now (number, 0..amount):
//   * undefined   → auto-логика (full payout если балансы ОК, иначе we_owe)
//   * 0           → defer out (полный we_owe, OUT movement не создаётся)
//   * 0 < x < amount → partial (платим x сейчас, остаток we_owe)
//   * == amount   → эквивалент auto (full payout forced)
// 0081-aware: каждая leg теперь может иметь out_kind ∈
// {ours_now, ours_later, partner_now, partner_later} и payments[] —
// массив частичных оплат вида {amount, kind, account_id?, partner_account_id?, paid_at?, note?}.
// Старые поля (accountId/partnerAccountId/payNow) продолжают работать.
const OUT_KINDS = new Set(["ours_now", "ours_later", "partner_now", "partner_later"]);

function paymentsToJsonb(payments, ctxLabel) {
  if (!Array.isArray(payments) || payments.length === 0) return [];
  return payments.map((p, i) => {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`${ctxLabel} payment ${i + 1}: invalid amount (${p.amount})`);
    }
    const kind = p.kind || "ours_now";
    if (!["ours_now", "partner_now"].includes(kind)) {
      throw new Error(`${ctxLabel} payment ${i + 1}: kind должен быть ours_now или partner_now`);
    }
    const out = { amount, kind };
    // Multi-currency: SQL create_deal читает payment.currency и пишет
    // account_movements в этой валюте; fallback на p_currency_in.
    if (p.currency) {
      out.currency = String(p.currency).toUpperCase();
    }
    if (kind === "ours_now") {
      if (!p.accountId) {
        throw new Error(`${ctxLabel} payment ${i + 1}: account_id required for ours_now`);
      }
      out.account_id = p.accountId;
    } else {
      if (!p.partnerAccountId) {
        throw new Error(`${ctxLabel} payment ${i + 1}: partner_account_id required for partner_now`);
      }
      out.partner_account_id = p.partnerAccountId;
    }
    if (p.paidAt) out.paid_at = String(p.paidAt);
    if (p.note != null && String(p.note).trim()) out.note = String(p.note).trim();
    return out;
  });
}

export function legsToJsonb(outputs) {
  // Пустой массив легов разрешён — это односторонний IN (контрагент только
  // вносит, без выдачи). SQL create_deal обрабатывает legs=[]: пропускает
  // OUT-loop, статус определяется по IN-side.
  if (!Array.isArray(outputs)) return [];
  if (outputs.length === 0) return [];
  return outputs.map((o, idx) => {
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Output ${idx + 1}: invalid amount (${o.amount})`);
    }
    // Rate бессмысленен для односторонних OUT-сделок (нет конверсии,
    // мы просто отдаём). Если юзер не ввёл — подставляем sentinel 1.
    // SQL create_deal margin-loop посчитает margin=0 для такого leg
    // что корректно: нет IN — нет profit от обмена.
    let rate = Number(o.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      rate = 1;
    }
    if (typeof o.currency !== "string" || o.currency.length < 2) {
      throw new Error(`Output ${idx + 1}: missing currency`);
    }
    if (o.accountId && o.partnerAccountId) {
      throw new Error(`Output ${idx + 1}: либо наш счёт либо партнёрский, не оба`);
    }
    // out_kind: явный, либо derive
    let outKind = o.outKind || null;
    if (outKind && !OUT_KINDS.has(outKind)) {
      throw new Error(`Output ${idx + 1}: unknown out_kind=${outKind}`);
    }
    if (!outKind) {
      if (o.partnerAccountId) outKind = "partner_now";
      else if (o.accountId) outKind = "ours_now";
      else outKind = "ours_later";
    }
    // _later → ни account, ни partner_account
    const isLater = outKind === "ours_later" || outKind === "partner_later";
    const leg = {
      currency: o.currency.toUpperCase(),
      amount,
      rate,
      out_kind: outKind,
      account_id: isLater ? null : (o.partnerAccountId ? null : (o.accountId || null)),
      partner_account_id: isLater ? null : (o.partnerAccountId || null),
      address: o.address ? String(o.address).trim() : null,
      network_id: o.network || null,
    };
    // payments[] — multi-payment поддержка (0081)
    if (Array.isArray(o.payments) && o.payments.length > 0) {
      leg.payments = paymentsToJsonb(o.payments, `Output ${idx + 1}`);
    }
    if (o.payNow != null) {
      const pn = Number(o.payNow);
      if (!Number.isFinite(pn) || pn < 0) {
        throw new Error(`Output ${idx + 1}: invalid pay_now (${o.payNow})`);
      }
      leg.pay_now = Math.min(pn, amount);
    }
    return leg;
  });
}

// Экспортируем для wizard'а (он строит p_in_payments и leg.payments)
export { paymentsToJsonb };

// ---------- deals ----------

const DEAL_STATUSES = new Set(["completed", "pending", "checking", "deleted"]);

const IN_KINDS = new Set(["ours_now", "ours_later", "partner_now", "partner_later"]);
const DEAL_KINDS = new Set(["regular", "otc", "broker"]);

export async function rpcCreateDeal({
  officeId,
  managerId,
  clientId,
  clientNickname,
  currencyIn,
  amountIn,
  inAccountId,
  inPartnerAccountId,
  inTxHash,
  referral,
  comment,
  status,
  outputs,
  plannedAt,
  deferredIn,
  applyMinFee,
  commissionUsd,
  inKind,           // 0081: ours_now/ours_later/partner_now/partner_later
  inPayments,       // 0081: [{amount, kind, accountId?, partnerAccountId?, paidAt?, note?}]
  kind,             // 0081: regular/otc/broker
  customFeeUsd,     // null = авто (margin/min_fee), число = override
}) {
  assertConfigured();
  const validOffice = requireUuid(officeId, "officeId");
  const validManager = requireUuid(managerId, "managerId");
  const validCur = requireCurrency(currencyIn, "currencyIn");
  // amount_in >= 0 — 0 разрешён для односторонних OUT-сделок (мы только
  // отдаём, без приёма от контрагента). SQL create_deal обрабатывает
  // amount_in=0 как "skip IN side" (миграция allow_zero_amount_in).
  const amountInNum = requireNumber(amountIn, "amountIn");
  if (amountInNum < 0) {
    throw new Error(`amountIn: must be >= 0 (got ${amountInNum})`);
  }
  const validAmt = amountInNum;
  const validStatus = DEAL_STATUSES.has(status) ? status : "completed";
  if (inAccountId && inPartnerAccountId) {
    throw new Error("Either inAccountId or inPartnerAccountId, not both");
  }
  if (inKind && !IN_KINDS.has(inKind)) throw new Error(`unknown inKind: ${inKind}`);
  if (kind && !DEAL_KINDS.has(kind)) throw new Error(`unknown kind: ${kind}`);
  const legs = legsToJsonb(outputs);
  const validPlannedAt = plannedAt ? String(plannedAt) : null;
  const skipMinFee = applyMinFee === false;
  const validCommission = commissionUsd != null ? Number(commissionUsd) : 0;
  const validInPayments = Array.isArray(inPayments) && inPayments.length > 0
    ? paymentsToJsonb(inPayments, "IN")
    : [];

  const payload = {
    p_office_id: validOffice,
    p_manager_id: validManager,
    p_client_id: clientId || null,
    p_client_nickname: clientNickname ? String(clientNickname).trim() : null,
    p_currency_in: validCur,
    p_amount_in: validAmt,
    // При amtIn=0 односторонняя OUT-сделка: in_account_id должен быть null,
    // иначе CHECK in_kind_consistency упадёт (ours_later требует null).
    p_in_account_id: validAmt > 0 ? (inAccountId || null) : null,
    p_in_tx_hash: inTxHash ? String(inTxHash).trim() : null,
    p_referral: !!referral,
    p_comment: comment || "",
    p_status: validStatus,
    p_legs: legs,
    p_planned_at: validPlannedAt,
    p_deferred_in: !!deferredIn,
    p_skip_min_fee: skipMinFee,
  };
  if (inPartnerAccountId && validAmt > 0) {
    payload.p_in_partner_account_id = requireUuid(inPartnerAccountId, "inPartnerAccountId");
  }
  if (validCommission > 0) {
    payload.p_commission_usd = validCommission;
  }
  if (inKind) payload.p_in_kind = inKind;
  if (validInPayments.length > 0) payload.p_in_payments = validInPayments;
  if (kind) payload.p_kind = kind;
  if (customFeeUsd != null && Number.isFinite(Number(customFeeUsd))) {
    payload.p_custom_fee_usd = Number(customFeeUsd);
  }

  const dealId = unwrap(await supabase.rpc("create_deal", payload), "create_deal");
  bumpDataVersion();
  return dealId;
}

export async function rpcUpdateDeal({
  dealId,
  officeId,
  clientId,
  clientNickname,
  currencyIn,
  amountIn,
  inAccountId,
  inPartnerAccountId,
  inTxHash,
  referral,
  comment,
  status,
  outputs,
  plannedAt,
  deferredIn,
  applyMinFee,
  commissionUsd,
  inKind,
  inPayments,
  kind,
}) {
  assertConfigured();
  const validDealId = requirePositive(dealId, "dealId");
  const validOffice = requireUuid(officeId, "officeId");
  const validCur = requireCurrency(currencyIn, "currencyIn");
  // amount_in >= 0 — см. комментарий в rpcCreateDeal.
  const amountInNum = requireNumber(amountIn, "amountIn");
  if (amountInNum < 0) {
    throw new Error(`amountIn: must be >= 0 (got ${amountInNum})`);
  }
  const validAmt = amountInNum;
  const validStatus = DEAL_STATUSES.has(status) ? status : "completed";
  if (inAccountId && inPartnerAccountId) {
    throw new Error("Either inAccountId or inPartnerAccountId, not both");
  }
  if (inKind && !IN_KINDS.has(inKind)) throw new Error(`unknown inKind: ${inKind}`);
  if (kind && !DEAL_KINDS.has(kind)) throw new Error(`unknown kind: ${kind}`);
  const legs = legsToJsonb(outputs);
  const validPlannedAt = plannedAt ? String(plannedAt) : null;
  const skipMinFee = applyMinFee === false;
  const validCommission = commissionUsd != null ? Number(commissionUsd) : 0;
  const validInPayments = Array.isArray(inPayments) && inPayments.length > 0
    ? paymentsToJsonb(inPayments, "IN")
    : [];

  const payload = {
    p_deal_id: validDealId,
    p_office_id: validOffice,
    p_client_id: clientId || null,
    p_client_nickname: clientNickname ? String(clientNickname).trim() : null,
    p_currency_in: validCur,
    p_amount_in: validAmt,
    p_in_account_id: inAccountId || null,
    p_in_tx_hash: inTxHash ? String(inTxHash).trim() : null,
    p_referral: !!referral,
    p_comment: comment || "",
    p_status: validStatus,
    p_legs: legs,
    p_planned_at: validPlannedAt,
    p_deferred_in: !!deferredIn,
    p_skip_min_fee: skipMinFee,
  };
  if (inPartnerAccountId) {
    payload.p_in_partner_account_id = requireUuid(inPartnerAccountId, "inPartnerAccountId");
  }
  if (validCommission > 0) {
    payload.p_commission_usd = validCommission;
  }
  if (inKind) payload.p_in_kind = inKind;
  if (validInPayments.length > 0) payload.p_in_payments = validInPayments;
  if (kind) payload.p_kind = kind;

  unwrap(await supabase.rpc("update_deal", payload), "update_deal");
  bumpDataVersion();
}

// ---------- post-creation payments (0081) ----------

export async function rpcAddDealInPayment({
  dealId, amount, kind, accountId, partnerAccountId, paidAt, note,
}) {
  assertConfigured();
  const id = requirePositive(dealId, "dealId");
  const amt = requirePositive(amount, "amount");
  if (!["ours_now", "partner_now"].includes(kind)) {
    throw new Error(`kind must be ours_now or partner_now (got ${kind})`);
  }
  const payload = {
    p_deal_id: id,
    p_amount: amt,
    p_kind: kind,
    p_account_id: kind === "ours_now" ? requireUuid(accountId, "accountId") : null,
    p_partner_account_id: kind === "partner_now" ? requireUuid(partnerAccountId, "partnerAccountId") : null,
    p_paid_at: paidAt ? String(paidAt) : null,
    p_note: note ? String(note).trim() : null,
  };
  const paymentId = unwrap(await supabase.rpc("add_deal_in_payment", payload), "add_deal_in_payment");
  bumpDataVersion();
  return paymentId;
}

export async function rpcAddDealLegPayment({
  dealLegId, amount, kind, accountId, partnerAccountId, paidAt, note,
}) {
  assertConfigured();
  const id = requireUuid(dealLegId, "dealLegId");
  const amt = requirePositive(amount, "amount");
  if (!["ours_now", "partner_now"].includes(kind)) {
    throw new Error(`kind must be ours_now or partner_now (got ${kind})`);
  }
  const payload = {
    p_deal_leg_id: id,
    p_amount: amt,
    p_kind: kind,
    p_account_id: kind === "ours_now" ? requireUuid(accountId, "accountId") : null,
    p_partner_account_id: kind === "partner_now" ? requireUuid(partnerAccountId, "partnerAccountId") : null,
    p_paid_at: paidAt ? String(paidAt) : null,
    p_note: note ? String(note).trim() : null,
  };
  const paymentId = unwrap(await supabase.rpc("add_deal_leg_payment", payload), "add_deal_leg_payment");
  bumpDataVersion();
  return paymentId;
}

export async function rpcCompleteDeal(dealId) {
  assertConfigured();
  const id = requirePositive(dealId, "dealId");
  unwrap(
    await supabase.rpc("complete_deal", { p_deal_id: id }),
    "complete_deal"
  );
  bumpDataVersion();
}

export async function rpcDeleteDeal(dealId, reason = "") {
  assertConfigured();
  const id = requirePositive(dealId, "dealId");
  unwrap(
    await supabase.rpc("delete_deal", {
      p_deal_id: id,
      p_reason: reason || "",
    }),
    "delete_deal"
  );
  bumpDataVersion();
}

// Hard-delete — физически удаляет row из БД. Работает только на
// уже soft-deleted сделках (backend enforcing).
export async function rpcHardDeleteDeal(dealId) {
  assertConfigured();
  const id = requirePositive(dealId, "dealId");
  unwrap(
    await supabase.rpc("hard_delete_deal", { p_deal_id: id }),
    "hard_delete_deal"
  );
  bumpDataVersion();
}

export async function rpcConfirmDealLeg(dealId, legIndex) {
  assertConfigured();
  const id = requirePositive(dealId, "dealId");
  const idx = requireNumber(legIndex, "legIndex");
  if (idx < 0) throw new Error(`legIndex must be >= 0 (got ${idx})`);
  unwrap(
    await supabase.rpc("confirm_deal_leg", {
      p_deal_id: id,
      p_leg_index: idx,
    }),
    "confirm_deal_leg"
  );
  bumpDataVersion();
}

export async function rpcMarkDealSent({ dealId, legIndex, txHash, network }) {
  assertConfigured();
  const id = requirePositive(dealId, "dealId");
  const idx = requireNumber(legIndex, "legIndex");
  if (idx < 0) throw new Error(`legIndex must be >= 0 (got ${idx})`);
  if (typeof txHash !== "string" || txHash.trim().length < 4) {
    throw new Error("txHash: required");
  }
  unwrap(
    await supabase.rpc("mark_deal_sent", {
      p_deal_id: id,
      p_leg_index: idx,
      p_tx_hash: txHash.trim(),
      p_network: network || null,
    }),
    "mark_deal_sent"
  );
  bumpDataVersion();
}

// ---------- obligations ----------

export async function rpcSettleObligation(obligationId, accountId) {
  assertConfigured();
  const validOb = requireUuid(obligationId, "obligationId");
  const validAcc = requireUuid(accountId, "accountId");
  unwrap(
    await supabase.rpc("settle_obligation", {
      p_obligation_id: validOb,
      p_account_id: validAcc,
    }),
    "settle_obligation"
  );
  bumpDataVersion();
}

// Partial settle — закрываем obligation не полностью, а на конкретную сумму.
// RPC проверяет amount <= remaining (amount - paid_amount) и баланс счёта.
// При amount == remaining ведёт себя как settle_obligation (полный close).
export async function rpcSettleObligationPartial(obligationId, accountId, amount) {
  assertConfigured();
  const validOb = requireUuid(obligationId, "obligationId");
  const validAcc = requireUuid(accountId, "accountId");
  const validAmt = requirePositive(amount, "amount");
  unwrap(
    await supabase.rpc("settle_obligation_partial", {
      p_obligation_id: validOb,
      p_account_id: validAcc,
      p_amount: validAmt,
    }),
    "settle_obligation_partial"
  );
  bumpDataVersion();
}

// They_owe: клиент принёс деньги которые был должен. Создаёт IN movement
// на указанный аккаунт + увеличивает obligation.paid_amount.
export async function rpcReceivePayment(obligationId, accountId, amount) {
  assertConfigured();
  const validOb = requireUuid(obligationId, "obligationId");
  const validAcc = requireUuid(accountId, "accountId");
  const validAmt = requirePositive(amount, "amount");
  unwrap(
    await supabase.rpc("receive_payment", {
      p_obligation_id: validOb,
      p_account_id: validAcc,
      p_amount: validAmt,
    }),
    "receive_payment"
  );
  bumpDataVersion();
}

export async function rpcCancelObligation(obligationId) {
  assertConfigured();
  const validOb = requireUuid(obligationId, "obligationId");
  unwrap(
    await supabase.rpc("cancel_obligation", {
      p_obligation_id: validOb,
    }),
    "cancel_obligation"
  );
  bumpDataVersion();
}

// ---------- transfers / topup ----------

export async function rpcCreateTransfer({
  fromAccountId,
  toAccountId,
  fromAmount,
  toAmount,
  rate,
  note,
  toManagerId,
}) {
  assertConfigured();
  const from = requireUuid(fromAccountId, "fromAccountId");
  const to = requireUuid(toAccountId, "toAccountId");
  if (from === to) throw new Error("From and To accounts must differ");
  const fromAmt = requirePositive(fromAmount, "fromAmount");
  const toAmt = requirePositive(toAmount, "toAmount");
  const rateNum = rate == null ? null : requirePositive(rate, "rate");
  // toManagerId — опциональный; для interoffice — обязательный (P2P logic
  // 0052: transfer.pending до confirm от назначенного менеджера).
  const toMgr = toManagerId ? requireUuid(toManagerId, "toManagerId") : null;

  // p_to_manager_id отсылаем только когда задан — старая 0001 сигнатура
  // create_transfer без него; PostgREST overload resolution по именам.
  const payload = {
    p_from_account_id: from,
    p_to_account_id: to,
    p_from_amount: fromAmt,
    p_to_amount: toAmt,
    p_rate: rateNum,
    p_note: note || "",
  };
  if (toMgr) {
    payload.p_to_manager_id = toMgr;
  }
  const id = unwrap(
    await supabase.rpc("create_transfer", payload),
    "create_transfer"
  );
  bumpDataVersion();
  return id;
}

// ============================================================================
// Accounting review (миграция 0086) + cash closure (0087)
// ============================================================================

const ACCOUNTING_ENTITY_TYPES = new Set([
  "deal", "transfer", "expense", "balance_adjustment", "cash_closure",
]);
const ACCOUNTING_ACTIONS = new Set(["approve", "reject", "reset"]);

export async function rpcAccountingReview({ entityType, entityId, action, reason, notes }) {
  assertConfigured();
  if (!ACCOUNTING_ENTITY_TYPES.has(entityType)) {
    throw new Error(`Unknown entity_type: ${entityType}`);
  }
  if (!entityId) throw new Error("entityId required");
  if (!ACCOUNTING_ACTIONS.has(action)) {
    throw new Error(`action must be approve | reject | reset (got ${action})`);
  }
  if (action === "reject" && (!reason || !String(reason).trim())) {
    throw new Error("rejection reason required");
  }
  const id = unwrap(
    await supabase.rpc("accounting_review", {
      p_entity_type: entityType,
      p_entity_id: String(entityId),
      p_action: action,
      p_reason: reason ? String(reason).trim() : null,
      p_notes: notes ? String(notes).trim() : null,
    }),
    "accounting_review"
  );
  bumpDataVersion();
  return id;
}

export async function rpcAccountingReviewBulk({ items, action, reason, notes }) {
  assertConfigured();
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items: non-empty array required");
  }
  if (!ACCOUNTING_ACTIONS.has(action)) {
    throw new Error(`action must be approve | reject | reset`);
  }
  if (action === "reject" && (!reason || !String(reason).trim())) {
    throw new Error("rejection reason required");
  }
  const payload = items.map((it) => {
    if (!ACCOUNTING_ENTITY_TYPES.has(it.entityType)) {
      throw new Error(`Unknown entity_type: ${it.entityType}`);
    }
    return { entity_type: it.entityType, entity_id: String(it.entityId) };
  });
  const count = unwrap(
    await supabase.rpc("accounting_review_bulk", {
      p_items: payload,
      p_action: action,
      p_reason: reason ? String(reason).trim() : null,
      p_notes: notes ? String(notes).trim() : null,
    }),
    "accounting_review_bulk"
  );
  bumpDataVersion();
  return count;
}

// Удаление балансовой корректировки с откатом эмитированного movement (0094).
// Доступ: admin / owner. Баланс возвращается к pre-correction состоянию.
export async function rpcDeleteBalanceAdjustment(id) {
  assertConfigured();
  const aid = requireUuid(id, "id");
  unwrap(
    await supabase.rpc("delete_balance_adjustment", { p_id: aid }),
    "delete_balance_adjustment"
  );
  bumpDataVersion();
}

// Universal delete entity — wrapper над всеми delete-RPC по entity_type.
// Используется в AccountingTab чтобы удалить любую запись из feed.
export async function rpcDeleteEntity({ entityType, entityId }) {
  if (!entityId) throw new Error("entityId required");
  switch (entityType) {
    case "deal":
      return rpcDeleteDeal(entityId, "manual from accounting report");
    case "transfer":
      return rpcDeleteTransfer(entityId);
    case "expense":
      return deleteExpenseById(entityId);
    case "balance_adjustment":
      return rpcDeleteBalanceAdjustment(entityId);
    case "cash_closure":
      return rpcCancelCashClosure(entityId);
    default:
      throw new Error(`Unknown entity_type: ${entityType}`);
  }
}

// Удаление перемещения с откатом обоих movements (миграция 0093).
// Доступ: admin / owner. Балансы счетов восстанавливаются.
export async function rpcDeleteTransfer(id) {
  assertConfigured();
  const tid = requireUuid(id, "id");
  unwrap(
    await supabase.rpc("delete_transfer", { p_transfer_id: tid }),
    "delete_transfer"
  );
  bumpDataVersion();
}

export async function rpcCancelCashClosure(id) {
  assertConfigured();
  const cid = requireUuid(id, "id");
  unwrap(
    await supabase.rpc("cancel_cash_closure", { p_id: cid }),
    "cancel_cash_closure"
  );
  bumpDataVersion();
}

export async function rpcCreateCashClosure({ officeId, closureDate, details, comment }) {
  assertConfigured();
  const office = requireUuid(officeId, "officeId");
  if (!closureDate) throw new Error("closureDate required (YYYY-MM-DD)");
  if (!Array.isArray(details) || details.length === 0) {
    throw new Error("details: non-empty array required");
  }
  // Sanitize details
  const sanitized = details.map((d, i) => {
    if (!d.currency || String(d.currency).length < 2) {
      throw new Error(`details[${i}].currency required`);
    }
    const sys = Number(d.systemTotal);
    const act = Number(d.actualTotal);
    if (!Number.isFinite(sys)) throw new Error(`details[${i}].systemTotal invalid`);
    if (!Number.isFinite(act)) throw new Error(`details[${i}].actualTotal invalid`);
    return {
      currency: String(d.currency).toUpperCase(),
      system_total: sys,
      actual_total: act,
      diff: act - sys,
      note: d.note ? String(d.note).trim() : null,
    };
  });
  const id = unwrap(
    await supabase.rpc("create_cash_closure", {
      p_office_id: office,
      p_closure_date: String(closureDate),
      p_details: sanitized,
      p_comment: comment ? String(comment).trim() : null,
    }),
    "create_cash_closure"
  );
  bumpDataVersion();
  return id;
}

// Initial balance adjustment (миграция 0084).
// Изменяет баланс счёта НЕ напрямую, а через эмиссию account_movement
// с source_kind='adjustment'. Записывает row в balance_adjustments
// с историей (old/new/diff/note/who/when).
//
// НЕ влияет на P&L. Доступно только admin/owner/accountant.
export async function rpcCreateBalanceAdjustment({ accountId, newBalance, note }) {
  assertConfigured();
  const acc = requireUuid(accountId, "accountId");
  const nb = Number(newBalance);
  if (!Number.isFinite(nb)) {
    throw new Error(`newBalance: must be a finite number (got ${newBalance})`);
  }
  if (typeof note !== "string" || note.trim().length === 0) {
    throw new Error("note: required (комментарий обязателен)");
  }
  const id = unwrap(
    await supabase.rpc("create_balance_adjustment", {
      p_account_id: acc,
      p_new_balance: nb,
      p_note: note.trim(),
    }),
    "create_balance_adjustment"
  );
  bumpDataVersion();
  return id;
}

// Partner settlement — одностороннее inflow (контрагент внёс).
// Создаёт partner_account_movement (in, source_kind='settle'). Наш счёт
// не трогаем.
export async function rpcRecordPartnerInflow({ partnerAccountId, amount, currency, note }) {
  assertConfigured();
  const pa = requireUuid(partnerAccountId, "partnerAccountId");
  const amt = requirePositive(amount, "amount");
  const id = unwrap(
    await supabase.rpc("record_partner_inflow", {
      p_partner_account_id: pa,
      p_amount: amt,
      p_currency: currency || null,
      p_note: note ? String(note).trim() : null,
    }),
    "record_partner_inflow"
  );
  bumpDataVersion();
  return id;
}

// Partner settlement — парный outflow (контрагент забрал у нас кеш).
// Создаёт partner_account_movement (out) + наш account_movement (out)
// с общим movement_group_id. Указывается с какой кассы выдали.
export async function rpcRecordPartnerOutflow({
  partnerAccountId, amount, currency, fromAccountId, note,
}) {
  assertConfigured();
  const pa = requireUuid(partnerAccountId, "partnerAccountId");
  const acc = requireUuid(fromAccountId, "fromAccountId");
  const amt = requirePositive(amount, "amount");
  const groupId = unwrap(
    await supabase.rpc("record_partner_outflow", {
      p_partner_account_id: pa,
      p_amount: amt,
      p_currency: currency || null,
      p_from_account_id: acc,
      p_note: note ? String(note).trim() : null,
    }),
    "record_partner_outflow"
  );
  bumpDataVersion();
  return groupId;
}

export async function rpcDeletePartnerInflow(movementId) {
  assertConfigured();
  const id = requireUuid(movementId, "movementId");
  unwrap(
    await supabase.rpc("delete_partner_inflow", { p_movement_id: id }),
    "delete_partner_inflow"
  );
  bumpDataVersion();
}

export async function rpcDeletePartnerSettlementGroup(groupId) {
  assertConfigured();
  const id = requireUuid(groupId, "groupId");
  unwrap(
    await supabase.rpc("delete_partner_settlement_group", { p_group_id: id }),
    "delete_partner_settlement_group"
  );
  bumpDataVersion();
}

export async function rpcTopUp({ accountId, amount, note, sourceKind }) {
  assertConfigured();
  const acc = requireUuid(accountId, "accountId");
  const amt = requirePositive(amount, "amount");
  const kind = sourceKind === "opening" ? "opening" : "topup";
  const id = unwrap(
    await supabase.rpc("topup_account", {
      p_account_id: acc,
      p_amount: amt,
      p_note: note || "",
      p_source_kind: kind,
    }),
    "topup_account"
  );
  bumpDataVersion();
  return id;
}

// ---------- wallets ----------

export async function rpcUpsertClientWallet({ clientId, address, network }) {
  assertConfigured();
  const cId = requireUuid(clientId, "clientId");
  if (typeof address !== "string" || address.trim().length < 8) {
    throw new Error("address: required");
  }
  if (typeof network !== "string" || network.trim().length === 0) {
    throw new Error("network: required");
  }
  const id = unwrap(
    await supabase.rpc("upsert_client_wallet", {
      p_client_id: cId,
      p_address: address.trim(),
      p_network_id: network,
    }),
    "upsert_client_wallet"
  );
  bumpDataVersion();
  return id;
}

// ---------- rates confirm ----------

export async function rpcConfirmRates({ officeId, reason }) {
  assertConfigured();
  // Если officeId — локальный seed ("mark", "ist", ...), не UUID — отправляем null.
  // RPC разрешает NULL (snapshot без привязки к офису). Иначе Postgres фейлится
  // на касте "mark"::uuid с нечитаемой ошибкой "invalid input syntax for type uuid".
  const safeOfficeId = isUuid(officeId) ? officeId : null;
  const id = unwrap(
    await supabase.rpc("confirm_rates", {
      p_office_id: safeOfficeId,
      p_reason: reason || "",
    }),
    "confirm_rates"
  );
  bumpDataVersion();
  return id;
}

// ---------- expenses (direct insert) ----------

export async function insertExpense({
  type,
  officeId,
  accountId,
  categoryId,
  amount,
  currency,
  entryDate,
  note,
  createdBy,
}) {
  assertConfigured();
  if (type !== "income" && type !== "expense") {
    throw new Error(`type: must be "income" or "expense"`);
  }
  const office = requireUuid(officeId, "officeId");
  const cat = requireUuid(categoryId, "categoryId");
  const amt = requirePositive(amount, "amount");
  const cur = requireCurrency(currency, "currency");
  if (typeof entryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw new Error("entryDate: expected YYYY-MM-DD");
  }

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      type,
      office_id: office,
      account_id: accountId || null,
      category_id: cat,
      amount: amt,
      currency_code: cur,
      entry_date: entryDate,
      note: note || "",
      created_by: createdBy || null,
    })
    .select()
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error, "insert expense"));
  bumpDataVersion();
  return data;
}

export async function deleteExpenseById(id) {
  assertConfigured();
  const validId = requireUuid(id, "id");
  const { error } = await supabase.from("expenses").delete().eq("id", validId);
  if (error) throw new Error(formatSupabaseError(error, "delete expense"));
  // Чистим accounting_audit для этой записи (если был approve)
  try {
    await supabase.from("accounting_audits")
      .delete()
      .eq("entity_type", "expense")
      .eq("entity_id", validId);
  } catch (e) {
    console.warn("[deleteExpense] audit cleanup failed", e);
  }
  bumpDataVersion();
}

// ---------- pairs (rates + spread editor) ----------

// Обновляем pair через security-definer RPC update_pair (0037) — раньше
// был прямой .from("pairs").update() через PostgREST, упирался в RLS
// ref_update_admin (только owner/admin) и терял сетевые ошибки в общем
// TypeError Fetch. RPC обходит RLS, пускает accountant, бросает clear
// exceptions (в т.ч. P0002 "No default pair found" если пары нет).
export async function rpcUpdatePair({ fromCurrency, toCurrency, baseRate, spreadPercent }) {
  assertConfigured();
  const from = requireCurrency(fromCurrency, "fromCurrency");
  const to = requireCurrency(toCurrency, "toCurrency");
  let baseRateNum = null;
  let spreadNum = null;
  if (baseRate != null) {
    const n = Number(baseRate);
    if (!Number.isFinite(n) || n <= 0) throw new Error("baseRate: must be > 0");
    baseRateNum = n;
  }
  if (spreadPercent != null) {
    const s = Number(spreadPercent);
    if (!Number.isFinite(s)) throw new Error("spreadPercent: invalid");
    spreadNum = s;
  }
  if (baseRateNum == null && spreadNum == null) return;

  // После миграции 0065 update_pair изменяет ТОЛЬКО переданную пару — без
  // авто-синхронизации reverse. Sell и buy полностью независимы.
  const { error } = await supabase.rpc("update_pair", {
    p_from: from,
    p_to: to,
    p_base_rate: baseRateNum,
    p_spread: spreadNum,
  });
  if (error) {
    // Явный differentiation сетевых ошибок от RPC-ошибок — чтобы toast
    // показал не просто "Failed to fetch" а "Network — check Supabase
    // status or try again".
    const msg = error?.message || String(error);
    if (/failed to fetch|network|err_connection/i.test(msg)) {
      throw new Error(
        `Network error updating ${from}→${to}: Supabase недоступен. Проверь Dashboard / попробуй снова.`
      );
    }
    throw new Error(formatSupabaseError(error, "update_pair"));
  }
  bumpDataVersion();
}

// ---------- categories ----------

// Inline-создание категории / подкатегории. parentId опционален.
// При parentId != null новая запись подчиняется родителю (type обязан
// совпадать — trigger на бэке бросит exception иначе).
export async function insertCategory({ name, type, parentId, groupName }) {
  assertConfigured();
  const cleanName = (name || "").trim();
  if (!cleanName) throw new Error("Category name required");
  if (type !== "income" && type !== "expense") {
    throw new Error("Category type must be income or expense");
  }
  const { data, error } = await supabase
    .from("categories")
    .insert({
      name: cleanName,
      type,
      parent_id: parentId || null,
      group_name: groupName || "other",
      active: true,
    })
    .select()
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error, "insert category"));
  bumpDataVersion();
  return data;
}

export async function updateCategoryRow(id, { name, type, parentId, groupName }) {
  assertConfigured();
  if (!id) throw new Error("Category id required");
  const patch = {};
  if (name != null) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Category name required");
    patch.name = cleanName;
  }
  if (type != null) {
    if (type !== "income" && type !== "expense") {
      throw new Error("Category type must be income or expense");
    }
    patch.type = type;
  }
  if (parentId !== undefined) patch.parent_id = parentId || null;
  if (groupName != null) patch.group_name = groupName;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(formatSupabaseError(error, "update category"));
  bumpDataVersion();
}

export async function deleteCategoryRow(id) {
  assertConfigured();
  if (!id) throw new Error("Category id required");
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id);
  if (error) throw new Error(formatSupabaseError(error, "delete category"));
  bumpDataVersion();
}

// ---------- users (status updates) ----------

// Обновляет public.users запись через security-definer RPC admin_update_user
// (0018). Обходит RLS и даёт чёткие ошибки ("Only owner can promote to
// owner", "Caller is not admin" и т.д.).
// patch: {role, officeId, fullName}.
export async function updateUserRow(userId, patch) {
  assertConfigured();
  const validId = requireUuid(userId, "userId");
  if (patch.role != null && !["owner", "admin", "accountant", "manager"].includes(patch.role)) {
    throw new Error(`Invalid role: ${patch.role}`);
  }
  const { error } = await supabase.rpc("admin_update_user", {
    p_user_id: validId,
    p_role: patch.role ?? null,
    p_office_id: patch.officeId === undefined ? null : patch.officeId || null,
    p_full_name: patch.fullName ?? null,
  });
  if (error) throw new Error(formatSupabaseError(error, "update user"));
  bumpDataVersion();
}

// Создание новой pair через security-definer RPC (migration 0031).
// Раньше фронт делал direct insert в public.pairs, но RLS policy
// ref_write_admin (0001) периодически молча блокировала — пара
// исчезала после refresh. RPC проверяет caller role и бросает
// понятные ошибки (purposefully не fire-and-forget — caller awaits
// и показывает toast при fail).
export async function rpcCreatePair({ fromCurrency, toCurrency, baseRate, spreadPercent, priority }) {
  assertConfigured();
  const from = requireCurrency(fromCurrency, "fromCurrency");
  const to = requireCurrency(toCurrency, "toCurrency");
  if (from === to) throw new Error("from and to must differ");
  const rate = Number(baseRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("baseRate must be > 0");
  const spread = spreadPercent != null ? Number(spreadPercent) : 0;
  const prio = priority != null ? Number(priority) : 50;
  const { data, error } = await supabase.rpc("create_pair", {
    p_from: from,
    p_to: to,
    p_base_rate: rate,
    p_spread: Number.isFinite(spread) ? spread : 0,
    p_priority: Number.isFinite(prio) ? prio : 50,
  });
  if (error) throw new Error(formatSupabaseError(error, "create_pair"));
  bumpDataVersion();
  return data; // uuid new pair id
}

// Invite user — атомарная RPC (migration 0022):
//   1. upsert pending_invites (для first-time flow: trigger on_auth_user_created
//      прочитает роль при INSERT в auth.users)
//   2. если public.users row для email уже существует (re-invite / legacy) —
//      сразу update role/full_name/office_id
// Обходит RLS, проверяет права caller'а. Возвращает existing user_id (uuid)
// или null если юзера ещё нет.
// Вызывать ПЕРЕД supabase.auth.signInWithOtp — тогда в любом сценарии
// (first-time / re-invite / legacy) роль окажется правильной.
export async function rpcInviteUser({ email, fullName, role, officeId }) {
  assertConfigured();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(fullName || "").trim();
  if (!cleanEmail) throw new Error("email: required");
  if (!cleanName) throw new Error("fullName: required");
  if (!["owner", "admin", "accountant", "manager"].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const { data, error } = await supabase.rpc("invite_user", {
    p_email: cleanEmail,
    p_full_name: cleanName,
    p_role: role,
    p_office_id: officeId || null,
  });
  if (error) throw new Error(formatSupabaseError(error, "invite_user"));
  bumpDataVersion();
  return data; // existing user_id (uuid) or null
}

// Админ задаёт пароль юзеру (security-definer RPC, миграция 0040).
// Это РЕАЛЬНЫЙ password set: пишет bcrypt hash в auth.users.encrypted_password
// + обновляет public.users (status=active, password_set=true).
// Раньше UsersTab → "Change password" работал только in-memory — пароль
// в Supabase Auth не менялся, юзер не мог войти.
export async function rpcAdminSetPassword(userId, password) {
  assertConfigured();
  const validId = requireUuid(userId, "userId");
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const { error } = await supabase.rpc("admin_set_password", {
    p_user_id: validId,
    p_password: password,
  });
  if (error) throw new Error(formatSupabaseError(error, "admin_set_password"));
  bumpDataVersion();
}

// Меняет public.users.status в БД. Используется для Disable/Enable в UsersTab.
// Принимает 'active' | 'disabled' | 'invited'. Hard-delete не делаем — для
// этого нужен service_role (auth.users.delete), недоступный из браузера.
export async function rpcSetUserStatus(userId, status) {
  assertConfigured();
  const validId = requireUuid(userId, "userId");
  if (!["active", "disabled", "invited"].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  // ⚠ public.users не имеет колонки `active` — только `status` (active|disabled|invited).
  const { error } = await supabase
    .from("users")
    .update({ status })
    .eq("id", validId);
  if (error) throw new Error(formatSupabaseError(error, "update user status"));
  bumpDataVersion();
}

// ---------- offices ----------

export async function insertOfficeRow(payload) {
  assertConfigured();
  if (!payload?.name) throw new Error("Office name required");
  const row = {
    name: String(payload.name).trim(),
    city: payload.city ? String(payload.city).trim() : null,
    timezone: payload.timezone || "Europe/Istanbul",
    working_days: Array.isArray(payload.workingDays) && payload.workingDays.length
      ? payload.workingDays
      : [1, 2, 3, 4, 5, 6],
    working_hours: payload.workingHours || { start: "09:00", end: "21:00" },
    working_hours_by_day: payload.workingHoursByDay || null,
    holidays: Array.isArray(payload.holidays) ? payload.holidays : [],
    temp_closed_until: payload.tempClosedUntil || null,
    temp_closed_reason: payload.tempClosedReason || null,
    min_fee_usd: Number(payload.minFeeUsd) || 10,
    fee_percent: Number(payload.feePercent) || 0,
    status: payload.status || "active",
    active: payload.active !== false,
  };
  const { data, error } = await supabase
    .from("offices")
    .insert(row)
    .select()
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error, "insert office"));
  bumpDataVersion();
  return data;
}

export async function updateOfficeRow(id, patch) {
  assertConfigured();
  const validId = requireUuid(id, "officeId");
  const row = {};
  if (patch.name != null) row.name = String(patch.name).trim();
  if (patch.city !== undefined) row.city = patch.city ? String(patch.city).trim() : null;
  if (patch.timezone != null) row.timezone = patch.timezone;
  if (patch.workingDays !== undefined) row.working_days = patch.workingDays;
  if (patch.workingHours !== undefined) row.working_hours = patch.workingHours;
  if (patch.workingHoursByDay !== undefined) row.working_hours_by_day = patch.workingHoursByDay;
  if (patch.holidays !== undefined) row.holidays = Array.isArray(patch.holidays) ? patch.holidays : [];
  if (patch.tempClosedUntil !== undefined) row.temp_closed_until = patch.tempClosedUntil || null;
  if (patch.tempClosedReason !== undefined) row.temp_closed_reason = patch.tempClosedReason || null;
  if (patch.minFeeUsd !== undefined) row.min_fee_usd = Number(patch.minFeeUsd) || 0;
  if (patch.feePercent !== undefined) row.fee_percent = Number(patch.feePercent) || 0;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.active !== undefined) row.active = !!patch.active;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("offices").update(row).eq("id", validId);
  if (error) throw new Error(formatSupabaseError(error, "update office"));
  bumpDataVersion();
}

export async function closeOfficeRow(id) {
  return updateOfficeRow(id, { status: "closed", active: false });
}

// Меняет местами sort_order двух офисов. Два UPDATE подряд (без транзакции —
// у sort_order нет unique-constraint, поэтому промежуточное состояние безопасно).
export async function swapOfficesSortOrder(idA, orderA, idB, orderB) {
  assertConfigured();
  const validA = requireUuid(idA, "idA");
  const validB = requireUuid(idB, "idB");
  const a = Number(orderA);
  const b = Number(orderB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error("swapOfficesSortOrder: orders must be numbers");
  }
  // A получает order B, B получает order A.
  const r1 = await supabase.from("offices").update({ sort_order: b }).eq("id", validA);
  if (r1.error) throw new Error(formatSupabaseError(r1.error, "swap office order A"));
  const r2 = await supabase.from("offices").update({ sort_order: a }).eq("id", validB);
  if (r2.error) throw new Error(formatSupabaseError(r2.error, "swap office order B"));
  bumpDataVersion();
}

export async function reopenOfficeRow(id) {
  return updateOfficeRow(id, { status: "active", active: true });
}

// ---------- currencies ----------

export async function insertCurrencyRow({ code, type, symbol, name, decimals }) {
  assertConfigured();
  const upperCode = String(code || "").toUpperCase().trim();
  if (!upperCode) throw new Error("Currency code required");
  if (type !== "fiat" && type !== "crypto") {
    throw new Error("Currency type must be fiat or crypto");
  }
  const { data, error } = await supabase
    .from("currencies")
    .insert({
      code: upperCode,
      type,
      symbol: symbol || "",
      name: name || upperCode,
      decimals: Number.isFinite(Number(decimals)) ? Number(decimals) : 2,
      active: true,
    })
    .select()
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error, "insert currency"));
  bumpDataVersion();
  return data;
}

export async function updateCurrencyRow(code, patch) {
  assertConfigured();
  const upperCode = String(code || "").toUpperCase().trim();
  if (!upperCode) throw new Error("Currency code required");
  const row = {};
  if (patch.symbol !== undefined) row.symbol = patch.symbol || "";
  if (patch.name != null) row.name = String(patch.name).trim();
  if (patch.decimals !== undefined && Number.isFinite(Number(patch.decimals))) {
    row.decimals = Number(patch.decimals);
  }
  if (patch.active !== undefined) row.active = !!patch.active;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("currencies").update(row).eq("code", upperCode);
  if (error) throw new Error(formatSupabaseError(error, "update currency"));
  bumpDataVersion();
}

export async function deleteCurrencyRow(code) {
  assertConfigured();
  const upperCode = String(code || "").toUpperCase().trim();
  if (!upperCode) throw new Error("Currency code required");
  const { error } = await supabase.from("currencies").delete().eq("code", upperCode);
  if (error) throw new Error(formatSupabaseError(error, "delete currency"));
  bumpDataVersion();
}

// ---------- client wallets ----------

// upsert: если (network_id, address) уже существует → не вставляем дубль,
// только обновляем usage_count + last_used_at. Иначе insert новый.
export async function upsertClientWalletRow({ clientId, address, network, riskScore, riskLevel, riskFlags }) {
  assertConfigured();
  if (!clientId || !address || !network) return null;
  const networkId = String(network).toLowerCase();
  const addr = String(address).trim();
  // Сперва пробуем обновить существующий (инкремент usage_count)
  const { data: existing } = await supabase
    .from("client_wallets")
    .select("id, client_id, usage_count")
    .eq("network_id", networkId)
    .eq("address", addr)
    .maybeSingle();
  if (existing) {
    // Conflict: другой client — не тронем (бизнес-правило)
    if (existing.client_id !== clientId) return null;
    await supabase
      .from("client_wallets")
      .update({
        last_used_at: new Date().toISOString(),
        usage_count: (existing.usage_count || 0) + 1,
      })
      .eq("id", existing.id);
    bumpDataVersion();
    return existing;
  }
  const row = {
    client_id: clientId,
    address: addr,
    network_id: networkId,
    usage_count: 1,
  };
  if (riskScore != null) row.risk_score = Number(riskScore);
  if (riskLevel) row.risk_level = riskLevel;
  if (Array.isArray(riskFlags)) row.risk_flags = riskFlags;
  const { data, error } = await supabase
    .from("client_wallets")
    .insert(row)
    .select()
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[upsertClientWallet]", error);
    return null;
  }
  bumpDataVersion();
  return data;
}

// ---------- office rate overrides (0021) ----------

// Upsert override для (office, from, to). rate обязательно, spread опционально.
// Использует RPC upsert_office_rate_override (security definer).
export async function rpcUpsertOfficeRate({ officeId, from, to, rate, spreadPercent }) {
  assertConfigured();
  const validOffice = requireUuid(officeId, "officeId");
  const validFrom = requireCurrency(from, "from");
  const validTo = requireCurrency(to, "to");
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) throw new Error("rate must be > 0");
  const sp = spreadPercent != null ? Number(spreadPercent) : 0;
  const { error } = await supabase.rpc("upsert_office_rate_override", {
    p_office_id: validOffice,
    p_from: validFrom,
    p_to: validTo,
    p_rate: n,
    p_spread: Number.isFinite(sp) ? sp : 0,
  });
  if (error) throw new Error(formatSupabaseError(error, "upsert office rate"));
  bumpDataVersion();
}

// Сбросить override (вернуться на global).
export async function rpcDeleteOfficeRate({ officeId, from, to }) {
  assertConfigured();
  const validOffice = requireUuid(officeId, "officeId");
  const { error } = await supabase.rpc("delete_office_rate_override", {
    p_office_id: validOffice,
    p_from: String(from).toUpperCase(),
    p_to: String(to).toUpperCase(),
  });
  if (error) throw new Error(formatSupabaseError(error, "delete office rate"));
  bumpDataVersion();
}

// ---------- accounts ----------

// Маппим frontend account payload на БД колонки.
// type: cash|bank|crypto|network (network → crypto в БД).
// Address для crypto обязателен или nullable (constraint unique nulls not distinct).
export async function insertAccount(payload) {
  assertConfigured();
  if (!payload?.name) throw new Error("Account name required");
  if (!payload?.officeId) throw new Error("Office required");
  if (!payload?.currency) throw new Error("Currency required");

  // БД type: cash|bank|crypto
  const typeRaw = String(payload.type || "cash").toLowerCase();
  const dbType = typeRaw === "network" ? "crypto" : typeRaw;
  if (!["cash", "bank", "crypto"].includes(dbType)) {
    throw new Error(`Invalid account type: ${typeRaw}`);
  }

  const row = {
    office_id: payload.officeId,
    currency_code: payload.currency,
    type: dbType,
    name: String(payload.name).trim(),
    bank_ref: payload.bankRef || null,
    address: payload.address || null,
    // network_id в БД в UPPERCASE ('TRC20'/'ERC20'/'BEP20'), FK на networks(id).
    // Раньше .toLowerCase() ломал FK при создании крипто-счёта.
    network_id: payload.networkId || (payload.network ? payload.network.toUpperCase() : null),
    is_deposit: !!payload.isDeposit,
    is_withdrawal: !!payload.isWithdrawal,
    active: payload.active !== false,
    opening_balance: Number(payload.balance) || 0,
  };
  const { data, error } = await supabase
    .from("accounts")
    .insert(row)
    .select()
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error, "insert account"));

  // Если opening_balance > 0 — пишем opening movement (бэк не делает
  // автоматически, только фронт)
  if (data && row.opening_balance > 0) {
    try {
      await supabase.from("account_movements").insert({
        account_id: data.id,
        amount: row.opening_balance,
        direction: "in",
        currency_code: row.currency_code,
        reserved: false,
        source_kind: "opening",
        source_ref_id: null,
        note: "Opening balance",
      });
    } catch (mvErr) {
      // eslint-disable-next-line no-console
      console.warn("[opening movement]", mvErr);
    }
  }

  bumpDataVersion();
  return data;
}

export async function updateAccountRow(id, patch) {
  assertConfigured();
  if (!id) throw new Error("Account id required");
  const row = {};
  if (patch.name != null) row.name = String(patch.name).trim();
  if (patch.active !== undefined) row.active = !!patch.active;
  if (patch.address !== undefined) row.address = patch.address || null;
  if (patch.bankRef !== undefined) row.bank_ref = patch.bankRef || null;
  if (patch.accountingCode !== undefined) {
    row.accounting_code = patch.accountingCode ? String(patch.accountingCode).trim() : null;
  }
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("accounts").update(row).eq("id", id);
  if (error) throw new Error(formatSupabaseError(error, "update account"));
  bumpDataVersion();
}

// План счетов — обновить код счёта на любой entity.
// partner_accounts используют ledger_account_code (переименовано в миграции);
// accounts и clients по-прежнему используют accounting_code.
export async function updateAccountingCode(entityType, id, code) {
  assertConfigured();
  const validId = requireUuid(id, "id");
  const value = code ? String(code).trim() : null;
  const tableMap = {
    account: "accounts",
    client: "clients",
    partner_account: "partner_accounts",
  };
  const table = tableMap[entityType];
  if (!table) throw new Error(`Unknown entity_type: ${entityType}`);
  // partner_accounts.accounting_code was renamed to ledger_account_code in DB migration
  const column = entityType === "partner_account" ? "ledger_account_code" : "accounting_code";
  const { error } = await supabase.from(table).update({ [column]: value }).eq("id", validId);
  if (error) throw new Error(formatSupabaseError(error, `update ${column} on ${table}`));
  bumpDataVersion();
}

export async function deactivateAccountRow(id) {
  return updateAccountRow(id, { active: false });
}

// ---------- clients (update) ----------

// Обновление полей clients. patch: {nickname, fullName, telegram, tag, note}.
// Используется в ClientsPage → ClientProfileModal для tag/note/etc.
export async function updateClientRow(id, patch) {
  assertConfigured();
  const validId = requireUuid(id, "clientId");
  const row = {};
  if (patch.nickname != null) row.nickname = String(patch.nickname).trim();
  if (patch.fullName !== undefined) row.full_name = patch.fullName ? String(patch.fullName).trim() : null;
  if (patch.name !== undefined) row.full_name = patch.name ? String(patch.name).trim() : null;
  if (patch.telegram !== undefined) row.telegram = patch.telegram ? String(patch.telegram).trim() : null;
  if (patch.tag !== undefined) row.tag = patch.tag || null;
  if (patch.note !== undefined) row.note = patch.note || null;
  if (patch.referrerId !== undefined) row.referrer_id = patch.referrerId || null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from("clients")
    .update(row)
    .eq("id", validId);
  if (error) throw new Error(formatSupabaseError(error, "update client"));
  bumpDataVersion();
}

// ---------- clients (direct insert) ----------

// Гарантирует существование client'а в БД и возвращает его uuid.
// Дедупликация: (1) если counterpartyId уже UUID — trust it; (2) ищем по
// lowercased nickname в already-loaded counterparties; (3) по telegram;
// (4) запрос в БД по nickname/telegram; (5) если всё ещё не нашли — insert.
//
// Вызывается из CashierPage/EditTransactionModal перед create_deal.
// Если nickname пустой → null (deal создастся без client_id).
export async function ensureClient({ nickname, telegram, counterpartyId }, loadedClients = []) {
  if (!isSupabaseConfigured) return null;
  // (1) уже DB-UUID
  if (isUuid(counterpartyId)) return counterpartyId;

  const nick = (nickname || "").trim();
  if (!nick) return null;
  const nickLower = nick.toLowerCase();
  const tg = (telegram || "").trim().toLowerCase();

  // (2) + (3) — in-memory hit (мгновенно, без round-trip)
  const local = (loadedClients || []).find((c) => {
    if (!c) return false;
    if (c.nickname && c.nickname.toLowerCase() === nickLower) return true;
    if (tg && c.telegram && c.telegram.toLowerCase() === tg) return true;
    return false;
  });
  if (local && isUuid(local.id)) return local.id;

  // (4) — на случай если counterparties не долетели / race condition:
  // запрос в clients ilike nickname.
  // SECURITY: escape ILIKE-wildcards (% и _) и запятые (split-toкen в .or()).
  // Без escape user input "a%" находил всех начинающихся с "a" (info-leak +
  // bypass точного matching). PostgREST .or() разделяет по запятой —
  // запятая в input может ломать syntax / делать дополнительные условия.
  const escapeIlike = (s) =>
    String(s).replace(/[\\%_]/g, (m) => `\\${m}`).replace(/[,()]/g, " ");
  const nickEsc = escapeIlike(nick);
  const tgEsc = escapeIlike(tg || nick);
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("id, nickname, telegram")
      .or(`nickname.ilike.${nickEsc},telegram.ilike.${tgEsc}`)
      .limit(5);
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[ensureClient] lookup failed", error);
    } else if (Array.isArray(data) && data.length > 0) {
      const hit = data.find((c) => {
        if (!c) return false;
        if (c.nickname && c.nickname.toLowerCase() === nickLower) return true;
        if (tg && c.telegram && c.telegram.toLowerCase() === tg) return true;
        return false;
      });
      if (hit) return hit.id;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ensureClient] lookup error", err);
  }

  // (5) — insert. Если unique-constraint споткнётся — ловим и ещё раз ищем.
  try {
    const { data, error } = await supabase
      .from("clients")
      .insert({
        nickname: nick,
        full_name: nick,
        telegram: telegram || "",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[ensureClient] insert failed, retry lookup", error);
      const { data: again } = await supabase
        .from("clients")
        .select("id")
        .ilike("nickname", nickEsc)
        .limit(1)
        .maybeSingle();
      return again?.id || null;
    }
    bumpDataVersion();
    return data?.id || null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ensureClient] insert error", err);
    return null;
  }
}

export async function insertClient({ nickname, fullName, telegram, tag, note, referrerId }) {
  assertConfigured();
  if (typeof nickname !== "string" || nickname.trim().length === 0) {
    throw new Error("nickname: required");
  }
  const { data, error } = await supabase
    .from("clients")
    .insert({
      nickname: nickname.trim(),
      full_name: (fullName || nickname).trim(),
      telegram: telegram || "",
      // tag check-constraint разрешает только VIP/Regular/New/Risky или NULL — пустая
      // строка вызвала бы violation. note тоже nullable, пустая строка ОК.
      tag: tag || null,
      note: note || "",
      referrer_id: referrerId || null,
    })
    .select()
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error, "insert client"));
  bumpDataVersion();
  return data;
}

// Архивация / восстановление — мягкое "удаление".
export async function rpcArchiveClient(id, archive = true) {
  assertConfigured();
  const validId = requireUuid(id, "id");
  unwrap(
    await supabase.rpc("archive_client", {
      p_client_id: validId,
      p_archive: !!archive,
    }),
    archive ? "archive_client" : "unarchive_client"
  );
  bumpDataVersion();
}

// Hard-delete — только если нет активных сделок (RPC проверяет на сервере).
export async function rpcDeleteClient(id) {
  assertConfigured();
  const validId = requireUuid(id, "id");
  unwrap(
    await supabase.rpc("delete_client", { p_client_id: validId }),
    "delete_client"
  );
  bumpDataVersion();
}

export async function updateClient(id, patch) {
  assertConfigured();
  const validId = requireUuid(id, "id");
  const dbPatch = {};
  if (patch.nickname !== undefined) dbPatch.nickname = patch.nickname;
  if (patch.name !== undefined) dbPatch.full_name = patch.name;
  if (patch.telegram !== undefined) dbPatch.telegram = patch.telegram;
  if (patch.tag !== undefined) dbPatch.tag = patch.tag;
  if (patch.note !== undefined) dbPatch.note = patch.note;
  if (Object.keys(dbPatch).length === 0) return; // no-op
  const { error } = await supabase.from("clients").update(dbPatch).eq("id", validId);
  if (error) throw new Error(formatSupabaseError(error, "update client"));
  bumpDataVersion();
}

// ---------- bulk rates import ----------

// P2P transfer flow (0052): receiver подтверждает входящий pending transfer.
// IN-движение создаётся, OUT.reserved=false, status→confirmed.
export async function rpcConfirmTransfer({ transferId, note }) {
  assertConfigured();
  const id = requireUuid(transferId, "transferId");
  const { error } = await supabase.rpc("confirm_transfer", {
    p_transfer_id: id,
    p_note: note || null,
  });
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// receiver отклоняет входящий pending transfer. OUT удаляется → status=rejected.
// NB: reject_transfer / cancel_transfer принимают p_reason (а confirm_transfer
// принимает p_note). Не путать — PostgREST не найдёт функцию по неправильному имени.
export async function rpcRejectTransfer({ transferId, note }) {
  assertConfigured();
  const id = requireUuid(transferId, "transferId");
  const { error } = await supabase.rpc("reject_transfer", {
    p_transfer_id: id,
    p_reason: note || null,
  });
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// sender отменяет свой pending transfer (до confirm). OUT удаляется → cancelled.
export async function rpcCancelTransfer({ transferId, note }) {
  assertConfigured();
  const id = requireUuid(transferId, "transferId");
  const { error } = await supabase.rpc("cancel_transfer", {
    p_transfer_id: id,
    p_reason: note || null,
  });
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// Partner accounts (виртуальные счета партнёров) — CRUD wrappers.
// RLS: read=auth, write=admin/owner (миграция 0077).
export async function rpcInsertPartnerAccount({
  partnerId, name, currency, type, networkId, address, note, openingBalance,
}) {
  assertConfigured();
  const pid = requireUuid(partnerId, "partnerId");
  const cleanName = (name || "").trim();
  if (!cleanName) throw new Error("name required");
  const cleanCur = (currency || "").trim().toUpperCase();
  if (!cleanCur) throw new Error("currency required");
  if (!["cash", "bank", "crypto"].includes(type)) {
    throw new Error("type must be cash/bank/crypto");
  }
  const ob = openingBalance != null ? Number(openingBalance) : 0;
  // Партнёрские счета могут быть в минусе — отрицательный остаток
  // означает «партнёр уже должен нам со старого периода» (или мы ему,
  // в зависимости от знака конвенции). НЕ блокируем negative.
  if (!Number.isFinite(ob)) throw new Error("opening_balance must be a number");

  const { data, error } = await supabase
    .from("partner_accounts")
    .insert({
      partner_id: pid,
      name: cleanName,
      currency_code: cleanCur,
      type,
      network_id: (networkId || "").trim() || null,
      address: (address || "").trim() || null,
      note: (note || "").trim() || null,
      opening_balance: ob,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
  return data;
}

export async function rpcUpdatePartnerAccount(id, patch) {
  assertConfigured();
  const accId = requireUuid(id, "partner_account.id");
  // Маппинг camelCase → snake_case для известных полей
  const dbPatch = {};
  if (patch.name != null) dbPatch.name = String(patch.name).trim();
  if (patch.currency != null) dbPatch.currency_code = String(patch.currency).trim().toUpperCase();
  if (patch.type != null) {
    if (!["cash", "bank", "crypto"].includes(patch.type)) {
      throw new Error("type must be cash/bank/crypto");
    }
    dbPatch.type = patch.type;
  }
  if (patch.networkId !== undefined) dbPatch.network_id = patch.networkId || null;
  if (patch.address !== undefined) dbPatch.address = patch.address || null;
  if (patch.note !== undefined) dbPatch.note = patch.note || null;
  if (patch.active != null) dbPatch.active = !!patch.active;
  if (patch.openingBalance != null) {
    const ob = Number(patch.openingBalance);
    // Партнёрский счёт может быть в минусе — см. rpcInsertPartnerAccount.
    if (!Number.isFinite(ob)) throw new Error("opening_balance must be a number");
    dbPatch.opening_balance = ob;
  }
  dbPatch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("partner_accounts")
    .update(dbPatch)
    .eq("id", accId);
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

export async function rpcDeletePartnerAccount(id) {
  // Soft delete — active=false. Жёсткое DELETE не делаем (FK от obligations/legs).
  return rpcUpdatePartnerAccount(id, { active: false });
}

// Partners (контрагенты для OTC) — CRUD wrappers.
export async function rpcInsertPartner({ name, telegram, phone, note }) {
  assertConfigured();
  const cleanName = (name || "").trim();
  if (!cleanName) throw new Error("name required");
  const { data, error } = await supabase
    .from("partners")
    .insert({
      name: cleanName,
      telegram: (telegram || "").trim() || null,
      phone: (phone || "").trim() || null,
      note: (note || "").trim() || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
  return data;
}

export async function rpcUpdatePartner(id, patch) {
  assertConfigured();
  const partnerId = requireUuid(id, "partnerId");
  const { error } = await supabase
    .from("partners")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", partnerId);
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

export async function rpcDeletePartner(id) {
  assertConfigured();
  const partnerId = requireUuid(id, "partnerId");
  // Soft delete — active=false
  const { error } = await supabase
    .from("partners")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", partnerId);
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// Upsert одной записи в system_settings (key, value jsonb).
// Используется для baseCurrency, fxRates, referralPct и т.д.
// RLS из 0001 пропускает только admin/owner. Frontend проверяет роль до вызова.
export async function upsertSystemSetting(key, value) {
  assertConfigured();
  if (!key) throw new Error("key required");
  const { error } = await supabase
    .from("system_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// Назначить payee (ответственного за выдачу) на existing deal.
// Вызывается из ExchangeForm после rpcCreateDeal если interoffice OUT.
// Не блокирует submit — если RPC failed, сделка всё равно создана.
export async function rpcSetDealPayee({ dealId, payeeUserId, payeeOfficeId }) {
  assertConfigured();
  if (!dealId) throw new Error("dealId required");
  if (!payeeUserId) throw new Error("payeeUserId required");
  const { error } = await supabase.rpc("set_deal_payee", {
    p_deal_id: typeof dealId === "string" ? Number(dealId) : dealId,
    p_payee_user_id: requireUuid(payeeUserId, "payeeUserId"),
    p_payee_office_id: payeeOfficeId ? requireUuid(payeeOfficeId, "payeeOfficeId") : null,
  });
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// Pin/unpin сделку — пишет напрямую в deals.pinned. Раньше pin
// обновлялся только в локальном state и слетал после reload.
export async function setDealPinned({ dealId, pinned }) {
  assertConfigured();
  if (!dealId) throw new Error("dealId required");
  const { error } = await supabase
    .from("deals")
    .update({ pinned: !!pinned })
    .eq("id", typeof dealId === "string" ? Number(dealId) : dealId);
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// Backdate — оформить сделку задним числом. RPC обновляет deal.created_at,
// movements.created_at и deal_legs.planned_at/completed_at. Manager может
// только свои сделки.
export async function rpcSetDealCreatedAt({ dealId, createdAt }) {
  assertConfigured();
  if (!dealId) throw new Error("dealId required");
  if (!createdAt) throw new Error("createdAt required");
  const { error } = await supabase.rpc("set_deal_created_at", {
    p_deal_id: typeof dealId === "string" ? Number(dealId) : dealId,
    p_created_at: createdAt,
  });
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// Payee помечает сделку как выданную (после физической передачи денег клиенту).
export async function rpcMarkDealPayedOut({ dealId, note }) {
  assertConfigured();
  if (!dealId) throw new Error("dealId required");
  const { error } = await supabase.rpc("mark_deal_payed_out", {
    p_deal_id: typeof dealId === "string" ? Number(dealId) : dealId,
    p_note: note || null,
  });
  if (error) throw new Error(error.message || String(error));
  bumpDataVersion();
}

// Вызывает RPC import_rates (atomic update + snapshot).
// rows: [{from, to, rate, buy_rate?}, ...]  — только валидные, проверенные на фронте.
// buy_rate (optional): явный курс обратного направления (B→A). Если не задан,
// reverse pair синхронизируется автоматом через trigger как 1/rate.
// reason: произвольная пометка (показывается в audit).
// Возвращает { ok, result: { updated, inserted, snapshot_id } } | { ok: false, error }
export async function rpcImportRates(rows, reason) {
  assertConfigured();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No rows to import");
  }
  const payload = rows.map((r) => {
    const row = {
      from: String(r.from || "").toUpperCase(),
      to: String(r.to || "").toUpperCase(),
      rate: Number(r.rate),
    };
    if (r.buy_rate != null && Number.isFinite(Number(r.buy_rate)) && Number(r.buy_rate) > 0) {
      row.buy_rate = Number(r.buy_rate);
    }
    return row;
  });
  const res = await supabase.rpc("import_rates", {
    p_rows: payload,
    p_reason: reason || "xlsx import",
  });
  const data = unwrap(res, "import_rates");
  bumpDataVersion();
  return data;
}

// ---------- audit (fire-and-forget) ----------

export async function insertAuditEntry({ action, entity, entityId, summary, userId, userName }) {
  if (!isSupabaseConfigured) return;
  try {
    // Предпочитаем явно переданные userId/userName (из currentUser — это
    // настоящее человеческое имя вроде "E. Kara"). Фолбэк — auth.getSession,
    // который даёт только email. Раньше писали только email → в UI после
    // reload из DB было видно почту вместо имени.
    let effectiveUserId = userId || null;
    let effectiveUserName = userName || "";
    if (!effectiveUserId || !effectiveUserName) {
      const { data: sess } = await supabase.auth.getSession();
      effectiveUserId = effectiveUserId || sess?.session?.user?.id || null;
      effectiveUserName = effectiveUserName || sess?.session?.user?.email || "";
    }
    await supabase.from("audit_log").insert({
      user_id: effectiveUserId,
      user_name: effectiveUserName,
      action,
      entity,
      entity_id: entityId || "",
      summary: summary || "",
    });
    // НЕ bumpDataVersion — audit не влияет на основные данные, рефетч
    // произойдёт вместе со следующим write.
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[audit] insert failed", err);
  }
}

// ---------- generic error toast helper ----------
//
// Обёртка над async-операцией: ловит throw, делает toast success/error,
// возвращает { ok, result? | error? }. Никогда не ре-throw'ит — вызывающий
// код читает .ok и сам решает что дальше.

export async function withToast(fn, { success, errorPrefix = "Error" } = {}) {
  try {
    const result = await fn();
    if (success) emitToast("success", success);
    return { ok: true, result };
  } catch (err) {
    const msg = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.warn(`[withToast] ${errorPrefix}:`, err);
    emitToast("error", `${errorPrefix}: ${msg}`);
    return { ok: false, error: msg };
  }
}
