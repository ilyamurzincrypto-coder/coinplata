# v2 Ledger Revival — Design Spec

**Status:** approved-pending-user-review
**Date:** 2026-05-10
**Branch target:** new branch `feat/v2-revival` off `main` (post-Treasury-MVP merge `e7962f7`)
**Successor spec:** `2026-05-1X-treasury-and-pnl-on-journal-entries-design.md` — written after Phase 3 ships and `ledger.transactions` starts populating.

---

## Goal

Make double-entry accounting the production reality of coinplata: every cashier-side operation (deal, transfer, top-up, balance adjustment) creates atomic Dr/Cr pairs in `ledger.journal_entries`. Until this ships, there is no real bookkeeping — there's only a single-sided `account_movements` log.

Concretely, by the end of this spec:

1. Production cashiers create deals through v2 RPCs (`ledger.create_deal_v2` etc.) — and 100 % of real deal shapes succeed, not just the textbook 2-sided exchange.
2. The 13 orphan rows in `ledger.balances` (opening balances without parallel `journal_entries`) are reconciled, the temporary `reconcile_paused_until` pause is removed, and `cron_reconcile_balances` runs healthy again.
3. `VITE_FORCE_V2=true` is set in Vercel; legacy `public.deals` is frozen via `freeze_legacy_tables`.
4. The 10 follow-up cashier operations (Edit / Delete / Complete / Settle / Cancel obligation / Partner-IO) execute through v2 RPC composition, no longer throw via `guardLegacyOnly`.

Treasury redesign and P&L view are deferred to **Spec B** because they depend on real `ledger.*` data flowing first; designing them on empty tables is guessing.

## Non-goals

- Treasury / Loro / Nostro / Capital UI redesign. Out of scope; deferred to Spec B.
- P&L statement, balance-sheet view, drill-down through journal entries to source documents. Spec B.
- Backfilling historical `public.deals` (35+) into `ledger.transactions`. Owner approved the read-only-archive policy: legacy stays frozen post-cutover; only new deals (post-flag-flip) populate `ledger.*`.
- New account classes / chart-of-accounts changes. The 174-account COA in `ledger.accounts` (asset / liability / equity / revenue / expense) is taken as given.
- Multi-tenancy / RLS on `ledger.*` tables. Security follow-up; pre-production-public blocker, but not blocking Phase 3 because internal-only.
- Realtime push (Supabase Channels) for Treasury — Spec B feature.
- DealForm v2 cosmetic redesign (the "two rates left/right" issue). Cosmetic; can ship after Phase 3.

## What's already there (inventoried 2026-05-10)

| Layer | Status |
|---|---|
| `ledger.accounts` chart of accounts | 174 accounts seeded; type-classified (asset 86 / liability 30 / equity 28 / revenue 21 / expense 9) |
| `ledger.transactions`, `ledger.journal_entries`, `ledger.balances` | Tables + constraints + triggers exist; `transactions`/`journal_entries` 0 rows; `balances` has 13 opening rows |
| Backend RPCs | `create_deal_v2`, `update_deal_v2`, `complete_deal_leg`, `create_topup`, `create_withdrawal`, `create_transfer`, `create_adjustment`, `create_reservation`, `release_reservation`, `reverse_transaction`, `update_tx_metadata`, `recognize_unearned`, workflow-* — all exist |
| Frontend wrappers (`src/lib/newLedger.js`) | 14 `rpc*V2` exports incl. `rpcCreateDealV2`, `rpcCreateTransferV2`, `rpcCreateAdjustmentV2`, `rpcUpdateDealV2`, `rpcReverseTransactionV2`, etc. |
| Frontend switcher (`src/lib/dealOperations.js`) | `createDeal`, `createTransfer`, `createTopup`, `createBalanceAdjustment` route on `USE_NEW_LEDGER`. Other 10 mutations use `guardLegacyOnly` and throw under v2. |
| Adapter (`src/lib/newLedgerAdapter.js`) | 2-sided exchange ✓; one-sided OUT / partner-account legs ✗ |
| DealForm v2 (`src/components/cashier/DealForm.jsx`) | Renders the form; Submit dispatches throw for incomplete legs (`fresh source requires accountId`) instead of disabling the button |
| Kill-switch | `USE_NEW_LEDGER` requires both `VITE_FORCE_V2=true` and `VITE_USE_NEW_LEDGER=true` (added 2026-05-09); Vercel currently has only the latter, so v2 is OFF in prod |
| Audit cron pause | `ledger.config.reconcile_paused_until = '2026-05-23 00:00:00+00'` — silences the "13 mismatches" alert until backfill |

