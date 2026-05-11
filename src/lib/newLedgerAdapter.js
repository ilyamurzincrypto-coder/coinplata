// src/lib/newLedgerAdapter.js
// Direction 2 step 3 — legacy → v2 payload converters.
//
// Используется в dealOperations.js когда VITE_USE_NEW_LEDGER=true: legacy
// payload (как его строит ExchangeForm/TransferModal/etc) → v2 RPC params.

import { supabase } from "./supabase.js";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Resolve public.partner_accounts.id → ledger.account_code.
 * Throws structured error when ledger_account_code is not set.
 *
 * @param {string} partnerAccountId — uuid из public.partner_accounts
 * @returns {Promise<string>} ledger.accounts.code
 */
async function resolvePartnerAccountCode(partnerAccountId) {
  if (!partnerAccountId) {
    throw new Error("resolvePartnerAccountCode: partnerAccountId required");
  }
  const { data, error } = await supabase
    .from("partner_accounts")
    .select("ledger_account_code, name, currency_code")
    .eq("id", partnerAccountId)
    .single();
  if (error) throw new Error(`resolvePartnerAccountCode lookup failed: ${error.message}`);
  if (!data) throw new Error(`resolvePartnerAccountCode: partner account ${partnerAccountId} not found`);
  if (!data.ledger_account_code) {
    throw new Error(
      `Счёт партнёра "${data.name}" не маппится на ledger — задай ledger_account_code в Settings → Партнёры → счета`
    );
  }
  return data.ledger_account_code;
}

/**
 * Resolve legacy public.accounts.id → ledger.account_code.
 * Handles legacy_only marker → throws explicit error.
 *
 * @param {string} legacyId — uuid из public.accounts
 * @returns {Promise<string>} ledger.accounts.code
 * @throws Error если account legacy_only OR не имеет mapping
 */
export async function resolveAccountCode(legacyId) {
  if (!legacyId) throw new Error("resolveAccountCode: legacyId required");
  const { data, error } = await supabase
    .from("accounts")
    .select("ledger_account_code, legacy_only, name, type")
    .eq("id", legacyId)
    .single();
  if (error) throw new Error(`resolveAccountCode lookup failed: ${error.message}`);
  if (!data) throw new Error(`resolveAccountCode: account ${legacyId} not found`);
  if (data.legacy_only) {
    throw new Error(
      `Account "${data.name}" (${data.type}) is legacy_only and not supported in new ledger. ` +
      `Disable VITE_USE_NEW_LEDGER for this operation.`
    );
  }
  if (!data.ledger_account_code) {
    throw new Error(
      `Account "${data.name}" has no ledger mapping. Cannot use in new ledger.`
    );
  }
  return data.ledger_account_code;
}

/**
 * Build v2 commission array из legacy fee fields.
 * Legacy hands: commissionUsd (брокерская) + customFeeUsd (override) +
 * implicit margin от rates. v2 ждёт array of {currency, amount, kind}.
 *
 * Стратегия: если customFeeUsd > 0 → один entry в USD (commission).
 * Если commissionUsd > 0 → один entry в USD (commission).
 * Иначе — выводим ОДИН entry в USD равный 0.01 (минимальная commission;
 * v2 требует non-empty array). Margin distribute idет через rates в outLegs.
 */
export function inferCommissionFromLegacy(legacy) {
  const customFee = Number(legacy.customFeeUsd);
  const broker = Number(legacy.commissionUsd);
  if (Number.isFinite(customFee) && customFee > 0) {
    return [{ currency: "USD", amount: customFee, kind: "commission" }];
  }
  if (Number.isFinite(broker) && broker > 0) {
    return [{ currency: "USD", amount: broker, kind: "commission" }];
  }
  // v2 commission must be non-empty + currency must exist в OUT legs.
  // Сantinel: если nothing — вернём минимальный stub в первой OUT-валюте.
  // Caller обязан перезаписать если outputs пустые.
  return null;
}

