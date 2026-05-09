# DealForm v2 Production Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore working deal-creation flow on production by (a) finding why DealForm v2 + adapter never produced a successful `ledger.create_deal_v2` call, (b) closing the split-brain in `dealOperations.js` where new deals go to v2 but edits/deletes still go to legacy, (c) silencing the noisy `ledger.audit_alerts` cron so future debugging signals are visible.

**Architecture:** Work on a fresh branch `fix/dealform-v2-prod` cut from `main`. Diagnose by writing a TDD-style integration test that reproduces a real production payload (1 IN cash + 1 OUT crypto, no partner) against the live `adaptLegacyDealPayload` + `rpcCreateDealV2` chain — failure point will pinpoint whether the bug lives in the adapter, the RPC, the request_hash logic, or the missing `accountCodeByLegacyId` map. Then narrow-fix the throw site, gate every legacy-only mutation behind a `USE_NEW_LEDGER` guard, raise the cron threshold so opening-balance noise stops drowning real alerts, ship via a small PR to `main`, and verify by creating one real deal on `coinplata.vercel.app`.

**Tech Stack:** Vite + React 18 + Vitest (`vitest run`), Supabase JS client, PostgreSQL with `ledger.*` and `operations.*` schemas, Vercel auto-deploy from `main`.

**Out of scope (deferred):**
- Treasury Dashboard MVP (P2 — only after v2 ledger has real data).
- Visual layout fix for "two rates left/right" (needs screenshot from owner).
- Deep balance-mismatch reconciliation (raise threshold now, real fix later).
- Cutover scripts in `cutover/direction1` (separate branch, separate process).
- RLS policies on `ledger.*` tables (security follow-up; pre-public-cutover blocker, but not blocking the form fix).

**Branch policy:** All work on `fix/dealform-v2-prod`. PR target: `main`. After merge, Vercel auto-deploys to `coinplata.vercel.app`.

**Test policy:** Every fix gets a failing test first that demonstrates the bug, then minimal code to make it pass, then commit. `npm run test` (vitest run) on every step that touches code. `npm run build` before PR.

---

## Phase 0 — Setup

### Task 0.1: Create working branch from `main`

**Files:** none (git only)

- [ ] **Step 1: Verify clean tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean` on `cutover/direction1`.

- [ ] **Step 2: Fetch and create branch from origin/main**

```bash
git fetch origin
git switch --create fix/dealform-v2-prod origin/main
```

Expected: switched to a new branch tracking `origin/main`. `git rev-parse HEAD` should equal `b0c325f`.

- [ ] **Step 3: Push the branch (memory rule: commit without push = not done)**

```bash
git push -u origin fix/dealform-v2-prod
```

### Task 0.2: Smoke-check baseline tests

**Files:** none (test runner only)

- [ ] **Step 1: Install deps if needed**

```bash
npm install
```

- [ ] **Step 2: Run full test suite**

```bash
npm run test
```

Expected: 131/131 pass. **If any fail on a clean checkout** — STOP and surface the failure to owner before continuing. We need a green baseline to be confident new failures come from our work, not from flaky existing tests.

### Task 0.3: Set up local `.env.local` mirroring production flags

**Files:**
- Create: `.env.local` (git-ignored — already covered by `.gitignore`)

- [ ] **Step 1: Copy template + add flags**

```bash
cp .env.local.example .env.local
```

Then append (manually edit):

```
VITE_USE_NEW_DEAL_FORM=true
VITE_USE_NEW_LEDGER=true
```

(`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from existing values; if missing, owner must paste from Vercel project env.)

- [ ] **Step 2: Verify dev server boots without errors**

```bash
npm run dev
```

Expected: Vite serves `http://localhost:5173`, no console errors on initial load. Ctrl+C to stop. **Keep this terminal handy** — we'll come back to it in Phase 2.

---

## Phase 1 — Document the throw map

Before reproducing the bug, build a single-source-of-truth list of every `throw` in the v2 path. Future tests reference these by line number.

### Task 1.1: Inventory adapter throw sites

**Files:**
- Read: `src/lib/newLedgerAdapter.js`
- Create: `docs/superpowers/notes/2026-05-09-adapter-throw-map.md`

- [ ] **Step 1: Read adapter end-to-end**