**Implication:** the project is **frontend integration + DB cleanup**, not "build accounting from scratch". The work fits in roughly 7-10 working days, not 2-3 weeks.

## Architecture

Three sequential phases, each one merged to `main` separately so the production state remains recoverable at each step. Branch `feat/v2-revival` rebased between phases (or a fresh branch per phase — see "PR strategy").

### Phase 1 — Frontend coverage gaps

Goal: when `USE_NEW_LEDGER=true`, **every** real-world cashier flow that legacy supported must succeed, end-to-end. After Phase 1 the flag could be flipped on; we don't flip it yet because Phase 2 (data backfill) and Phase 3 (cutover) still pending.

**1a. DealForm v2 inline validation.** Today the form throws `IN leg ...: fresh source requires accountId` from `buildTx.js` on Submit. Refactor to:
- Compute a `validate(legs, conditions)` pure function that returns `{ ok, errors: [{ legId, field, message }] }`.
- The `<DealLegsTable>` reads errors and red-highlights the offending field; pencil-icon tooltip shows the message.
- `<SubmitCTA>` is `disabled` while `errors.length > 0`. The current button-disabling logic is already in `SubmitCTA.jsx`, just driven from `validate()`.
- buildTx still throws but the throw becomes unreachable in practice (defense-in-depth).

**1b. Adapter coverage.** Extend `adaptLegacyDealPayload(legacy)` in `src/lib/newLedgerAdapter.js`:
- One-sided OUT (no IN, all OUT): adapter routes via `rpcCreateWithdrawalV2` instead of `rpcCreateDealV2`. Same for one-sided IN → `rpcCreateTopupV2`. Caller (`dealOperations.createDeal`) accepts the alternate RPC return shape.
- Partner-account IN: when `inPartnerAccountId` is set, the IN leg's `accountCode` resolves to the chart-of-accounts entry for that partner Liability subaccount (lookup via `partner_accounts.ledger_account_code` mapping; if unset, throw a structured error directing owner to fill the mapping in Settings).
- Partner-account OUT: same idea for OUT legs with `partnerAccountId`.
- Multi-currency `inPayments[]` with partner refs: same partner-COA-mapping rule per row.

**1c. 10 v2 wrappers in `dealOperations.js`.** Replace each `guardLegacyOnly` throw with a real composition:

| Frontend op | v2 implementation |
|---|---|
| `updateDeal` | `rpcUpdateDealV2` (exists) |
| `deleteDeal` | `rpcReverseTransactionV2(target=dealTxId, reason='deleteDeal')` — proper accounting reversal |
| `completeDeal` | per-leg loop over `rpcCompleteDealLegV2` (exists) |
| `deleteTransfer` | `rpcReverseTransactionV2(target=transferTxId, reason='deleteTransfer')` |
| `settleObligation` | for `we_owe`: `rpcCompleteDealLegV2` on the deferred OUT leg of the originating deal; for `they_owe`: `rpcCreateAdjustmentV2` (Dr cash account / Cr customer-receivable) |
| `settleObligationPartial` | same but with partial amount |
| `receivePayment` | `rpcCreateAdjustmentV2` (Dr cash / Cr customer-receivable) |
| `cancelObligation` | `rpcReverseTransactionV2(target=obligationParentTxId, partial=obligation.amount, reason='cancelObligation')` |
| `recordPartnerInflow` | `rpcCreateAdjustmentV2` (Dr partner-asset / Cr partner-liability) — both sides are partner-coded accounts |
| `recordPartnerOutflow` | `rpcCreateAdjustmentV2` (Dr partner-liability / Cr office-cash) — partner withdraws from us |