/**
 * Adapt legacy ExchangeForm/CashierPage payload → v2 create_deal_v2 shape.
 *
 * legacy.deferredIn=true → in_legs[i].source='from_balance' (overdraft permissive).
 *
 * @param {Object} legacy — payload как принимает rpcCreateDeal
 * @returns {Promise<Object>} v2 payload для rpcCreateDealV2
 */
export async function adaptLegacyDealPayload(legacy) {
  if (!legacy.officeId) throw new Error("adapter: officeId required");
  if (!legacy.clientId && !legacy.clientNickname) {
    throw new Error("adapter: clientId or clientNickname required");
  }

  // ── IN legs ──
  const inLegs = [];
  // Главный IN
  if (Number(legacy.amountIn) > 0) {
    const inLeg = {
      currency: legacy.currencyIn,
      amount: Number(legacy.amountIn),
      source: legacy.deferredIn ? "from_balance" : "fresh",
    };
    if (!legacy.deferredIn) {
      // fresh source — нужен account_code. partner accounts не маппим (Direction 3).
      if (legacy.inAccountId) {
        inLeg.account_code = await resolveAccountCode(legacy.inAccountId);
      } else if (legacy.inPartnerAccountId) {
        inLeg.account_code = await resolvePartnerAccountCode(legacy.inPartnerAccountId);
      } else {
        throw new Error("adapter: fresh IN requires inAccountId");
      }
    }
    inLeg.rate_source = "market";
    inLegs.push(inLeg);
  }

  // Multi-currency inPayments[]
  if (Array.isArray(legacy.inPayments)) {
    for (const p of legacy.inPayments) {
      if (!(Number(p.amount) > 0)) continue;
      const leg = {
        currency: p.currency || legacy.currencyIn,
        amount: Number(p.amount),
        source: "fresh",
        rate_source: "market",
      };
      if (p.accountId) {
        leg.account_code = await resolveAccountCode(p.accountId);
      } else if (p.partnerAccountId) {
        leg.account_code = await resolvePartnerAccountCode(p.partnerAccountId);
      } else {
        throw new Error("adapter: inPayments entry requires accountId");
      }
      inLegs.push(leg);
    }
  }

  // ── OUT legs — built before the one-sided guard so it's available in both paths ──
  // Deferral signals from the legacy ExchangeForm:
  //   • `payNow: 0`              → the whole leg is "pay later" (the "мы платим позже" toggle)
  //   • `0 < payNow < amount`    → partial payout: split into an immediate leg (payNow)
  //                                 plus a deferred leg (amount − payNow)
  //   • `payNow` undefined       → ordinary immediate leg
  // Older OTC code also uses outKind 'ours_later' / 'partner_later'. Honor all of them.
  const outLegs = [];
  for (const o of legacy.outputs || []) {
    const amount = Number(o.amount);
    const payNow = (o.payNow === undefined || o.payNow === null) ? undefined : Number(o.payNow);
    const fullyLater = o.outKind === "ours_later" || o.outKind === "partner_later" || payNow === 0;
    const isPartner = o.outKind === "partner_now" || o.outKind === "partner_later" || !!o.partnerAccountId;

    if (isPartner && !fullyLater) {
      // Partner OUT — resolve via partner_accounts lookup instead of throwing.
      const code = await resolvePartnerAccountCode(o.partnerAccountId);
      outLegs.push({
        currency: o.currency.toUpperCase(),
        amount,
        account_code: code,
        rate: Number(o.rate),
        deferred: false,
      });
      continue;
    }

    const accountCode = o.accountId ? await resolveAccountCode(o.accountId) : undefined;
    const makeLeg = (amt, deferred) => {
      const leg = {
        currency: o.currency,
        amount: amt,
        destination: "physical",
        rate: Number(o.rate),
        rate_source: o.manualRate ? "manual" : "market",
        deferred,
      };
      if (accountCode) {
        leg.account_code = accountCode;
      } else if (deferred) {
        // deferred physical — account_code нужен для будущего complete_deal_leg
        throw new Error(
          "adapter: deferred OUT leg requires accountId for future complete_deal_leg. " +
          "Legacy form should preserve the target account even for deferred/partial legs."
        );
      }
      return leg;
    };

    if (fullyLater) {
      outLegs.push(makeLeg(amount, true));
    } else if (payNow !== undefined && payNow > 0 && payNow < amount) {
      outLegs.push(makeLeg(payNow, false));
      outLegs.push(makeLeg(amount - payNow, true));
    } else {
      outLegs.push(makeLeg(amount, false));
    }
  }

  // ── One-sided guards — route to dedicated RPCs instead of throwing ──
  if (inLegs.length === 0) {
    // One-sided OUT — route via withdrawal RPC. Caller checks `kind` and dispatches.
    return {
      kind: "withdrawal",
      officeId: legacy.officeId,
      clientId: legacy.clientId || null,
      clientNickname: legacy.clientNickname || null,
      outLegs,
      note: legacy.comment || null,
    };
  }

  if (outLegs.length === 0) {
    // One-sided IN — route via topup RPC.
    return {
      kind: "topup",
      officeId: legacy.officeId,
      clientId: legacy.clientId || null,
      clientNickname: legacy.clientNickname || null,
      inLegs,
      note: legacy.comment || null,
    };
  }

  // ── Commission ──
  let commission = inferCommissionFromLegacy(legacy);
  if (!commission) {
    // Sentinel: используем валюту первого OUT-leg с amount=0.01 (ноль не разрешён).
    // Это чистая formality — реальная margin уже встроена в rates.
    commission = [{
      currency: outLegs[0].currency,
      amount: 0.01,
      kind: "commission",
    }];
  } else {
    // commission обязана быть в одной из OUT-валют. Проверим.
    const outCurs = new Set(outLegs.map((l) => l.currency));
    commission = commission.filter((c) => outCurs.has(c.currency));
    if (commission.length === 0) {
      commission = [{ currency: outLegs[0].currency, amount: 0.01, kind: "commission" }];
    }
  }

  return {
    clientId: legacy.clientId,
    officeId: legacy.officeId,
    inLegs,
    outLegs,
    commission,
    description: legacy.comment || null,
    metadata: {
      legacy_form: true,
      manager_id: legacy.managerId,
      client_nickname: legacy.clientNickname || null,
      status: legacy.status || "completed",
      kind: legacy.kind || "regular",
      referral: !!legacy.referral,
      apply_min_fee: legacy.applyMinFee !== false,
      ...(legacy.deferredIn ? { adjustment_type: "legacy_pending_payment" } : {}),
      ...(legacy.inTxHash ? { tx_hash: legacy.inTxHash } : {}),
      ...(legacy.plannedAt ? { planned_at: legacy.plannedAt } : {}),
    },
  };
}