```bash
git grep -n "throw new Error" src/lib/newLedgerAdapter.js
```

- [ ] **Step 2: Write the throw map**

Create `docs/superpowers/notes/2026-05-09-adapter-throw-map.md` with this exact content (verify line numbers match current file; update if drifted):

```markdown
# newLedgerAdapter.js throw map (2026-05-09)

| Line | Throw text (truncated) | Trigger |
|---|---|---|
| 20 | resolveAccountCode: legacyId required | empty legacyId argument |
| 26 | resolveAccountCode lookup failed | supabase select error |
| 27 | resolveAccountCode: account ${id} not found | row missing |
| 29-32 | Account "${name}" is legacy_only … | account flagged legacy_only |
| 35-37 | Account "${name}" has no ledger mapping | ledger_account_code IS NULL |
| 76 | adapter: officeId required | legacy.officeId empty |
| 78 | adapter: clientId or clientNickname required | both empty |
| 95-98 | Partner accounts in IN side not supported | inPartnerAccountId set |
| 100 | adapter: fresh IN requires inAccountId | no inAccountId, no partner, fresh source |
| 130-133 | One-sided OUT deal not supported | outLegs empty + inLegs empty fallback |
| 142-145 | Partner accounts in OUT side not supported | OUT leg uses partnerAccountId |
| 173-176 | One-sided IN deal not supported | inLegs empty |
| 281-284 | Cross-currency transfer not supported | from/to currencies differ in transfer |
```

- [ ] **Step 3: Commit the note + push**

```bash
git add docs/superpowers/notes/2026-05-09-adapter-throw-map.md
git commit -m "docs(plan): adapter throw map for v2 prod debug"
git push
```

---

## Phase 2 — Reproduce the failure with a failing integration test

The 35 deals in `public.deals` have shapes we can mine for a realistic payload. We turn the most common shape into a Vitest integration test that exercises `adaptLegacyDealPayload` end-to-end against a mocked supabase. The test reveals which throw fires (or whether RPC layer fails after adapter succeeds).

### Task 2.1: Sample the most common deal shape from production

**Files:** none (read-only SQL via Supabase MCP)

- [ ] **Step 1: Query the most common deal pattern**

Run via Supabase MCP `execute_sql`:

```sql
SELECT
  COUNT(*) AS n,
  d.payload->'currencyIn'  AS cur_in,
  d.payload->'currencyOut' AS cur_out,
  jsonb_typeof(d.payload->'inAccountId')         AS has_in_account,
  jsonb_typeof(d.payload->'inPartnerAccountId')  AS has_partner,
  jsonb_typeof(d.payload->'deferredIn')          AS has_deferred,
  jsonb_array_length(COALESCE(d.payload->'outLegs','[]')) AS n_out_legs
FROM public.deals d
GROUP BY 2,3,4,5,6,7
ORDER BY n DESC
LIMIT 10;
```

Note: column names assume payload is JSONB-shaped from `rpcCreateDeal`. **If `public.deals` has no `payload` column**, fall back to:

```sql
SELECT
  d.id, d.created_at, d.in_currency, d.out_currency,
  d.in_account_id IS NOT NULL AS has_in_account,
  COUNT(dl.id) AS n_legs
FROM public.deals d
LEFT JOIN public.deal_legs dl ON dl.deal_id = d.id
GROUP BY d.id
ORDER BY d.created_at DESC
LIMIT 10;
```

- [ ] **Step 2: Pick the dominant shape and record it in the note**

Append to `docs/superpowers/notes/2026-05-09-adapter-throw-map.md`:

```markdown
## Dominant production deal shape (sampled 2026-05-09)

[paste rows from query]

Chosen reproduction shape:
- 1 IN leg, currency = <X>, account = real public.accounts.id
- 1 OUT leg, currency = <Y>, account = real public.accounts.id
- no partner, no deferredIn
```

- [ ] **Step 3: Commit + push**

```bash
git add docs/superpowers/notes/2026-05-09-adapter-throw-map.md
git commit -m "docs(plan): production deal shape sampled"
git push
```

### Task 2.2: Write the failing reproduction test

**Files:**
- Create: `src/lib/__integration__/adapter-prod-shape.test.js`
- Test: same file

- [ ] **Step 1: Create the directory and the failing test**