Each wrapper is a 5-15-line pure function. `guardLegacyOnly` is removed. UI gates from PR #18 also lift naturally (the buttons/banners that disable under `USE_NEW_LEDGER` come back to life because the operations now work).

**1d. Tests for Phase 1.**
- Unit-test each new wrapper in `dealOperations.test.js` — replace the existing 5 "throws" assertions with "calls correct v2 RPC with correct payload" via spy.
- Adapter coverage tests in `newLedgerAdapter.test.js`: one-sided OUT, one-sided IN, partner IN, partner OUT.
- DealForm validation: introduce `dealForm/validate.test.js` with fixtures for incomplete legs (returns errors), complete legs (returns `{ ok: true }`).

**Phase 1 ends:** all tests green; `npm run build` clean; flag still OFF in prod.

### Phase 2 — Backfill 13 opening journal_entries

Goal: the 13 rows in `ledger.balances` get parallel rows in `ledger.journal_entries` so `cron_reconcile_balances` returns 0 mismatches. After this, the temporary cron pause (`reconcile_paused_until`) can be removed.

**Approach:**
- Query `ledger.v_balance_check` to get the exact 13 rows + amounts.
- For each: emit a synthetic opening transaction via `ledger.create_opening_from_inventory` (exists) — Dr = the asset account that has the balance; Cr = the corresponding equity account (e.g. `30.10 Opening capital`). The opening transaction is dated to `2026-04-01` or whatever the existing balances were stamped at; verify the date from `ledger.balances.updated_at`.
- Run `ledger.verify_opening` (exists) to double-check the result.
- After all 13 fixed, run `cron_reconcile_balances()` manually — expect zero mismatches.
- Remove the pause: `DELETE FROM ledger.config WHERE key='reconcile_paused_until'`.
- Update `docs/CUTOVER_RUNBOOK.md`'s "Temporary alert pause" section — mark it resolved.

**Phase 2 ends:** `cron_reconcile_balances()` returns 0 alerts; pause removed; runbook updated.

### Phase 3 — Cutover (re-enable v2 in production)

Goal: production cashiers now create deals through v2.

**Pre-flight (T-24h before flip):**
- Run pre-cutover validations from `docs/CUTOVER_RUNBOOK.md` §"Pre-cutover validations" — all must return 0:
  - C1: 0 pending deals in `public.deals`
  - C2: 0 open obligations in `public.obligations`
  - C3: 0 in-flight transfers
- If any return > 0 → resolve in legacy first; cutover blocked.

**Cutover steps:**
1. Set `VITE_FORCE_V2=true` in Vercel Production (and `VITE_USE_NEW_LEDGER=true` already present).
2. Vercel auto-deploy.
3. Run `ledger.freeze_legacy_tables()` — REVOKEs INSERT/UPDATE/DELETE on `public.{deals, deal_legs, deal_in_payments, deal_leg_payments, account_movements, partner_account_movements, obligations, transfers}` from app roles. Now legacy is read-only.
4. Smoke: cashier creates one real test deal (1 IN cash + 1 OUT crypto). Verify a row appears in `ledger.transactions` and corresponding pairs in `ledger.journal_entries`.
5. If smoke fails: `VITE_FORCE_V2=false` in Vercel + redeploy + restore legacy permissions via `GRANT ... TO authenticated, anon, service_role`. Cashiers back on legacy form within 5 minutes. Investigate.

**Phase 3 ends:** v2 ON in prod; legacy frozen; first real `ledger.transactions` row exists.

### After Phase 3

The PR for Phase 3 closes this spec. Spec B (Treasury & P&L on Journal Entries) is written next — informed by what real v2 data looks like.

## PR strategy

Three separate PRs to `main`, each from its own branch:

- `feat/v2-frontend-coverage` → Phase 1
- `chore/v2-opening-backfill` → Phase 2 (mostly DB migration + runbook update)
- `feat/v2-cutover` → Phase 3

Why three not one: Phase 1 is reversible (no schema or production state changes), Phase 2 is reversible (DELETE the journal entries + re-pause cron), Phase 3 is the riskiest. Splitting lets us land Phases 1-2 with confidence and front-load review attention on Phase 3.