/**
 * Adapt legacy TopUpModal → v2 create_adjustment payload.
 *
 * Legacy rpcTopUp — admin-action: пополнение НАШЕГО asset-счёта.
 * В v2 это `create_adjustment(kind='opening')` для opening, иначе
 * `create_adjustment(kind='reconciliation')`. Customer top-up (клиент сдал)
 * — отдельная семантика через ledger.create_topup, не покрывается здесь.
 */
export async function adaptLegacyTopupPayload(legacy) {
  const accountCode = await resolveAccountCode(legacy.accountId);
  // Currency читаем из public.accounts чтобы сматчить с p_currency_code RPC
  const { data: acc, error } = await supabase
    .from("accounts")
    .select("currency_code, name")
    .eq("id", legacy.accountId)
    .single();
  if (error) throw new Error(`adaptLegacyTopup: account lookup failed: ${error.message}`);

  const isOpening = legacy.sourceKind === "opening";
  return {
    accountCode,
    amount: Number(legacy.amount),
    currencyCode: acc.currency_code,
    reason: legacy.note || (isOpening ? "Opening balance" : "Top up"),
    adjustmentKind: isOpening ? "opening" : "reconciliation",
    metadata: {
      legacy_form: true,
      legacy_source_kind: legacy.sourceKind || "topup",
      account_name: acc.name,
    },
  };
}

