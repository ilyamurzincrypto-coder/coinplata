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

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase not configured");
  }
}

function unwrap({ data, error }) {
  if (error) {
    const msg = error.message || error.hint || "Unknown error";
    throw new Error(msg);
  }
  return data;
}

// Переводит frontend deal.outputs → jsonb[] для RPC create_deal / update_deal.
// Ключи snake_case, account_id uuid or null, network_id string or null.
export function legsToJsonb(outputs) {
  return (outputs || []).map((o) => ({
    currency: o.currency,
    amount: Number(o.amount) || 0,
    rate: Number(o.rate) || 0,
    account_id: o.accountId || null,
    address: o.address || null,
    network_id: o.network || null,
  }));
}

// ---------- deals ----------

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
}) {
  assertConfigured();
  const dealId = unwrap(
    await supabase.rpc("create_deal", {
      p_office_id: officeId,
      p_manager_id: managerId,
      p_client_id: clientId || null,
      p_client_nickname: clientNickname || null,
      p_currency_in: currencyIn,
      p_amount_in: Number(amountIn) || 0,
      p_in_account_id: inAccountId || null,
      p_in_tx_hash: inTxHash || null,
      p_referral: !!referral,
      p_comment: comment || "",
      p_status: status || "completed",
      p_legs: legsToJsonb(outputs),
    })
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
  unwrap(
    await supabase.rpc("update_deal", {
      p_deal_id: Number(dealId),
      p_office_id: officeId,
      p_client_id: clientId || null,
      p_client_nickname: clientNickname || null,
      p_currency_in: currencyIn,
      p_amount_in: Number(amountIn) || 0,
      p_in_account_id: inAccountId || null,
      p_in_tx_hash: inTxHash || null,
      p_referral: !!referral,
      p_comment: comment || "",
      p_status: status || "completed",
      p_legs: legsToJsonb(outputs),
    })
  );
  bumpDataVersion();
}

export async function rpcCompleteDeal(dealId) {
  assertConfigured();
  unwrap(await supabase.rpc("complete_deal", { p_deal_id: Number(dealId) }));
  bumpDataVersion();
}

export async function rpcDeleteDeal(dealId, reason = "") {
  assertConfigured();
  unwrap(
    await supabase.rpc("delete_deal", {
      p_deal_id: Number(dealId),
      p_reason: reason || "",
    })
  );
  bumpDataVersion();
}

export async function rpcConfirmDealLeg(dealId, legIndex) {
  assertConfigured();
  unwrap(
    await supabase.rpc("confirm_deal_leg", {
      p_deal_id: Number(dealId),
      p_leg_index: Number(legIndex),
    })
  );
  bumpDataVersion();
}

export async function rpcMarkDealSent({ dealId, legIndex, txHash, network }) {
  assertConfigured();
  unwrap(
    await supabase.rpc("mark_deal_sent", {
      p_deal_id: Number(dealId),
      p_leg_index: Number(legIndex),
      p_tx_hash: txHash,
      p_network: network || null,
    })
  );
  bumpDataVersion();
}

// ---------- obligations ----------

export async function rpcSettleObligation(obligationId, accountId) {
  assertConfigured();
  unwrap(
    await supabase.rpc("settle_obligation", {
      p_obligation_id: obligationId,
      p_account_id: accountId,
    })
  );
  bumpDataVersion();
}

export async function rpcCancelObligation(obligationId) {
  assertConfigured();
  unwrap(
    await supabase.rpc("cancel_obligation", {
      p_obligation_id: obligationId,
    })
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
  const id = unwrap(
    await supabase.rpc("create_transfer", {
      p_from_account_id: fromAccountId,
      p_to_account_id: toAccountId,
      p_from_amount: Number(fromAmount) || 0,
      p_to_amount: Number(toAmount) || 0,
      p_rate: rate ? Number(rate) : null,
      p_note: note || "",
    })
  );
  bumpDataVersion();
  return id;
}

export async function rpcTopUp({ accountId, amount, note }) {
  assertConfigured();
  const id = unwrap(
    await supabase.rpc("topup_account", {
      p_account_id: accountId,
      p_amount: Number(amount) || 0,
      p_note: note || "",
    })
  );
  bumpDataVersion();
  return id;
}

// ---------- wallets ----------

export async function rpcUpsertClientWallet({ clientId, address, network }) {
  assertConfigured();
  const id = unwrap(
    await supabase.rpc("upsert_client_wallet", {
      p_client_id: clientId,
      p_address: address,
      p_network_id: network,
    })
  );
  bumpDataVersion();
  return id;
}

// ---------- rates confirm ----------

export async function rpcConfirmRates({ officeId, reason }) {
  assertConfigured();
  const id = unwrap(
    await supabase.rpc("confirm_rates", {
      p_office_id: officeId || null,
      p_reason: reason || "",
    })
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
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      type,
      office_id: officeId,
      account_id: accountId || null,
      category_id: categoryId,
      amount: Number(amount) || 0,
      currency_code: currency,
      entry_date: entryDate,
      note: note || "",
      created_by: createdBy || null,
    })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  bumpDataVersion();
  return data;
}

export async function deleteExpenseById(id) {
  assertConfigured();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
  bumpDataVersion();
}

// ---------- clients (direct insert) ----------

export async function insertClient({ nickname, fullName, telegram, tag, note }) {
  assertConfigured();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      nickname,
      full_name: fullName || nickname,
      telegram: telegram || "",
      tag: tag || "",
      note: note || "",
    })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  bumpDataVersion();
  return data;
}

export async function updateClient(id, patch) {
  assertConfigured();
  const dbPatch = {};
  if (patch.nickname !== undefined) dbPatch.nickname = patch.nickname;
  if (patch.name !== undefined) dbPatch.full_name = patch.name;
  if (patch.telegram !== undefined) dbPatch.telegram = patch.telegram;
  if (patch.tag !== undefined) dbPatch.tag = patch.tag;
  if (patch.note !== undefined) dbPatch.note = patch.note;
  const { error } = await supabase.from("clients").update(dbPatch).eq("id", id);
  if (error) throw new Error(error.message);
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

export async function withToast(fn, { success, errorPrefix = "Error" } = {}) {
  try {
    const result = await fn();
    if (success) emitToast("success", success);
    return { ok: true, result };
  } catch (err) {
    const msg = err?.message || String(err);
    emitToast("error", `${errorPrefix}: ${msg}`);
    return { ok: false, error: msg };
  }
}
