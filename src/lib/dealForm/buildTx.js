// src/lib/dealForm/buildTx.js
// UI этап 2 — pure mapping legs[] state → rpcCreateDealV2 wrapper input.
//
// Wrapper в src/lib/newLedger.js принимает camelCase, потом делает
// camelCase → snake_case translation для PostgREST (p_client_id, p_in_legs etc.).
// Поэтому buildTx output использует camelCase top-level + leg-level
// (consistent с adapter newLedgerAdapter.js).
//
// Метаданные внутри `metadata` jsonb — snake_case convention (читабельнее в
// SQL queries, consistent с тем как ledger backend пишет).
//
// Финальный shape:
//   {
//     clientId, officeId, effectiveDate?,
//     inLegs:  [{ currency, amount, source: 'fresh'|'from_balance',
//                 accountCode?, rate?, rateSource? }],
//     outLegs: [{ currency, amount, destination: 'physical'|'to_balance',
//                 accountCode?, rate?, rateSource?, deferred? }],
//     commission: [{ currency, amount, kind: 'commission'|'spread' }],
//     description?, metadata?
//   }
//
// Account-code resolution делается ВНУТРИ buildTx через accountCodeByLegacyId
// map (передаётся вызывающим). Если map === null — режим legacy-passthrough
// (UI legacy path), accountId передаётся как есть в leg.accountId.

/**
 * Преобразует legs[] state в rpcCreateDealV2 wrapper input (camelCase).
 *
 * @param {Object} args
 * @param {import('../../store/dealForm.js').DealFormState} args.state
 * @param {string} args.clientId  — UUID существующего клиента
 * @param {string} args.officeId
 * @param {Object<string,string>|null} [args.accountCodeByLegacyId]
 *   — карта public.accounts.id → ledger.accounts.code.
 *     null → legacy passthrough (UI legacy path, accountId как-есть).
 *     Object → ledger v2 path, throws если account UUID не в map.
 * @param {string} [args.description]
 * @param {Object} [args.metadata]
 * @returns {Object} v2 wrapper payload
 */
export function buildTx({
  state,
  clientId,
  officeId,
  accountCodeByLegacyId,
  description,
  metadata,
}) {
  if (!state || !Array.isArray(state.legs)) {
    throw new Error("buildTx: state.legs required");
  }
  if (!clientId) throw new Error("buildTx: clientId required");
  if (!officeId) throw new Error("buildTx: officeId required");

  const inLegs = [];
  const outLegs = [];

  for (const leg of state.legs) {
    if (leg.side === "in") inLegs.push(buildInLeg(leg, accountCodeByLegacyId));
    else if (leg.side === "out") outLegs.push(buildOutLeg(leg, accountCodeByLegacyId));
    else throw new Error(`buildTx: unknown leg side "${leg.side}" (id=${leg.id})`);
  }

  if (inLegs.length === 0) {
    throw new Error("buildTx: at least one IN leg required");
  }
  if (outLegs.length === 0) {
    throw new Error("buildTx: at least one OUT leg required");
  }

  const conditions = state.conditions || {};
  const commission = buildCommission(
    state.commission || [],
    outLegs,
    conditions
  );

  // metadata от conditions (этап 3)
  const flags = Array.isArray(conditions.flags) ? conditions.flags : [];
  const fees = Array.isArray(conditions.fees) ? conditions.fees : [];
  const onDemand = conditions.on_demand || {};
  const conditionsMetadata = {
    margin_strategy: conditions.margin_strategy || "pro_rata",
    referral: flags.includes("referral"),
    vip: flags.includes("vip"),
    is_otc: flags.includes("otc"),
    is_partner: flags.includes("partner"),
    fee_paid_by: fees.includes("network_fee_client") ? "client" : "exchange",
    no_commission: fees.includes("no_commission"),
    bank_fee_applied: fees.includes("bank_fee"),
  };
  // On-demand fields в metadata только если задано (avoid null-flooding)
  if (onDemand.comment) conditionsMetadata.comment = onDemand.comment;
  if (onDemand.tx_hash) conditionsMetadata.tx_hash = onDemand.tx_hash;
  if (onDemand.scheduled_at) conditionsMetadata.scheduled_at = onDemand.scheduled_at;

  const result = {
    clientId,
    officeId,
    inLegs,
    outLegs,
    commission,
    description: description || null,
    metadata: {
      ui_form: "deal_v2",
      ...conditionsMetadata,
      ...(metadata || {}),
    },
  };

  // effectiveDate только если backdate задан (отдельный RPC-параметр)
  if (onDemand.backdate) {
    result.effectiveDate = onDemand.backdate;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Per-leg builders
// ─────────────────────────────────────────────────────────────────────

function buildInLeg(leg, accCodeMap) {
  const amount = Number(leg.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`IN leg ${leg.id}: amount must be > 0 (got "${leg.amount}")`);
  }
  if (!leg.currency || leg.currency.length < 2) {
    throw new Error(`IN leg ${leg.id}: currency required`);
  }
  const source = leg.source === "from_balance" ? "from_balance" : "fresh";
  const out = {
    currency: leg.currency.toUpperCase(),
    amount,
    source,
  };
  if (source === "fresh") {
    if (!leg.accountId) {
      throw new Error(`IN leg ${leg.id}: fresh source requires accountId`);
    }
    if (accCodeMap === null || accCodeMap === undefined) {
      // Legacy passthrough — accountId как-есть
      out.accountId = leg.accountId;
    } else {
      out.accountCode = resolveCode(leg.accountId, accCodeMap, "IN", leg.id);
    }
  }
  return out;
}

function buildOutLeg(leg, accCodeMap) {
  const amount = Number(leg.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`OUT leg ${leg.id}: amount must be > 0 (got "${leg.amount}")`);
  }
  if (!leg.currency || leg.currency.length < 2) {
    throw new Error(`OUT leg ${leg.id}: currency required`);
  }
  const destination = leg.destination === "to_balance" ? "to_balance" : "physical";
  const deferred = !!leg.deferred;
  if (destination === "to_balance" && deferred) {
    throw new Error(`OUT leg ${leg.id}: to_balance cannot be deferred`);
  }
  const out = {
    currency: leg.currency.toUpperCase(),
    amount,
    destination,
    deferred,
  };

  // Rate — обязательно для OUT (даже = 1 для same-currency)
  const rate = Number(leg.rate);
  if (Number.isFinite(rate) && rate > 0) {
    out.rate = rate;
    out.rateSource = leg.rateManual ? "manual" : "market";
  }

  // accountCode обязателен для physical (включая deferred)
  if (destination === "physical") {
    if (!leg.accountId) {
      throw new Error(
        `OUT leg ${leg.id}: physical destination requires accountId ` +
        `(deferred legs тоже — для будущего complete_deal_leg)`
      );
    }
    if (accCodeMap === null || accCodeMap === undefined) {
      // Legacy passthrough
      out.accountId = leg.accountId;
    } else {
      out.accountCode = resolveCode(leg.accountId, accCodeMap, "OUT", leg.id);
    }
  }

  return out;
}

