// src/lib/treasury/postingEntry.js
// Pure helpers for the Posting Master editor: which accounts/currencies are
// postable, the live Dr/Cr balance, full draft validation, and mapping a draft
// to the rpcCreateManualEntryV2 payload. No React, no Supabase.

// Account subtypes that are normally driven by automated flows (cashier deals,
// transfers, settlements). Posting to them by hand is allowed (informational
// warning chip), EXCEPT customer_liab / partner_liab which require a subconto
// dimension and are excluded from the v1 picker entirely.
export const SYSTEM_DRIVEN_SUBTYPES = new Set([
  "customer_liab", "partner_liab", "clearing", "fx_clearing", "crypto_input", "crypto_output",
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function deriveCurrencies(accounts) {
  const set = new Set();
  for (const a of accounts || []) if (a.active) set.add(a.currency);
  return [...set].sort();
}

// Accounts offered in the picker for a given entry currency: active, matching
// currency, and without a required client/partner dimension (v1 limitation).
export function accountsForCurrency(accounts, currency) {
  return (accounts || []).filter(
    (a) => a.active && a.currency === currency && !a.clientDimRequired && !a.partnerDimRequired
  );
}

export function postingBalance(lines) {
  let dr = 0, cr = 0;
  for (const l of lines || []) {
    if (l.side === "dr") dr += num(l.amount);
    else if (l.side === "cr") cr += num(l.amount);
  }
  return { dr, cr, delta: dr - cr };
}

// resolveAccount: (code) => account | null  — typically a closure over useLedger().accounts.
export function validatePostingDraft(draft, resolveAccount) {
  const errors = [];
  const d = draft || {};
  const lines = d.lines || [];

  if (!d.currency) errors.push({ code: "currency_required", field: "currency", message: "Pick a currency" });
  if (!d.reason || String(d.reason).trim().length === 0)
    errors.push({ code: "reason_required", field: "reason", message: "Reason is required" });
  if (lines.length < 2)
    errors.push({ code: "too_few_lines", field: "lines", message: "A manual entry needs at least 2 lines" });

  let nDr = 0, nCr = 0;
  for (const l of lines) {
    if (l.side !== "dr" && l.side !== "cr")
      errors.push({ code: "side_required", lineId: l.id, field: "side", message: "Pick Debit or Credit" });
    else if (l.side === "dr") nDr++; else nCr++;

    const amt = num(l.amount);
    if (!(amt > 0))
      errors.push({ code: "amount_positive", lineId: l.id, field: "amount", message: "Amount must be > 0" });

    if (!l.accountCode) {
      errors.push({ code: "account_required", lineId: l.id, field: "account", message: "Pick an account" });
    } else {
      const acc = resolveAccount(l.accountCode);
      if (!acc || !acc.active) {
        errors.push({ code: "account_unknown", lineId: l.id, field: "account", message: "Unknown or inactive account" });
      } else if (acc.currency !== d.currency) {
        errors.push({ code: "currency_mismatch", lineId: l.id, field: "account", message: "Account currency does not match the entry currency" });
      } else if (acc.clientDimRequired || acc.partnerDimRequired) {
        errors.push({ code: "dim_not_supported", lineId: l.id, field: "account", message: "Accounts with a required subconto dimension can't be posted from here yet" });
      }
    }
  }
  if (lines.length >= 2 && (nDr === 0 || nCr === 0))
    errors.push({ code: "need_dr_and_cr", field: "lines", message: "Need at least one Debit and one Credit line" });

  const { delta } = postingBalance(lines);
  if (lines.length >= 2 && Math.abs(delta) > 0.01)
    errors.push({ code: "unbalanced", field: "lines", message: "Σ Debit must equal Σ Credit" });

  return { ok: errors.length === 0, errors };
}

export function buildManualEntryPayload(draft) {
  const d = draft || {};
  const desc = (d.description || "").trim();
  const payload = {
    lines: (d.lines || []).map((l) => ({
      accountCode: l.accountCode,
      direction: l.side,
      amount: num(l.amount),
      ...(l.clientId ? { clientId: l.clientId } : {}),
      ...(l.partnerId ? { partnerId: l.partnerId } : {}),
    })),
    currencyCode: d.currency,
    reason: (d.reason || "").trim(),
    effectiveDate: d.effectiveDate,
  };
  if (desc) payload.description = desc;
  return payload;
}
