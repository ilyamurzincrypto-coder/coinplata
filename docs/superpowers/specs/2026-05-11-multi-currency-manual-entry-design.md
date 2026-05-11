# Multi-currency ручная проводка — Spec

**Date:** 2026-05-11
**Status:** approved (design); implementation pending — the DB migration to a financial RPC should be done in a focused session, not appended to a long run.
**Depends on:** v2 ledger, `ledger.create_manual_entry` RPC (Posting Master), rates store (`getRate`), base currency.

## Problem
`ledger.create_manual_entry(p_lines, p_currency_code, …)` requires every line to be in `p_currency_code` and balances `Σ Dr = Σ Cr` in that one currency. FX reclassifications and manual cross-currency conversions (not through deal/transfer flow) can't be recorded as a single entry. Note: the chess/ОСВ already support native per-currency views (PR #55) and P&L is already per-currency — the gap is only the *entry* side.

## Design — extend `ledger.create_manual_entry` in place (no new overload, no wrapper/grant change)

The 8-arg `ledger.create_manual_entry(uuid, text, jsonb, text, text, timestamptz, text, jsonb)` keeps its signature; the `public.create_manual_entry` wrapper and its grants are untouched. The new behaviour lives inside `p_lines` and `p_metadata`:

1. **Per-line currency.** Each `p_lines[i]` may carry `currency_code` (optional). Effective line currency `v_line_cur = COALESCE(NULLIF(line->>'currency_code',''), p_currency_code)`. Validations:
   - `v_line_cur` exists in `ledger.currencies` → P0002.
   - `account.currency_code = v_line_cur` → 22000 (the account must match its line's currency, not the entry default).
2. **FX rates.** `p_metadata->'fx_rates'` is an optional jsonb object `{ "<cur>": <rate to p_currency_code>, … }`. Per line, `v_fx = COALESCE((p_metadata->'fx_rates'->>v_line_cur)::numeric, CASE WHEN v_line_cur = p_currency_code THEN 1 ELSE NULL END)`. If `v_fx IS NULL` (or ≤ 0) → 22000 `'fx rate missing/invalid for currency X'`. So `p_currency_code` plays the role of the *reference currency* (rate 1); for single-currency entries (all lines = `p_currency_code`) no `fx_rates` are needed and `v_fx = 1` everywhere → identical to today.
3. **Balance check, in the reference currency:** `v_sum_dr_ref = Σ amount·v_fx` over Dr lines, `v_sum_cr_ref` likewise. `multi := (count of distinct line currencies) > 1`. If `multi` → tolerance `0.5` (ref-currency units; absorbs fx rounding); else → `0.01` (unchanged). `abs(v_sum_dr_ref - v_sum_cr_ref) > tol` → 22000.
4. **Insert.** Each `journal_entries` row gets its own `currency_code = v_line_cur`. The transaction `metadata` keeps `fx_rates` (audit-useful: "balanced at these rates"), plus `'reference_currency' = p_currency_code` and `'multi_currency' = multi`. The audit alert message includes `multi`/the currency set.

Rejected alternatives:
- A new 9-arg overload with `p_fx_rates jsonb` — cleaner param, but means a 2nd `ledger.*` overload + a 2nd `public.*` wrapper + a 2nd grant; more surface to get wrong. The `p_metadata->'fx_rates'` transport (documented in the migration comment) keeps it to a single in-place change.
- Two chained `create_adjustment('transfer', …)` through `fx_clearing` (the existing "use two separate adjustments" workaround for cross-currency transfers) — no migration, but it's two transactions, leaves residue on `fx_clearing`, and is a worse UX for "one logical entry".

## Frontend

- **`src/lib/treasury/postingEntry.js`** — the draft line model gains `currency` per line (currently one `currency` for the whole draft). `validatePostingDraft`: drop the entry-level `currency` requirement; require each line to have a currency that matches its account; balance now `Σ(Dr·fx) ≈ Σ(Cr·fx)` in the base currency (the validator needs `getRate` access, or the caller passes `fxOf(cur)`); require ≥1 Dr and ≥1 Cr. `buildManualEntryPayload(draft, baseCurrency, getRate)` → `{ lines: [{accountCode, direction, amount, currencyCode, clientId?, partnerId?}], currencyCode: baseCurrency, fxRates: { cur: getRate(cur, baseCurrency) for each distinct line currency } , reason, effectiveDate, description, metadata }`. For an all-one-currency draft, `fxRates` is `{}` and `currencyCode` is that currency (back-compat path).
- **`src/pages/treasury_v2/tabs/PostingTab.jsx`** — the currency `<select>` moves from the header to a per-line column (next to the account picker). The account picker for a line uses that line's currency. The balance indicator becomes `Σ Дт ≈ Σ Кт (в базовой)` with the per-line base equivalents shown when currencies differ; same-currency entries look unchanged. On submit, pass `fxRates` from `getRate(cur, baseCurrency)`.
- **`src/lib/newLedger.js`** — `rpcCreateManualEntryV2(payload)`: accept `payload.fxRates` → fold into `p_metadata.fx_rates`; `payload.lines[i].currencyCode` → `line.currency_code`; `payload.currencyCode` → `p_currency_code` (the reference/base currency).
- **`src/lib/treasury/dealSummary.js` / chess / ОСВ** — no change (already currency-aware).

## Справка
`treasury` → `posting-master` sub: add a `how` bullet (multi-currency proводка — у каждой строки своя валюта; баланс в базовой; курсы берутся автоматически) + a worked example (USD↔TRY reclass with both legs and the implied base balance).

## i18n
`trv2_pm_col_currency` already exists (the header label) → reuse as the per-line column header; new: `trv2_pm_balance_base` ("Σ Dr ≈ Σ Cr (in base)" / "Σ Дт ≈ Σ Кт (в базовой)"), `trv2_pm_err_line_currency` ("Account currency must match the line's currency"), `trv2_pm_err_fx_missing` ("No FX rate for {cur} — set it in Settings → Rates"). ~3 keys × 3 langs.

## Testing
- `postingEntry.test.js` — per-line currency; multi-currency balance check in base; `fxRates` computed for distinct line currencies; back-compat single-currency draft; rejects line whose account currency ≠ line currency; rejects missing fx rate.
- `PostingTab.test.jsx` — per-line currency select; base-balance indicator when currencies differ; submit payload shape (lines with `currencyCode`, `fxRates`).
- DB RPC itself: not reachable via the existing test harness (would need DB tests) — covered by the explicit validation list above + manual smoke after migration.
- Full suite + `npm run build` green.

## Out of scope
- A `p_effective_date` per line; auto-revaluation jobs; FX-gain/loss auto-posting on rate changes; multi-currency in the legacy ExchangeForm-based flows.