/**
 * Adapt legacy TransferModal → v2 create_transfer payload.
 *
 * Legacy: { fromAccountId, toAccountId, fromAmount, toAmount, rate, note }.
 * v2: { fromAccountCode, toAccountCode, amount, currencyCode, fee?, ... }.
 *
 * Same-currency transfer: amount=fromAmount=toAmount, currency from accounts.
 * Cross-currency transfer (rate ≠ 1): не поддержан в ledger.create_transfer
 * (он принимает single currency). Throws с подсказкой.
 */
export async function adaptLegacyTransferPayload(legacy) {
  const fromCode = await resolveAccountCode(legacy.fromAccountId);
  const toCode = await resolveAccountCode(legacy.toAccountId);

  const { data: fromAcc, error: e1 } = await supabase
    .from("accounts")
    .select("currency_code")
    .eq("id", legacy.fromAccountId)
    .single();
  if (e1) throw new Error(`adaptLegacyTransfer: from-account lookup failed: ${e1.message}`);
  const { data: toAcc, error: e2 } = await supabase
    .from("accounts")
    .select("currency_code")
    .eq("id", legacy.toAccountId)
    .single();
  if (e2) throw new Error(`adaptLegacyTransfer: to-account lookup failed: ${e2.message}`);

  if (fromAcc.currency_code !== toAcc.currency_code) {
    throw new Error(
      `Cross-currency transfer (${fromAcc.currency_code}→${toAcc.currency_code}) not supported ` +
      `in ledger.create_transfer. Use two separate adjustments instead, or disable VITE_USE_NEW_LEDGER.`
    );
  }

  return {
    fromAccountCode: fromCode,
    toAccountCode: toCode,
    amount: Number(legacy.fromAmount),
    currencyCode: fromAcc.currency_code,
    description: legacy.note || "Internal transfer",
    metadata: {
      legacy_form: true,
      to_manager_id: legacy.toManagerId || null,
    },
  };
}

/**
 * Adapt legacy BalanceAdjustmentModal → v2 create_adjustment payload.
 *
 * Legacy: { accountId, newBalance, note }.
 * Логика legacy: устанавливает balance = newBalance (delta = newBalance - currentBalance).
 *
 * v2 принимает amount (delta), не newBalance. Нужно посчитать delta:
 * delta = newBalance - currentLegacyBalance.
 *
 * Currency читаем из public.accounts.
 */
export async function adaptLegacyAdjustmentPayload(legacy) {
  const accountCode = await resolveAccountCode(legacy.accountId);
  const { data: acc, error } = await supabase
    .from("accounts")
    .select("currency_code, name")
    .eq("id", legacy.accountId)
    .single();
  if (error) throw new Error(`adaptLegacyAdjustment: account lookup failed: ${error.message}`);

  // Compute delta — нужен текущий balance из legacy account_movements.
  const { data: movs, error: e2 } = await supabase
    .from("account_movements")
    .select("direction, amount")
    .eq("account_id", legacy.accountId)
    .eq("reserved", false);
  if (e2) throw new Error(`adaptLegacyAdjustment: balance lookup failed: ${e2.message}`);

  const currentBal = (movs || []).reduce((sum, m) => {
    const v = Number(m.amount);
    return sum + (m.direction === "in" ? v : -v);
  }, 0);
  const delta = Number(legacy.newBalance) - currentBal;

  return {
    accountCode,
    amount: delta,
    currencyCode: acc.currency_code,
    reason: legacy.note,
    adjustmentKind: "reconciliation",
    metadata: {
      legacy_form: true,
      account_name: acc.name,
      legacy_target_balance: Number(legacy.newBalance),
      legacy_current_balance: currentBal,
    },
  };
}

export const __ZERO_UUID = ZERO_UUID;