function buildCommission(entries, outLegs, conditions = {}) {
  // no_commission flag → empty array (RPC всё равно требует non-empty…
  // тут расхождение со spec этап 3. RPC create_deal_v2 валидирует
  // commission как non-empty. Пока выдаём sentinel = 0 ?
  // По текущей spec: "commission=[] (пустой)" — это нарушит RPC.
  // Решение: возвращаем sentinel в первой OUT-валюте с amount=0.01,
  // но проставляем kind='commission' и метку no_commission в metadata
  // (UI знает по metadata.no_commission что это formal placeholder).
  // Это keeps RPC happy + UX honest.
  const fees = Array.isArray(conditions.fees) ? conditions.fees : [];
  const noCommission = fees.includes("no_commission");

  const margin = conditions.margin_strategy || "pro_rata";

  if (noCommission) {
    if (outLegs.length === 0) {
      throw new Error("buildTx: cannot create sentinel — no OUT legs");
    }
    return [{ currency: outLegs[0].currency, amount: 0.01, kind: "commission" }];
  }

  // Filter user-entered entries
  const valid = entries
    .map((e) => ({
      currency: (e.currency || "").toUpperCase(),
      amount: Number(e.amount),
      kind: e.kind === "spread" ? "spread" : "commission",
    }))
    .filter((e) => e.currency && Number.isFinite(e.amount) && e.amount > 0);

  const outCurrencies = new Set(outLegs.map((l) => l.currency));
  const filtered = valid.filter((e) => outCurrencies.has(e.currency));

  // single_leg margin → всё на первой OUT-ноге, остальные ноги без commission.
  // Реализуем через объединение filtered entries в первый OUT.currency:
  //   sum amounts per kind → один entry с currency=outLegs[0].currency
  if (margin === "single_leg") {
    if (outLegs.length === 0) {
      throw new Error("buildTx: cannot single_leg commission — no OUT legs");
    }
    const totalAmount = filtered.reduce((s, e) => s + e.amount, 0);
    if (totalAmount === 0) {
      // Sentinel
      return [{ currency: outLegs[0].currency, amount: 0.01, kind: "commission" }];
    }
    return [{
      currency: outLegs[0].currency,
      amount: parseFloat(totalAmount.toFixed(8)),
      kind: "commission",
    }];
  }

  // pro_rata (default) — по одной entry на currency
  if (filtered.length === 0) {
    if (outLegs.length === 0) {
      throw new Error("buildTx: cannot create sentinel commission — no OUT legs");
    }
    return [{ currency: outLegs[0].currency, amount: 0.01, kind: "commission" }];
  }

  // Dedup по currency (last wins)
  const byCurrency = new Map();
  filtered.forEach((e) => byCurrency.set(e.currency, e));
  return Array.from(byCurrency.values());
}

function resolveCode(legacyId, map, sideLabel, legId) {
  const code = map && map[legacyId];
  if (!code) {
    throw new Error(
      `${sideLabel} leg ${legId}: no ledger_account_code mapping for accountId=${legacyId}. ` +
      `Account is legacy_only or not yet seeded в ledger.accounts.`
    );
  }
  return code;
}