Create `src/lib/__integration__/adapter-prod-shape.test.js`:

```js
// Reproduces a production-shaped legacy payload through adaptLegacyDealPayload.
// If this PASSES — the bug is downstream (RPC layer / supabase). If it FAILS —
// we have the exact throw site and can fix it.

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock supabase to return realistic chart-of-accounts rows.
// Replace the IDs below with values from Task 2.1 if they differ.
const FAKE_ACCOUNTS = {
  // shape: legacy id → ledger row
  "in-cash-id": {
    ledger_account_code: "1011",  // sample cash account
    legacy_only: false,
    name: "Mark Antalya — USD cash",
    type: "office_cash",
  },
  "out-crypto-id": {
    ledger_account_code: "1316",  // sample TRC20 office wallet
    legacy_only: false,
    name: "Mark Antalya — USDT TRC20",
    type: "office_crypto",
  },
};

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(function (col, val) {
        const id = String(val);
        const row = FAKE_ACCOUNTS[id];
        this.single = vi.fn().mockResolvedValue(
          row
            ? { data: row, error: null }
            : { data: null, error: { message: "not found" } }
        );
        return this;
      }),
      single: vi.fn(),
    })),
  },
}));

import { adaptLegacyDealPayload } from "../newLedgerAdapter.js";

describe("adaptLegacyDealPayload — production shape", () => {
  it("produces a v2 payload from 1-IN-cash + 1-OUT-crypto (no partner)", async () => {
    const legacy = {
      officeId: "office-mark-antalya",
      clientId: "client-1",
      currencyIn: "USD",
      amountIn: 1000,
      inAccountId: "in-cash-id",
      deferredIn: false,
      outLegs: [
        {
          currency: "USDT",
          amount: 980,
          rate: 1.0204,
          accountId: "out-crypto-id",
        },
      ],
      commissionUsd: 5,
    };

    const v2 = await adaptLegacyDealPayload(legacy);

    // Sanity assertions — v2 must have both sides with account_code resolved.
    expect(v2.inLegs).toHaveLength(1);
    expect(v2.inLegs[0].account_code).toBe("1011");
    expect(v2.outLegs).toHaveLength(1);
    expect(v2.outLegs[0].account_code).toBe("1316");
    expect(v2.commission).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and capture the failure**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

Expected: **FAIL**. Record the exact error message and the throw site (line in `newLedgerAdapter.js`) in `docs/superpowers/notes/2026-05-09-adapter-throw-map.md` under a new section:

```markdown
## Reproduction result

Test `src/lib/__integration__/adapter-prod-shape.test.js` failed at:
- Throw text: <copy verbatim>
- File:line: <newLedgerAdapter.js:N>
- Stack frame chosen: <which adapter step>
```

If the test **passes** (adapter is fine), skip to Task 2.4 — bug is downstream.

- [ ] **Step 3: Commit the failing test + diagnosis note**

```bash
git add src/lib/__integration__/adapter-prod-shape.test.js docs/superpowers/notes/2026-05-09-adapter-throw-map.md
git commit -m "test(adapter): failing reproduction of production deal shape"
git push
```

### Task 2.3: Branch on the diagnosed root cause

Based on the throw recorded in Task 2.2 step 2, take exactly **one** of the four sub-tasks below. Do NOT attempt all four; pick the one that matches your failure.

#### Sub-task 2.3a — Fix `legacy_only` or missing `ledger_account_code` mapping

Trigger: throw at `newLedgerAdapter.js:29-32` or `35-37`.

**Files:**
- Modify: `src/lib/newLedgerAdapter.js:34-38`
- Modify: SQL via Supabase MCP — backfill missing `ledger_account_code` rows.

- [ ] **Step 1: Identify which `public.accounts` rows have no mapping**

```sql
SELECT id, name, type, currency_code, office_id, legacy_only
FROM public.accounts
WHERE ledger_account_code IS NULL
  AND legacy_only IS NOT TRUE
ORDER BY type, name;
```

- [ ] **Step 2: Apply backfill migration**

For each row: derive the `ledger.accounts.code` from the chart of accounts seed (see `supabase migrations ledger_1d_seed_chart_of_accounts`). Apply via `mcp__supabase__apply_migration` with name `backfill_ledger_account_code_2026_05_09`. SQL template:

```sql
UPDATE public.accounts SET ledger_account_code = '<code>'
WHERE id = '<uuid>';
```

(One UPDATE per row. Owner: confirm each mapping before applying — this is a write to production.)

- [ ] **Step 3: Re-run failing test**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "fix(adapter): backfill ledger_account_code for production accounts"
git push
```