## Permissions

Cashier creates / updates deals — same `transactions` permission. Edit / Delete / Complete — same. Settle / Cancel obligation — same. The 174-account chart of accounts viewer (Phase B addition) will probably need a new `accounting` section in the permissions matrix; out of scope here.

## Edge cases

| Case | Handling |
|---|---|
| Adapter encounters a deal shape we still didn't anticipate (e.g. tri-partite OTC with multiple partners) | Adapter throws a typed `UnsupportedDealShapeError` that includes which leg shape isn't supported; UI surfaces it cleanly via `withToast` (no cryptic stack); tests cover the throw path |
| Partner-account has no `ledger_account_code` mapping in `partner_accounts` table | Adapter throws structured "Счёт партнёра X не маппится на ledger — задай ledger_account_code в Settings → Партнёры → {partner.name} → счета"; PartnerAccountEditor gains a `ledger_account_code` input in Phase 1 (column already exists or added via 1-line migration). |
| Reverse-transaction RPC fails because target tx is older than 30 days (ledger may have a soft-cutoff) | Wrapper checks the cutoff and surfaces a clear error: "Сделка старше 30 дней — операция отмены недоступна, обратись к админу" |
| `freeze_legacy_tables` partial success (some grants fail) | Function is idempotent — re-running covers the gap; logs are checked before declaring Phase 3 complete |
| Cashier mid-deal during cutover | Pre-flight C1 check guarantees 0 pending; if a new deal lands during the 5-min flip window, retry with v2 |

## Testing

- **Unit tests:** all new wrappers + adapter cases + buildTx validate function (covered above).
- **Integration tests:** `src/lib/__integration__/v2-revival.test.js` — runs adapter → RPC mock chain end-to-end per cashier flow (deal create / edit / delete / partner inflow / etc.). Replaces / extends the existing `adapter-prod-shape.test.js`.
- **Manual smoke (Phase 3 only):** create one real deal on prod, verify in Supabase MCP. Owner does this with the PM.

## Acceptance criteria

A reviewer should be able to confirm at the end of each phase:

**Phase 1:**
- All `npm run test` passing — baseline 166 + new tests (estimate +30, total ~200).
- `npm run build` clean.
- Test app dev-mode: with `VITE_FORCE_V2=true`+`VITE_USE_NEW_LEDGER=true` in `.env.local`, cashier creates a normal deal AND a one-sided OUT deal AND a partner-IN deal — all succeed in the UI; resulting v2 payloads can be inspected (mock or real) without throw.

**Phase 2:**
- `SELECT count(*) FROM ledger.v_balance_check WHERE ABS(diff) > 0.00000001` returns 0.
- `SELECT * FROM ledger.config WHERE key='reconcile_paused_until'` returns 0 rows.
- After 1 hour, no new "Detected N balance mismatches" alerts in `ledger.audit_alerts`.
- `docs/CUTOVER_RUNBOOK.md`'s temporary-pause section marked resolved.

**Phase 3:**
- Production smoke deal exists in `ledger.transactions`; corresponding pairs in `ledger.journal_entries` (count ≥ 2 per leg).
- `public.deals` rejects INSERT from authenticated role (legacy frozen).
- Owner reports the cashier flow visually identical (or improved) to before the flag flip.

## References

- `docs/PRODUCTION_REALITY_CHECK.md` — situation snapshot leading up to the kill-switch decision.
- `docs/CUTOVER_RUNBOOK.md` — pre-existing cutover playbook (Direction 1) — most steps still apply; Phase 2 adds the backfill leg to it.
- `docs/superpowers/plans/2026-05-09-dealform-v2-prod-fix.md` — earlier plan that addressed the immediate failure; Phase 1 here completes work that plan deferred.
- `docs/superpowers/specs/2026-05-09-treasury-mvp-design.md` — the previous "wrong direction" Treasury MVP; intentionally superseded by Spec B once Phase 3 ships.
- Memory: `project_v2_direction.md` — owner-aligned product direction (real double-entry, not dashboards).
