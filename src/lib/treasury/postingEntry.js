// src/lib/treasury/postingEntry.js
// Pure helpers for the Posting Master editor: which accounts/currencies are
// postable, the live Dr/Cr balance (in the base/reference currency), full draft
// validation, and mapping a draft to the rpcCreateManualEntryV2 payload.
// Each line carries its OWN currency; a manual entry may mix currencies — the
// balance check is then Σ(Dr·fx) ≈ Σ(Cr·fx) in the reference currency, where
// fx = fxOf(lineCurrency) (rate of that currency to the reference currency).
// No React, no Supabase. `fxOf` is supplied by the caller (e.g. `(c) => ctx.toBase(1, c)`).

// Account subtypes normally driven by automated flows (cashier deals, transfers,
// settlements). Posting to them by hand is allowed (the picker shows an informational
// chip); customer_liab / partner_liab additionally require a counterparty on the line.
export const SYSTEM_DRIVEN_SUBTYPES = new Set([
  "customer_liab", "partner_liab", "clearing", "fx_clearing", "crypto_input", "crypto_output",
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
const identityFx = () => 1;

export function deriveCurrencies(accounts) {
  const set = new Set();
  for (const a of accounts || []) if (a.active) set.add(a.currency);
  return [...set].sort();
}

// Accounts offered in the picker for a given line currency: active and matching currency.
// Dimensioned accounts (customer_liab / partner_liab) are included — the line then
// requires a counterparty (see validatePostingDraft).
export function accountsForCurrency(accounts, currency) {
  return (accounts || []).filter((a) => a.active && a.currency === currency);
}

// Distinct line currencies present in a draft's lines.
function lineCurrencies(lines) {
  const set = new Set();
  for (const l of lines || []) if (l.currency) set.add(l.currency);
  return [...set];
}

// Dr/Cr totals in the reference currency (each line weighted by fxOf(line.currency)).
export function postingBalance(lines, fxOf = identityFx) {
  let dr = 0, cr = 0;
  for (const l of lines || []) {
    const w = num(l.amount) * (Number(fxOf(l.currency)) || 0);
    if (l.side === "dr") dr += w;
    else if (l.side === "cr") cr += w;
  }
  return { dr, cr, delta: dr - cr };
}

// resolveAccount: (code) => account | null  (closure over useLedger().accounts).
// fxOf: (currency) => rate to the reference currency (e.g. ctx.toBase(1, currency)).
export function validatePostingDraft(draft, resolveAccount, fxOf = identityFx) {
  const errors = [];
  const d = draft || {};
  const lines = d.lines || [];

  if (!d.reason || String(d.reason).trim().length === 0)
    errors.push({ code: "reason_required", field: "reason", message: "Reason is required" });
  if (lines.length < 2)
    errors.push({ code: "too_few_lines", field: "lines", message: "A manual entry needs at least 2 lines" });

  let nDr = 0, nCr = 0;
  for (const l of lines) {
    if (l.side !== "dr" && l.side !== "cr")
      errors.push({ code: "side_required", lineId: l.id, field: "side", message: "Pick Debit or Credit" });
    else if (l.side === "dr") nDr++; else nCr++;

    if (!(num(l.amount) > 0))
      errors.push({ code: "amount_positive", lineId: l.id, field: "amount", message: "Amount must be > 0" });

    if (!l.currency)
      errors.push({ code: "currency_required", lineId: l.id, field: "currency", message: "Pick a currency" });
    else if (!(Number(fxOf(l.currency)) > 0))
      errors.push({ code: "fx_missing", lineId: l.id, field: "currency", message: "No FX rate for this currency — set it in Settings → Rates" });

    if (!l.accountCode) {
      errors.push({ code: "account_required", lineId: l.id, field: "account", message: "Pick an account" });
    } else {
      const acc = resolveAccount(l.accountCode);
      if (!acc || !acc.active) {
        errors.push({ code: "account_unknown", lineId: l.id, field: "account", message: "Unknown or inactive account" });
      } else if (l.currency && acc.currency !== l.currency) {
        errors.push({ code: "currency_mismatch", lineId: l.id, field: "account", message: "Account currency must match the line's currency" });
      } else if (acc.clientDimRequired && !l.clientId) {
        errors.push({ code: "client_required", lineId: l.id, field: "counterparty", message: "Pick a client" });
      } else if (acc.partnerDimRequired && !l.partnerId) {
        errors.push({ code: "partner_required", lineId: l.id, field: "counterparty", message: "Pick a partner" });
      }
    }
  }
  if (lines.length >= 2 && (nDr === 0 || nCr === 0))
    errors.push({ code: "need_dr_and_cr", field: "lines", message: "Need at least one Debit and one Credit line" });

  // Single-currency entry: raw Σ Dr = Σ Cr, ±0.01 (= the original behaviour exactly).
  // Multi-currency entry: Σ(Dr·fx) ≈ Σ(Cr·fx) in the reference currency, ±0.5 (absorbs fx rounding).
  const multi = lineCurrencies(lines).length > 1;
  const tol = multi ? 0.5 : 0.01;
  const { delta } = multi ? postingBalance(lines, fxOf) : postingBalance(lines);
  if (lines.length >= 2 && Math.abs(delta) > tol)
    errors.push({ code: "unbalanced", field: "lines", message: multi ? "Σ Debit must equal Σ Credit (in base currency)" : "Σ Debit must equal Σ Credit" });

  return { ok: errors.length === 0, errors };
}

// Maps a draft → rpcCreateManualEntryV2 payload.
//   referenceCurrency — the currency the fx rates are relative to (typically the base currency).
//   fxOf(c)           — rate of currency c to referenceCurrency.
export function buildManualEntryPayload(draft, referenceCurrency, fxOf = identityFx) {
  const d = draft || {};
  const desc = (d.description || "").trim();
  const fxRates = {};
  for (const c of lineCurrencies(d.lines)) fxRates[c] = c === referenceCurrency ? 1 : Number(fxOf(c)) || 0;
  const payload = {
    lines: (d.lines || []).map((l) => ({
      accountCode: l.accountCode,
      direction: l.side,
      amount: num(l.amount),
      currencyCode: l.currency,
      ...(l.clientId ? { clientId: l.clientId } : {}),
      ...(l.partnerId ? { partnerId: l.partnerId } : {}),
    })),
    currencyCode: referenceCurrency,
    fxRates,
    reason: (d.reason || "").trim(),
    effectiveDate: d.effectiveDate,
  };
  if (desc) payload.description = desc;
  return payload;
}
