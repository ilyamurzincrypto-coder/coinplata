# newLedgerAdapter.js throw map (2026-05-09)

Source file: `src/lib/newLedgerAdapter.js` (commit `dae97c6`).

| Line | Throw text (truncated to ~50 chars) | Trigger |
|---|---|---|
| 20 | `resolveAccountCode: legacyId required` | `resolveAccountCode` called with falsy `legacyId`. |
| 26 | `resolveAccountCode lookup failed: ${error.message}` | Supabase `accounts` select returned an error during code resolution. |
| 27 | `resolveAccountCode: account ${legacyId} not found` | Supabase returned no row for the given legacy account id. |
| 29 | `Account "${name}" (${type}) is legacy_only and not s…` | Resolved account row has `legacy_only=true`; v2 cannot use it, suggests disabling `VITE_USE_NEW_LEDGER`. |
| 35 | `Account "${name}" has no ledger mapping. Cannot use …` | Account row exists but `ledger_account_code` is null — no v2 mapping configured. |
| 76 | `adapter: officeId required` | `adaptLegacyDealPayload` called with missing `legacy.officeId`. |
| 78 | `adapter: clientId or clientNickname required` | `adaptLegacyDealPayload` called without either `clientId` or `clientNickname`. |
| 95 | `Partner accounts in IN side are not supported in ne…` | Main IN leg specifies `inPartnerAccountId` (OTC partner); v2 doesn't support partner IN yet. |
| 100 | `adapter: fresh IN requires inAccountId` | Fresh (non-deferred) main IN leg has neither `inAccountId` nor `inPartnerAccountId`. |
| 120 | `Partner accounts in inPayments are not supported in…` | Multi-currency `inPayments[]` entry references a `partnerAccountId`. |
| 122 | `adapter: inPayments entry requires accountId` | `inPayments[]` entry has no `accountId` and no `partnerAccountId`. |
| 129 | `One-sided OUT deal (no IN side) is not supported in…` | After processing, `inLegs` is empty — pure OUT (withdrawal) shape rejected; suggests Withdrawal modal. |
| 142 | `Partner accounts in OUT side are not supported in n…` | OUT leg is partner-now (or has `partnerAccountId`) and not deferred; v2 doesn't support partner OUT yet. |
| 161 | `adapter: deferred OUT leg requires accountId for fu…` | OUT leg marked `ours_later`/`partner_later` lacks `accountId`; needed for future `complete_deal_leg`. |
| 172 | `One-sided IN deal (no OUT side) is not supported in…` | After processing, `outLegs` is empty — pure IN (top-up) shape rejected; suggests TopUp modal. |
| 236 | `adaptLegacyTopup: account lookup failed: ${error.message}` | Supabase `accounts` select for currency/name failed inside `adaptLegacyTopupPayload`. |
| 272 | `adaptLegacyTransfer: from-account lookup failed: ${e1.message}` | Supabase select for `fromAccountId.currency_code` failed in `adaptLegacyTransferPayload`. |
| 278 | `adaptLegacyTransfer: to-account lookup failed: ${e2.message}` | Supabase select for `toAccountId.currency_code` failed in `adaptLegacyTransferPayload`. |
| 281 | `Cross-currency transfer (${from}→${to}) not support…` | From/to accounts have different `currency_code`; `ledger.create_transfer` requires single currency. |
| 318 | `adaptLegacyAdjustment: account lookup failed: ${error.message}` | Supabase `accounts` select for currency/name failed inside `adaptLegacyAdjustmentPayload`. |
| 326 | `adaptLegacyAdjustment: balance lookup failed: ${e2.message}` | Supabase `account_movements` select for current-balance computation failed. |

## Notes

- All throws come from the `legacy → v2` payload converter functions.
- Error texts that mention "Disable VITE_USE_NEW_LEDGER" indicate cases where v2 deliberately doesn't support a legacy shape; these are the most likely production failure points.
- Line numbers are valid as of commit `dae97c6`. Re-grep before referencing in tests if the file has been edited since.

## Production deal-shape distribution (sampled 2026-05-09)

35 active deals (deleted_at IS NULL). The `public.deals` table has typed columns; OUT side is in `public.deal_legs`. Top shapes:

| n | currency_in | in_kind | partner | n_legs | out_currencies |
|---|---|---|---|---|---|
| 7 | USDT | cash (in_account_id) | none | 1 | USD |
| 6 | USD | cash | none | 1 | USDT |
| 3 | USD | cash | none | 1 | TRY |
| 3 | TRY | cash | none | 1 | USD |
| 3 | USDT | cash | none | 1 | TRY |
| 2 | USDT | NO in_account_id | none | 1 | EUR |
| 2 | USDT | cash | none | 2 | TRY,USD |
| 2 | USD | cash | none | 0 (one-sided IN) | — |
| 2 | USDT | cash | none | 2 | EUR,TRY |

**Zero deals** use `in_partner_account_id`. Sub-task 2.3b (partner adapter throw) is NOT the production blocker.

**Two deals are one-sided IN** (n_legs=0) and **two deals lack in_account_id**. Both shapes hit explicit adapter throws.

## Account `ledger_account_code` coverage gap (sampled 2026-05-09)

Of 39 `public.accounts`, 8 have `ledger_account_code IS NULL AND legacy_only IS NOT TRUE`. Six are in the deactivated "International Office" (`active=false`) and unlikely to appear in real submissions. **Two are in Terra City (active)** — the live risk:

| name | type | currency | office | risk |
|---|---|---|---|---|
| Cash · CHF / EUR / GBP / RUB / TRY / USD | cash | various | International Office (deactivated) | low |
| W89 Lara | crypto | USDT | **Terra City (active)** | **high** |
| W89 Lara | crypto | USDT | **Terra City (active)** | **high** |

Submitting any deal that uses W89 Lara as IN or OUT account triggers `newLedgerAdapter.js` line 35-38 ("Account has no ledger mapping").

## Chosen reproduction shape for Phase 2.2

Most common dominant shape (n=7): **1 IN cash USDT (W88 Mark, code 1316) + 1 OUT USD (Cash · USD, code 1110), no partner, deferredIn=false**. This shape SHOULD pass through `adaptLegacyDealPayload` cleanly. If the failing test in Phase 2.2 still throws, the bug is downstream of the adapter (RPC, request_hash, or supabase auth).

## Reproduction result (Task 2.2)

Adapter PASSES the dominant production shape. Bug is downstream — proceed to sub-task 2.3d (RPC probe).

Test file: `src/lib/__integration__/adapter-prod-shape.test.js`. Full suite count: 132 passing (was 131).

### Field-name discrepancies between plan and adapter source

The plan referenced `legacy.outLegs[]` for OUT-side input. The actual adapter reads **`legacy.outputs[]`** (`newLedgerAdapter.js:138`). All other field names matched (`currencyIn`, `amountIn`, `inAccountId`, `deferredIn`, plus per-output `currency`, `amount`, `rate`, `accountId`, `outKind`). The OUTPUT shape from the adapter does use `outLegs` in the v2 payload (`newLedgerAdapter.js:202`) — so the legacy field is `outputs`, the v2 field is `outLegs`. Test was written against the actual adapter input contract (`outputs[]`).
