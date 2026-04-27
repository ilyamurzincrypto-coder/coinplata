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
    const leg = {
      currency: o.currency.toUpperCase(),
      amount,
      rate,
      account_id: o.accountId || null,
      address: o.address ? String(o.address).trim() : null,
      network_id: o.network || null,
    };
    // pay_now добавляем только если явно задан (не undefined/null)
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
  applyMinFee,    // optional bool (default true) — применять ли min cap офиса
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
  // p_skip_min_fee — инвертированный applyMinFee (default false = применять).
  // RPC ожидает skip-флаг чтобы default-поведение было совместимым.
  const skipMinFee = applyMinFee === false;

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
      p_skip_min_fee: skipMinFee,
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
  plannedAt,   // NEW — preserved при edit
  deferredIn,  // NEW — preserved при edit
  applyMinFee, // optional bool — применять ли min cap офиса
}) {
  assertConfigured();
  const validDealId = requirePositive(dealId, "dealId");
  const validOffice = requireUuid(officeId, "officeId");
  const validCur = requireCurrency(currencyIn, "currencyIn");
  const validAmt = requirePositive(amountIn, "amountIn");
  const validStatus = DEAL_STATUSES.has(status) ? status : "completed";
  const legs = legsToJsonb(outputs);
  const validPlannedAt = plannedAt ? String(plannedAt) : null;
  const skipMinFee = applyMinFee === false;

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
      p_planned_at: validPlannedAt,
      p_deferred_in: !!deferredIn,
      p_skip_min_fee: skipMinFee,
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
    network_id: payload.networkId || (payload.network ? payload.network.toLowerCase() : null),
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
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("accounts").update(row).eq("id", id);
  if (error) throw new Error(formatSupabaseError(error, "update account"));
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
      // tag check-constraint разрешает только VIP/Regular/New/Risky или NULL — пустая
      // строка вызвала бы violation. note тоже nullable, пустая строка ОК.
      tag: tag || null,
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

// ---------- bulk rates import ----------

// Вызывает RPC import_rates (atomic update + snapshot).
// rows: [{from, to, rate}, ...]  — только валидные, проверенные на фронте.
// reason: произвольная пометка (показывается в audit).
// Возвращает { ok, result: { updated, inserted, snapshot_id } } | { ok: false, error }
export async function rpcImportRates(rows, reason) {
  assertConfigured();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No rows to import");
  }
  const payload = rows.map((r) => ({
    from: String(r.from || "").toUpperCase(),
    to: String(r.to || "").toUpperCase(),
    rate: Number(r.rate),
  }));
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
