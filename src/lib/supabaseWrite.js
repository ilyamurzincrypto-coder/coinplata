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
// Ключи snake_case, account_id uuid or null, network_id string or null.
export function legsToJsonb(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error("Deal must have at least one output");
  }
  return outputs.map((o, idx) => {
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Output ${idx + 1}: invalid amount (${o.amount})`);
    }
    const rate = Number(o.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Output ${idx + 1}: invalid rate (${o.rate})`);
    }
    if (typeof o.currency !== "string" || o.currency.length < 2) {
      throw new Error(`Output ${idx + 1}: missing currency`);
    }
    return {
      currency: o.currency.toUpperCase(),
      amount,
      rate,
      account_id: o.accountId || null,
      address: o.address ? String(o.address).trim() : null,
      network_id: o.network || null,
    };
  });
}

// ---------- deals ----------

const DEAL_STATUSES = new Set(["completed", "pending", "checking", "deleted"]);

export async function rpcCreateDeal({
  officeId,
  managerId,
  clientId,
  clientNickname,
  currencyIn,
  amountIn,
  inAccountId,
  inTxHash,
  referral,
  comment,
  status,
  outputs,
  plannedAt,      // optional ISO timestamp — "ожидается к дате"
  deferredIn,     // optional bool — client will pay IN later (they_owe)
}) {
  assertConfigured();
  const validOffice = requireUuid(officeId, "officeId");
  const validManager = requireUuid(managerId, "managerId");
  const validCur = requireCurrency(currencyIn, "currencyIn");
  const validAmt = requirePositive(amountIn, "amountIn");
  const validStatus = DEAL_STATUSES.has(status) ? status : "completed";
  const legs = legsToJsonb(outputs);

  // plannedAt ожидается как ISO-string из <input type="datetime-local"> +
  // приведение .toISOString(). Если null/undef — бэк использует now().
  const validPlannedAt = plannedAt ? String(plannedAt) : null;

  const dealId = unwrap(
    await supabase.rpc("create_deal", {
      p_office_id: validOffice,
      p_manager_id: validManager,
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
    }),
    "create_deal"
  );
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
  inTxHash,
  referral,
  comment,
  status,
  outputs,
}) {
  assertConfigured();
  const validDealId = requirePositive(dealId, "dealId");
  const validOffice = requireUuid(officeId, "officeId");
  const validCur = requireCurrency(currencyIn, "currencyIn");
  const validAmt = requirePositive(amountIn, "amountIn");
  const validStatus = DEAL_STATUSES.has(status) ? status : "completed";
  const legs = legsToJsonb(outputs);

  unwrap(
    await supabase.rpc("update_deal", {
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
    }),
    "update_deal"
  );
  bumpDataVersion();
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
}) {
  assertConfigured();
  const from = requireUuid(fromAccountId, "fromAccountId");
  const to = requireUuid(toAccountId, "toAccountId");
  if (from === to) throw new Error("From and To accounts must differ");
  const fromAmt = requirePositive(fromAmount, "fromAmount");
  const toAmt = requirePositive(toAmount, "toAmount");
  const rateNum = rate == null ? null : requirePositive(rate, "rate");

  const id = unwrap(
    await supabase.rpc("create_transfer", {
      p_from_account_id: from,
      p_to_account_id: to,
      p_from_amount: fromAmt,
      p_to_amount: toAmt,
      p_rate: rateNum,
      p_note: note || "",
    }),
    "create_transfer"
  );
  bumpDataVersion();
  return id;
}

export async function rpcTopUp({ accountId, amount, note }) {
  assertConfigured();
  const acc = requireUuid(accountId, "accountId");
  const amt = requirePositive(amount, "amount");
  const id = unwrap(
    await supabase.rpc("topup_account", {
      p_account_id: acc,
      p_amount: amt,
      p_note: note || "",
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
  bumpDataVersion();
}

// ---------- users (status updates) ----------

// Меняет public.users.status в БД. Используется для Disable/Enable в UsersTab.
// Принимает 'active' | 'disabled' | 'invited'. Hard-delete не делаем — для
// этого нужен service_role (auth.users.delete), недоступный из браузера.
export async function rpcSetUserStatus(userId, status) {
  assertConfigured();
  const validId = requireUuid(userId, "userId");
  if (!["active", "disabled", "invited"].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const { error } = await supabase
    .from("users")
    .update({ status, active: status === "active" })
    .eq("id", validId);
  if (error) throw new Error(formatSupabaseError(error, "update user status"));
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
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("id, nickname, telegram")
      .or(`nickname.ilike.${nick},telegram.ilike.${tg || nick}`)
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
        .ilike("nickname", nick)
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

export async function insertClient({ nickname, fullName, telegram, tag, note }) {
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
      tag: tag || "",
      note: note || "",
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

// ---------- audit (fire-and-forget) ----------

export async function insertAuditEntry({ action, entity, entityId, summary }) {
  if (!isSupabaseConfigured) return;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess?.session?.user?.id || null;
    await supabase.from("audit_log").insert({
      user_id: userId,
      user_name: sess?.session?.user?.email || "",
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