#### Sub-task 2.3b — Fix partner accounts unsupported in IN/OUT

Trigger: throw at `newLedgerAdapter.js:95-98` or `142-145`.

This means a real production deal uses partner accounts that v2 doesn't support yet. **Do not silently route to legacy** — that's exactly the split-brain we're trying to close. Instead:

**Files:**
- Modify: `src/components/cashier/DealForm.jsx` (gate partner-leg UI)
- Or: `src/lib/dealOperations.js` (route partner deals to legacy explicitly)

- [ ] **Step 1: Decide policy with owner before coding**

Ask in chat: *"Sub-task 2.3b triggered. Production deal needs partner account in IN/OUT. Two options:
(A) block creating partner-leg deals in DealForm v2 until adapter supports them — clean but reduces functionality;
(B) route deals containing a partner leg through legacy `rpcCreateDeal` even when `USE_NEW_LEDGER=true` — restores function, deepens split-brain temporarily."*

- [ ] **Step 2: Implement the chosen option** (do not pre-write code — depends on owner's pick)

- [ ] **Step 3: Add a regression test that covers the chosen path** (test code shape depends on option chosen — write it after Step 2 produces the implementation, both in the same commit so TDD red-green is preserved within the local diff)

- [ ] **Step 4: Commit and push**

#### Sub-task 2.3c — Fix one-sided IN/OUT deal

Trigger: throw at `newLedgerAdapter.js:130-133` or `173-176`.

**Files:**
- Modify: `src/lib/newLedgerAdapter.js` (route to topup/withdrawal RPC)

- [ ] **Step 1: Add a failing test for one-sided OUT (withdrawal-shaped deal)**

Append to `src/lib/__integration__/adapter-prod-shape.test.js`:

```js
it("routes one-sided OUT deal through withdrawal semantics, not deal_v2", async () => {
  const legacy = {
    officeId: "office-mark-antalya",
    clientId: "client-1",
    currencyIn: "USD",
    amountIn: 0,                    // no IN
    deferredIn: false,
    outLegs: [
      { currency: "USDT", amount: 500, rate: 1, accountId: "out-crypto-id" },
    ],
  };
  // Expected: adapter throws ConfigurableError that consumer can catch
  // and re-route to rpcCreateWithdrawalV2. Or: adapter itself routes.
  // Pick one based on existing newLedger.js shape — see ../newLedger.js exports.
  await expect(adaptLegacyDealPayload(legacy)).rejects.toThrow(/withdrawal|TopUp/i);
});
```

- [ ] **Step 2: Run, expect FAIL with the existing "not supported" message**

- [ ] **Step 3: Modify `newLedgerAdapter.js:130-176`** to throw a tagged error class (`OneSidedDealError`) carrying enough info for the caller. **OR** modify `dealOperations.createDeal` to detect one-sided shape pre-call and route to `createWithdrawal` / `createTopup`. Pick whichever is closer to existing patterns.

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit and push**

#### Sub-task 2.3d — Adapter passes, RPC fails

Trigger: Task 2.2 test PASSES (the adapter is fine).

**Files:**
- Modify: `src/lib/newLedger.js` (add response logging)
- Use: Supabase MCP `get_logs` to inspect server-side errors

- [ ] **Step 1: Make a real call to v2 RPC from a small standalone script**

Create `scripts/probe-create-deal-v2.mjs`:

```js
// One-shot prober — calls rpcCreateDealV2 with a known-good payload
// and prints the raw error from supabase. Throwaway script.
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);
const payload = {
  // paste the v2 payload that the passing Task 2.2 test produced
};
const { data, error } = await supabase.rpc("create_deal_v2", payload);
console.log({ data, error });
```

Run:

```bash
node --env-file=.env.local scripts/probe-create-deal-v2.mjs
```

- [ ] **Step 2: Read server-side Supabase logs for matching timestamp**

Use `mcp__supabase__get_logs` to pull database logs around the request. Record the actual SQL error.

- [ ] **Step 3: Decide fix scope based on error**

Common cases and fixes:
- _function does not exist_ — check the migrations applied vs what RPC name we call. Possible drift between migration and code.
- _permission denied for schema ledger_ — RLS or `GRANT EXECUTE` issue on `ledger.create_deal_v2`. Fix via migration.
- _idempotency key conflict_ — request_hash logic in `src/lib/newLedger.js` is producing collisions. Inspect `requestHash()` in `newLedger.js`.

Whichever applies, write a failing test first (e.g. for permissions: assert RPC returns row from anon role), then apply minimal fix.

- [ ] **Step 4: Delete the probe script, commit fix and test**

```bash
rm scripts/probe-create-deal-v2.mjs
git add -A
git commit -m "fix(newLedger): <specific fix for diagnosed RPC error>"
git push
```

### Task 2.4: Final integration smoke

After 2.3 sub-task:

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: 132+ pass (baseline 131 + at least one new test). All existing tests still green.

- [ ] **Step 2: Manual smoke in dev server**

```bash
npm run dev
```

Open `http://localhost:5173`, log in (`u_adm` admin), open Cashier, click "+ Сделка", create one realistic deal (1 IN cash + 1 OUT crypto). Submit.

Expected: success toast, no console errors. Verify in Supabase MCP:

```sql
SELECT id, status, source_kind, created_at
FROM ledger.transactions
ORDER BY created_at DESC LIMIT 1;
```

Expected: 1 row from the last 60 seconds.

- [ ] **Step 3: If smoke passes — proceed to Phase 3.** If smoke fails — return to Task 2.3 and pick the next sub-task that matches the new error.

---

## Phase 3 — Close the split-brain in `dealOperations.js`

`createDeal/createTransfer/createTopup/createBalanceAdjustment` already route by `USE_NEW_LEDGER`. But `updateDeal`, `deleteDeal`, `completeDeal`, `deleteTransfer`, `settleObligation`, `settleObligationPartial`, `receivePayment`, `cancelObligation`, `recordPartnerInflow`, `recordPartnerOutflow` are hardcoded to legacy `rpc*` (`src/lib/dealOperations.js:87-96`). When `USE_NEW_LEDGER=true`, any edit/delete on a v2 deal corrupts data.

**Minimum-viable fix:** when `USE_NEW_LEDGER=true`, throw a clear error from each unsafe export so UI can surface it as a disabled button + tooltip instead of corrupting state. Full v2 routing is a follow-up.

### Task 3.1: Failing test for guarded `updateDeal` / `deleteDeal`

**Files:**
- Modify: `src/lib/dealOperations.test.js` (create if missing)
- Test: same file

- [ ] **Step 1: Check whether the test file exists**

```bash
ls src/lib/dealOperations.test.js 2>/dev/null
```

If absent, create it; if present, append the new `describe` block.

- [ ] **Step 2: Write the failing tests**

```js
// src/lib/dealOperations.test.js
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ENV = import.meta.env;

describe("dealOperations split-brain guards", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("updateDeal throws when USE_NEW_LEDGER=true (v2 update not yet wired)", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { updateDeal } = await import("./dealOperations.js");
    await expect(updateDeal({ id: "x" })).rejects.toThrow(/v2.*update.*not.*supported|disable VITE_USE_NEW_LEDGER/i);
  });

  it("deleteDeal throws when USE_NEW_LEDGER=true", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { deleteDeal } = await import("./dealOperations.js");
    await expect(deleteDeal({ id: "x" })).rejects.toThrow(/v2.*delete.*not.*supported|disable VITE_USE_NEW_LEDGER/i);
  });

  it("settleObligation throws when USE_NEW_LEDGER=true", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { settleObligation } = await import("./dealOperations.js");
    await expect(settleObligation({})).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npm run test -- src/lib/dealOperations.test.js
```

Expected: 3 fails — the existing exports don't throw, they silently call legacy RPC.

### Task 3.2: Add the guards

**Files:**
- Modify: `src/lib/dealOperations.js:87-96`

- [ ] **Step 1: Replace the 10 hardcoded re-exports with guarded wrappers**

Replace lines 87-96 of `src/lib/dealOperations.js` with:

```js
function guardLegacyOnly(name, fn) {
  return async (...args) => {
    if (USE_NEW_LEDGER) {
      throw new Error(
        `${name}: not yet wired through v2 ledger. ` +
        `Disable VITE_USE_NEW_LEDGER to perform this operation, ` +
        `or wait for v2 ${name} support.`
      );
    }
    return await fn(...args);
  };
}

export const updateDeal               = guardLegacyOnly("updateDeal",               rpcUpdateDeal);
export const deleteDeal               = guardLegacyOnly("deleteDeal",               rpcDeleteDeal);
export const completeDeal             = guardLegacyOnly("completeDeal",             rpcCompleteDeal);
export const deleteTransfer           = guardLegacyOnly("deleteTransfer",           rpcDeleteTransfer);
export const settleObligation         = guardLegacyOnly("settleObligation",         rpcSettleObligation);
export const settleObligationPartial  = guardLegacyOnly("settleObligationPartial",  rpcSettleObligationPartial);
export const receivePayment           = guardLegacyOnly("receivePayment",           rpcReceivePayment);
export const cancelObligation         = guardLegacyOnly("cancelObligation",         rpcCancelObligation);
export const recordPartnerInflow      = guardLegacyOnly("recordPartnerInflow",      rpcRecordPartnerInflow);
export const recordPartnerOutflow     = guardLegacyOnly("recordPartnerOutflow",     rpcRecordPartnerOutflow);
```

- [ ] **Step 2: Run tests, expect PASS**

```bash
npm run test -- src/lib/dealOperations.test.js
```

Expected: 3 PASS.

- [ ] **Step 3: Run full suite, expect no regressions**

```bash
npm run test
```

Expected: total = previous baseline + 3 new = 134+ pass.

- [ ] **Step 4: Commit + push**

```bash
git add src/lib/dealOperations.js src/lib/dealOperations.test.js
git commit -m "fix(dealOperations): guard legacy-only mutations behind USE_NEW_LEDGER"
git push
```

### Task 3.3: Surface the guard in UI as a disabled button + tooltip

**Files:**
- Modify: `src/components/EditTransactionModal.jsx` (find where Save button is)
- Modify: `src/components/TransactionsTable.jsx` (find Edit/Delete row actions)
- Reference: `src/lib/newLedger.js:493-495` for `USE_NEW_LEDGER` import.

- [ ] **Step 1: Find the buttons**

```bash
git grep -n "updateDeal\|deleteDeal\|completeDeal\|settleObligation" src/components/
```

Note line numbers of every button/click handler that calls these.

- [ ] **Step 2: For each, gate the button**

Pattern (apply to each button handler found in Step 1):

```jsx
import { USE_NEW_LEDGER } from "../lib/newLedger.js";

// ... inside component:
<button
  disabled={USE_NEW_LEDGER}
  title={USE_NEW_LEDGER
    ? "Edit отключён в режиме v2 ledger — обратись к админу"
    : undefined}
  onClick={handleSave}
>
  Save
</button>
```

(Use the exact existing button JSX — only add `disabled` and `title` props. Don't restructure the component.)

- [ ] **Step 3: Manual smoke in dev**

```bash
npm run dev
```

Open existing legacy deal → Edit → Save button is disabled with tooltip. Same for Delete on transactions table.

- [ ] **Step 4: Commit + push**

```bash
git add src/components/EditTransactionModal.jsx src/components/TransactionsTable.jsx
git commit -m "fix(ui): disable edit/delete buttons when USE_NEW_LEDGER=true"
git push
```

---

## Phase 4 — Silence the noisy `ledger.audit_alerts` cron

The cron logs `critical — Detected 13 balance mismatches` every hour. Real fix (reconcile or wipe orphan opening balances) is deferred. Now: raise threshold so genuine issues are visible.

### Task 4.1: Find the cron schedule and threshold

**Files:** none (Supabase MCP)

- [ ] **Step 1: Inspect existing cron jobs**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT jobid, schedule, command, jobname
FROM cron.job
WHERE command ILIKE '%audit%' OR command ILIKE '%balance%mismatch%';
```

- [ ] **Step 2: Inspect the function the cron calls**

```sql
SELECT pg_get_functiondef('ledger.detect_balance_mismatches'::regproc);
```

(Replace function name with whatever the cron command shows.)

- [ ] **Step 3: Inspect the threshold config table**

```sql
SELECT * FROM ledger.balance_anomaly_config;
```

Read columns; the threshold likely lives here.

### Task 4.2: Raise the threshold via migration

**Files:**
- Migration: `supabase/migrations/<ts>_raise_balance_mismatch_threshold.sql` (apply via `mcp__supabase__apply_migration`)

- [ ] **Step 1: Decide threshold**

Based on the 13 mismatches observed (largest diff ≈ 15,000 USD), set threshold so that **all 13 current rows are below** it. Pick `min_diff_to_alert` = 20000 (USD-equivalent), with a `valid_from = '2026-05-09'` marker so we know this is a temporary lift.

If the table doesn't already have a `min_diff_to_alert` column, add a `paused_until` timestamp instead and have the function early-return when `now() < paused_until`.

- [ ] **Step 2: Apply migration via MCP**

Migration name: `audit_alerts_temp_silence_until_2026_05_23` (2-week pause).

```sql
-- Pause balance-mismatch alerts for 2 weeks while opening reconciliation
-- is investigated. See docs/PRODUCTION_REALITY_CHECK.md §4 B5.
UPDATE ledger.config
SET value = jsonb_build_object('paused_until', '2026-05-23 00:00:00+00')
WHERE key = 'balance_mismatch_alerts'
  AND EXISTS (SELECT 1 FROM ledger.config WHERE key = 'balance_mismatch_alerts');

-- If the row doesn't exist yet, insert it:
INSERT INTO ledger.config (key, value)
SELECT 'balance_mismatch_alerts',
       jsonb_build_object('paused_until', '2026-05-23 00:00:00+00')
WHERE NOT EXISTS (
  SELECT 1 FROM ledger.config WHERE key = 'balance_mismatch_alerts'
);
```

(Adjust column names to match `ledger.config` actual schema discovered in Task 4.1.)

- [ ] **Step 3: Modify the alert function to honor the pause**

Apply via `mcp__supabase__apply_migration`. Wrap the existing `detect_balance_mismatches` body in:

```sql
DECLARE
  pause_until timestamptz;
BEGIN
  SELECT (value->>'paused_until')::timestamptz
    INTO pause_until
  FROM ledger.config
  WHERE key = 'balance_mismatch_alerts';

  IF pause_until IS NOT NULL AND now() < pause_until THEN
    RETURN;
  END IF;

  -- ... existing detection body ...
END;
```

- [ ] **Step 4: Verify cron is silent**

Wait for next cron tick (≤60 min). Then:

```sql
SELECT created_at, message FROM ledger.audit_alerts
WHERE created_at > now() - interval '2 hours'
ORDER BY created_at DESC;
```

Expected: no new `Detected N balance mismatches` rows after the migration timestamp.

### Task 4.3: Document the pause

**Files:**
- Modify: `docs/CUTOVER_RUNBOOK.md` (append section)

- [ ] **Step 1: Append to CUTOVER_RUNBOOK.md**

Open the file, locate the "Rollback" or "Known issues" section, append:

```markdown
## ⚠️ Temporary alert pause (2026-05-09 → 2026-05-23)

`ledger.detect_balance_mismatches` is paused via `ledger.config.balance_mismatch_alerts.paused_until`.
Reason: opening balances were seeded into `ledger.balances` but matching `journal_entries` are missing
(13 rows, ≈30k USD + 19k USDT total drift). Investigation owner: <name>.
Resolve before 2026-05-23 by either backfilling the journal entries or zeroing the orphan balances.
After resolution, run:
```sql
DELETE FROM ledger.config WHERE key = 'balance_mismatch_alerts';
```
```

- [ ] **Step 2: Commit + push**

```bash
git add docs/CUTOVER_RUNBOOK.md
git commit -m "docs(runbook): document temporary balance-mismatch alert pause"
git push
```

---

## Phase 5 — Ship and verify on production

### Task 5.1: Final pre-PR sanity

- [ ] **Step 1: Full test suite**

```bash
npm run test
```

Expected: all green.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: build succeeds, `dist/` produced. Bundle size sanity (≤ ~150 KB gzip total).

- [ ] **Step 3: Manual smoke once more in dev mode**

```bash
npm run dev
```

Run through: create deal → success → check `ledger.transactions` row appears → try Edit → button disabled with tooltip → close.

### Task 5.2: Open PR

- [ ] **Step 1: Push final branch**

```bash
git push
```

- [ ] **Step 2: Create PR via gh**

```bash
gh pr create --base main --title "fix: restore DealForm v2 production submit + close split-brain" --body "$(cat <<'EOF'
## Summary
- Diagnose and fix root cause of zero successful v2 deals on prod since flag flip (see `docs/PRODUCTION_REALITY_CHECK.md` §4 B4)
- Guard 10 legacy-only mutations in `dealOperations.js` so `USE_NEW_LEDGER=true` no longer corrupts data via Edit/Delete/Settle
- Disable corresponding UI buttons when v2 flag is on
- Pause noisy `ledger.audit_alerts` cron until 2026-05-23 so real signals are visible (see `docs/CUTOVER_RUNBOOK.md`)

## Test plan
- [ ] `npm run test` — full suite green (baseline 131 + new tests)
- [ ] `npm run build` — production bundle builds without warnings
- [ ] After merge: create one real deal on `coinplata.vercel.app`, verify row in `ledger.transactions`
- [ ] After merge: open existing legacy deal, confirm Edit/Save button is disabled with tooltip
- [ ] After merge: confirm no new `balance_mismatch` alerts in `ledger.audit_alerts` over next 60 minutes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for owner review.** Do not self-merge.

### Task 5.3: Post-merge verification on production

- [ ] **Step 1: After owner merges, watch Vercel auto-deploy.**

(No CLI installed — owner can confirm via Vercel dashboard. ~2 minutes.)

- [ ] **Step 2: Open `coinplata.vercel.app`, log in, create one test deal**

Pick a small-amount realistic shape: 100 USD cash IN → 95 USDT TRC20 OUT. Submit.

Expected: success toast.

- [ ] **Step 3: Verify in Supabase**

Via `mcp__supabase__execute_sql`:

```sql
SELECT id, source_kind, status, created_at
FROM ledger.transactions
ORDER BY created_at DESC
LIMIT 3;
```

Expected: at least one row from the last 5 minutes with `source_kind='deal'` and `status='posted'`.

- [ ] **Step 4: Verify Edit guard on prod**

Open the just-created deal in the UI → Edit → Save button is disabled with tooltip "обратись к админу" (or whichever message ended up shipped).

- [ ] **Step 5: Verify cron silence**

```sql
SELECT created_at, level, message
FROM ledger.audit_alerts
WHERE created_at > now() - interval '90 minutes'
  AND message ILIKE '%balance mismatch%';
```

Expected: 0 rows.

- [ ] **Step 6: Report back to owner**

Post a final summary in chat with: PR URL, ledger.transaction id of the test deal, any unexpected behavior, status of the audit_alert silence.

---

## Self-review checklist (run before declaring plan complete)

**Spec coverage:**
- ✅ DealForm v2 submit failure → Phases 1–2
- ✅ Split-brain in `dealOperations.js` → Phase 3
- ✅ Noisy audit_alerts cron → Phase 4
- ✅ Branch policy `fix/dealform-v2-prod` from `main` → Task 0.1
- ✅ TDD discipline (failing test first) → 2.2, 3.1, sub-tasks where applicable
- ✅ Push after every commit (memory rule) → every commit step
- ✅ Apply migrations via MCP, not user → 2.3a, 4.2 (memory rule)
- ⏸ Visual layout fix B1 — explicitly deferred (needs screenshot)
- ⏸ Treasury Sprint 1-3 — explicitly deferred to P2
- ⏸ RLS policies — explicitly deferred to security follow-up

**Placeholders:** none. Sub-task 2.3 branches list specific code per case; sub-task 2.3b openly defers code to owner-policy decision (with explicit "ask in chat" step + concrete options).

**Type / signature consistency:** `USE_NEW_LEDGER` import path is the same in adapter, dealOperations, and UI files. `guardLegacyOnly` helper signature is consistent across all 10 export sites.

**Reversibility check:**
- Every code change is on a feature branch behind a PR (revertible via `git revert`).
- The cron pause migration is reversible via the documented `DELETE FROM ledger.config WHERE key = 'balance_mismatch_alerts'`.
- The backfill migration in 2.3a is owner-confirmed per row (no batch updates without approval).
