// src/lib/dealForm/buildTx.js
// UI этап 2 — pure mapping legs[] state → v2 RPC payload (rpcCreateDealV2 shape).
//
// Совместим с adapter в newLedgerAdapter.js — но строит payload напрямую
// (без legacy-form пути). UI этап 2 → DealForm v2 → buildTx → rpcCreateDealV2.
//
// Контракт RPC create_deal_v2 (snake_case):
//   {
//     client_id, office_id,
//     in_legs:  [{ currency, amount, source: 'fresh'|'from_balance',
//                  account_code?, rate?, rate_source? }],
//     out_legs: [{ currency, amount, destination: 'physical'|'to_balance',
//                  account_code?, rate?, rate_source?, deferred? }],
//     commission: [{ currency, amount, kind: 'commission'|'spread' }],
//     description?, metadata?
//   }
//
// Account-code resolution делается ВНУТРИ buildTx через accountCodeByLegacyId
// map (передаётся вызывающим). Map собирается на UI-стороне один раз через
// `useAccounts()` + lookup `account.ledger_account_code`.

/**
 * Преобразует legs[] state в v2 RPC payload.
 *
 * @param {Object} args
 * @param {import('../../store/dealForm.js').DealFormState} args.state
 * @param {string} args.clientId  — UUID существующего клиента
 * @param {string} args.officeId
 * @param {Object<string,string>} args.accountCodeByLegacyId
 *   — карта public.accounts.id → ledger.accounts.code. Без неё buildTx
 *     не может resolve account_code и бросит для legs где accountId задан.
 * @param {string} [args.description]
 * @param {Object} [args.metadata]
 * @returns {Object} v2 payload
 */
export function buildTx({
  state,
  clientId,
  officeId,
  accountCodeByLegacyId = {},
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

  const commission = buildCommission(state.commission || [], outLegs);

  return {
    client_id: clientId,
    office_id: officeId,
    in_legs: inLegs,
    out_legs: outLegs,
    commission,
    description: description || null,
    metadata: { ui_form: "deal_v2", ...(metadata || {}) },
  };
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
    out.account_code = resolveCode(leg.accountId, accCodeMap, "IN", leg.id);
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
    out.rate_source = leg.rateManual ? "manual" : "market";
  }

  // account_code обязателен для physical (включая deferred)
  if (destination === "physical") {
    if (!leg.accountId) {
      throw new Error(
        `OUT leg ${leg.id}: physical destination requires accountId ` +
        `(deferred legs тоже — для будущего complete_deal_leg)`
      );
    }
    out.account_code = resolveCode(leg.accountId, accCodeMap, "OUT", leg.id);
  }

  return out;
}

function buildCommission(entries, outLegs) {
  // Filter empty
  const valid = entries
    .map((e) => ({
      currency: (e.currency || "").toUpperCase(),
      amount: Number(e.amount),
      kind: e.kind === "spread" ? "spread" : "commission",
    }))
    .filter((e) => e.currency && Number.isFinite(e.amount) && e.amount > 0);

  // RPC требует commission ⊆ outLegs.currency и non-empty array.
  const outCurrencies = new Set(outLegs.map((l) => l.currency));
  const filtered = valid.filter((e) => outCurrencies.has(e.currency));

  if (filtered.length === 0) {
    // Sentinel — минимальный commission в первой OUT-валюте.
    // Reality: margin уже встроен в rates, так что 0.01 это formality.
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
  const code = map[legacyId];
  if (!code) {
    throw new Error(
      `${sideLabel} leg ${legId}: no ledger_account_code mapping for accountId=${legacyId}. ` +
      `Account is legacy_only or not yet seeded в ledger.accounts.`
    );
  }
  return code;
}
