# v2 Ledger Revival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring double-entry accounting to production: every cashier-side operation creates `ledger.journal_entries` Dr/Cr pairs, the 13 orphan opening balances are reconciled, and `VITE_FORCE_V2=true` is set in Vercel with legacy `public.deals` frozen.

**Architecture:** Three sequential phases on branch `feat/v2-revival` (already exists). Phase 1 = frontend coverage gaps (adapter shapes, validate-before-throw, 10 v2 RPC wrappers). Phase 2 = SQL migration backfilling the 13 orphan opening balances. Phase 3 = production cutover with smoke verification. Each phase ends with a separate PR to `main`.

**Tech Stack:** React 18, Vitest 4, Tailwind 3, Supabase (PostgREST + plpgsql), `@supabase/supabase-js`. Backend RPCs already exist in schema `ledger.*`; this plan is mostly frontend integration + DB cleanup.

**Branch:** `feat/v2-revival` (already exists, off `main` post-`e7962f7`, contains spec commit `ea4da36`).

**Spec:** `docs/superpowers/specs/2026-05-10-v2-ledger-revival-design.md`.

---

## Phase 0 — Setup

### Task 0.1: Verify branch + baseline tests

**Files:** none (git only)

- [ ] **Step 1: Confirm branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status
```

Expected: `feat/v2-revival`. Clean tree (only spec commit).

- [ ] **Step 2: Run baseline test suite**

```bash
npx vitest run --no-file-parallelism
```

Expected: **166 passed** (137 baseline + 28 selectors + 1 Dashboard smoke from previous Treasury MVP merge).

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: succeeds (only pre-existing chunk-size warning).

---

## Phase 1 — Frontend coverage gaps

Outcome: `USE_NEW_LEDGER` (when both env vars set) handles every real cashier flow without a throw. Production flag still OFF.

### Task 1.1: Rename `partner_accounts.accounting_code` → `ledger_account_code`

**Files:**
- Migration via `mcp__supabase__apply_migration` name `partner_accounts_rename_accounting_code_to_ledger_account_code`
- Modify: `src/lib/supabaseReaders.js` (loadPartnerAccounts maps the column)
- Modify: `src/lib/supabaseWrite.js` (rpcInsertPartnerAccount, rpcUpdatePartnerAccount field names)
- Modify: `src/store/partnerAccounts.jsx` (field passes through unchanged once readers/writers are updated)

Currently `accounting_code` exists with 0 rows populated; `public.accounts` uses `ledger_account_code`. Renaming aligns vocabulary.

- [ ] **Step 1: Apply migration**

Use `mcp__supabase__apply_migration` with:

```sql
ALTER TABLE public.partner_accounts
  RENAME COLUMN accounting_code TO ledger_account_code;

COMMENT ON COLUMN public.partner_accounts.ledger_account_code
  IS 'Maps this partner account to a row in ledger.accounts (e.g. ''2210'' for Partner Liab USDT). Required when USE_NEW_LEDGER is true.';
```

- [ ] **Step 2: Update reader**

In `src/lib/supabaseReaders.js`, find `loadPartnerAccounts`:

```bash
grep -nE "accounting_code|partner_accounts" src/lib/supabaseReaders.js
```

Replace any `accounting_code:` reference with `ledger_account_code:`. The mapped object exposed to React should likewise be renamed to `ledgerAccountCode`.

- [ ] **Step 3: Update writers**

In `src/lib/supabaseWrite.js`, find `rpcInsertPartnerAccount` and `rpcUpdatePartnerAccount`:

```bash
grep -nE "accounting_code|partner_accounts" src/lib/supabaseWrite.js
```

Replace `accounting_code` with `ledger_account_code` in payload assembly. Replace exposed JS field name `accountingCode` (if present) with `ledgerAccountCode`.

- [ ] **Step 4: Update store**

In `src/store/partnerAccounts.jsx`, find `accountingCode` references:

```bash
grep -nE "accountingCode|accounting_code" src/store/partnerAccounts.jsx
```

Rename to `ledgerAccountCode`. Adjust normalised object shape.

- [ ] **Step 5: Build + grep no stale refs**

```bash
npm run build
grep -rE "accountingCode|accounting_code" src/ 2>/dev/null
```

Expected: build clean; grep returns no matches.

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "refactor(partner-accounts): rename accounting_code to ledger_account_code"
git push
```

### Task 1.2: PartnerAccountEditor — `ledger_account_code` input + chart-of-accounts picker

**Files:**
- Modify: `src/components/settings/PartnerAccountEditor.jsx` (or wherever the form lives — find via grep)
- Reference: `ledger.accounts` table (174 rows) for autocomplete suggestions

- [ ] **Step 1: Locate the editor**

```bash
grep -rE "PartnerAccountEditor|partnerAccount.*[Ee]dit" src/components 2>/dev/null | head -5
```

Note the file path. If no dedicated editor exists, the form fields live inside the Settings → Партнёры → Счета tab — find that.

- [ ] **Step 2: Read existing form layout**

Read the file. Identify where existing form fields (`name`, `currency_code`, `type`, `network_id`, `address`, `note`) are rendered. New `ledger_account_code` field goes in the same group.

- [ ] **Step 3: Add the input field**

Add this JSX near the existing form fields (adjust class names to match the file's convention):

```jsx
<div>
  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
    Ledger account code
    <span className="text-slate-400 font-normal normal-case ml-1.5">(чарт счетов: партнёрский Liab)</span>
  </label>
  <input
    type="text"
    value={form.ledgerAccountCode || ""}
    onChange={(e) => setForm({ ...form, ledgerAccountCode: e.target.value.trim() })}
    placeholder="2210"
    list="ledger-codes-partner"
    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
  />
</div>
```

(The `list="ledger-codes-partner"` ties to a `<datalist>` populated from `ledger.accounts` filtered by `type='liability'`. Skip the datalist for MVP — owner can paste codes directly.)

- [ ] **Step 4: Wire form state**

Ensure the existing form-state object reads/writes `ledgerAccountCode` and that submit-handler passes it to `addPartnerAccount` / `updatePartnerAccount`.

- [ ] **Step 5: Build + manual smoke**

```bash
npm run build
```

Expected: succeeds.

Skip dev-server smoke here — covered in the integration smoke at end of Phase 1.

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "feat(partner-accounts): ledger_account_code editor field"
git push
```

### Task 1.3: Backfill `ledger_account_code` for the 8 unmapped office accounts

**Files:**
- Migration via `mcp__supabase__apply_migration` name `accounts_backfill_ledger_codes_2026_05_10`

The chart of accounts has 174 rows in `ledger.accounts`. Each unmapped row in `public.accounts` (cash CHF/EUR/GBP/RUB/TRY/USD at one office, plus 2 W89 Lara crypto wallets) needs to point at the matching `ledger.accounts.code`.

- [ ] **Step 1: Inventory unmapped accounts**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT id, name, type, currency_code, office_id
FROM public.accounts
WHERE ledger_account_code IS NULL
  AND legacy_only IS NOT TRUE
ORDER BY type, name;
```

- [ ] **Step 2: Find matching ledger codes**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT code, name, type, currency_code, office_id
FROM ledger.accounts
WHERE active = true
  AND type = 'asset'
  AND subtype IN ('cash', 'crypto')
ORDER BY currency_code, code;
```

For each unmapped public account, manually identify the matching ledger code by (currency_code, type, office). The mapping is owner-specific; if any candidate is ambiguous, STOP and ask owner.

- [ ] **Step 3: Apply backfill migration**

Use `mcp__supabase__apply_migration` with:

```sql
-- 8 mappings derived from Step 2; replace placeholders with actual codes
UPDATE public.accounts SET ledger_account_code = '<CODE_CHF>' WHERE id = '49c3e87d-f0cc-473d-903b-6117c1c1bf24';
UPDATE public.accounts SET ledger_account_code = '<CODE_EUR>' WHERE id = '51110a67-1d6e-4e5e-8a38-ce8916c54b0f';
UPDATE public.accounts SET ledger_account_code = '<CODE_GBP>' WHERE id = '8dbef64c-347f-4be3-b7d7-c3841366b1c9';
UPDATE public.accounts SET ledger_account_code = '<CODE_RUB>' WHERE id = 'a67a3c7a-15d1-45c1-89ee-9bd6251efee0';
UPDATE public.accounts SET ledger_account_code = '<CODE_TRY>' WHERE id = 'a05f88cc-3db6-4af7-9eb1-ca552927d617';
UPDATE public.accounts SET ledger_account_code = '<CODE_USD>' WHERE id = 'df80a25f-5568-439a-8a66-1de7125fb6be';
UPDATE public.accounts SET ledger_account_code = '<CODE_W89_LARA_USDT_1>' WHERE id = '6297c1f9-5e8e-4db8-a4ac-262dae56fd7f';
UPDATE public.accounts SET ledger_account_code = '<CODE_W89_LARA_USDT_2>' WHERE id = '0b4a43db-4702-422b-8bdd-d804e7e0f041';
```

- [ ] **Step 4: Verify**

```sql
SELECT COUNT(*) FROM public.accounts WHERE ledger_account_code IS NULL AND legacy_only IS NOT TRUE;
```

Expected: 0.

- [ ] **Step 5: Commit migration record (no code change)**

The migration was applied via MCP, so there's nothing to commit in git for this task. Skip the commit; proceed to next task.

### Task 1.4: Adapter — one-sided OUT routes via withdrawal RPC

**Files:**
- Modify: `src/lib/newLedgerAdapter.js`
- Modify: `src/lib/dealOperations.js` (createDeal accepts alternate result shape)
- Modify: `src/lib/__integration__/adapter-prod-shape.test.js` (extend coverage)

Currently `adaptLegacyDealPayload` throws on one-sided OUT. The fix is to detect the shape and route to `rpcCreateWithdrawalV2` instead of `rpcCreateDealV2`.

- [ ] **Step 1: Failing test for one-sided OUT routing**

Append to `src/lib/__integration__/adapter-prod-shape.test.js`:

```js
import { adaptLegacyDealPayload } from "../newLedgerAdapter.js";

describe("adapter — one-sided OUT", () => {
  it("returns a withdrawal payload with kind='withdrawal' (no inLegs)", async () => {
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USD",
      amountIn: 0,
      deferredIn: false,
      outLegs: [{ currency: "USDT", amount: 500, rate: 1, accountId: "acc-crypto" }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.kind).toBe("withdrawal");
    expect(result.inLegs).toBeUndefined();
    expect(result.outLegs).toHaveLength(1);
    expect(result.outLegs[0].account_code).toBe("1316"); // example mapping
  });
});
```

(Use whatever `account_code` the existing `setupAccountMock` returns for `acc-crypto` — match the fixture.)

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

Expected: 1 fail with "One-sided OUT deal (no IN side) is not supported".

- [ ] **Step 3: Modify adapter**

In `src/lib/newLedgerAdapter.js` find the throw at line ~129:

```js
if (inLegs.length === 0) {
  throw new Error(
    "One-sided OUT deal (no IN side) is not supported in new ledger as a deal. " +
    ...
  );
}
```

Replace the throw with:

```js
if (inLegs.length === 0) {
  // One-sided OUT — route via withdrawal RPC. Caller checks `kind` and dispatches.
  return {
    kind: "withdrawal",
    officeId,
    clientId: legacy.clientId || null,
    clientNickname: legacy.clientNickname || null,
    outLegs: outLegs,
    note: legacy.comment || null,
  };
}
```

(Note: the `outLegs` variable doesn't yet exist at this point in the function — the throw happens BEFORE OUT processing. Move the OUT-side processing block ABOVE this guard, OR build a minimal outLegs here from `legacy.outputs` directly. Inspect the file structure and pick the cleanest approach.)

- [ ] **Step 4: Modify caller in dealOperations.js**

Find `createDeal` in `src/lib/dealOperations.js`. After `adaptLegacyDealPayload`, branch on `kind`:

```js
const v2payload = await adaptLegacyDealPayload(payload);

if (v2payload.kind === "withdrawal") {
  return await rpcCreateWithdrawalV2(v2payload);
}
// else fall through to existing rpcCreateDealV2 path
const result = await rpcCreateDealV2(v2payload);
```

Add the `rpcCreateWithdrawalV2` import at top of file.

- [ ] **Step 5: Run, expect PASS**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

Expected: 1 new test passes.

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "feat(adapter): route one-sided OUT to rpcCreateWithdrawalV2"
git push
```

### Task 1.5: Adapter — one-sided IN routes via topup RPC

**Files:**
- Modify: `src/lib/newLedgerAdapter.js`
- Modify: `src/lib/dealOperations.js`
- Modify: `src/lib/__integration__/adapter-prod-shape.test.js`

Symmetric to Task 1.4 but for the `outLegs.length === 0` path (line ~172).

- [ ] **Step 1: Failing test**

Append to `src/lib/__integration__/adapter-prod-shape.test.js`:

```js
describe("adapter — one-sided IN", () => {
  it("returns a topup payload with kind='topup' (no outLegs)", async () => {
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USD",
      amountIn: 1000,
      inAccountId: "acc-cash-usd",
      deferredIn: false,
      outLegs: [],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.kind).toBe("topup");
    expect(result.outLegs).toBeUndefined();
    expect(result.inLegs).toHaveLength(1);
    expect(result.inLegs[0].account_code).toBe("1011");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

Expected: 1 fail with "One-sided IN deal (no OUT side) is not supported".

- [ ] **Step 3: Modify adapter**

Find the throw at line ~172:

```js
if (outLegs.length === 0) {
  throw new Error(
    "One-sided IN deal (no OUT side) is not supported in new ledger as a deal. " +
    ...
  );
}
```

Replace with:

```js
if (outLegs.length === 0) {
  // One-sided IN — route via topup RPC.
  return {
    kind: "topup",
    officeId,
    clientId: legacy.clientId || null,
    clientNickname: legacy.clientNickname || null,
    inLegs: inLegs,
    note: legacy.comment || null,
  };
}
```

- [ ] **Step 4: Modify caller**

In `src/lib/dealOperations.js` `createDeal`, extend the kind-branch:

```js
if (v2payload.kind === "withdrawal") {
  return await rpcCreateWithdrawalV2(v2payload);
}
if (v2payload.kind === "topup") {
  return await rpcCreateTopupV2(v2payload);
}
// fall through to rpcCreateDealV2
```

Add `rpcCreateTopupV2` import.

- [ ] **Step 5: Run, expect PASS**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "feat(adapter): route one-sided IN to rpcCreateTopupV2"
git push
```

### Task 1.6: Adapter — partner-account IN side

**Files:**
- Modify: `src/lib/newLedgerAdapter.js`
- Modify: `src/lib/__integration__/adapter-prod-shape.test.js`

Currently the adapter throws "Partner accounts in IN side are not supported". Fix: when `inPartnerAccountId` is set, look up `partner_accounts.ledger_account_code` and use it as the IN leg's `account_code`.

- [ ] **Step 1: Failing test**

Append to test file:

```js
describe("adapter — partner-account IN", () => {
  it("resolves partner account_code for IN leg", async () => {
    // Mock supabase to return a partner_account row with ledger_account_code
    setupPartnerAccountMock({
      "partner-acc-1": { ledger_account_code: "2210", currency_code: "USDT", name: "Sherif USDT" },
    });
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USDT",
      amountIn: 1000,
      inPartnerAccountId: "partner-acc-1",
      deferredIn: false,
      outLegs: [{ currency: "USD", amount: 990, rate: 0.99, accountId: "acc-cash-usd" }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.inLegs[0].account_code).toBe("2210");
  });

  it("throws structured error when partner account has no ledger_account_code", async () => {
    setupPartnerAccountMock({
      "partner-acc-2": { ledger_account_code: null, currency_code: "USDT", name: "Mehmet USDT" },
    });
    await expect(
      adaptLegacyDealPayload({
        officeId: "office-mark",
        currencyIn: "USDT",
        amountIn: 1000,
        inPartnerAccountId: "partner-acc-2",
        outLegs: [{ currency: "USD", amount: 990, rate: 0.99, accountId: "acc-cash-usd" }],
      })
    ).rejects.toThrow(/Mehmet USDT.*ledger.*Settings/i);
  });
});
```

You'll need to add a `setupPartnerAccountMock` helper to the test file's `vi.mock("../supabase.js", ...)` block — it should return partner_accounts rows from the supplied map when the query is for `from('partner_accounts').select('ledger_account_code,...').eq('id', X).single()`.

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

Expected: 2 new fails.

- [ ] **Step 3: Implement partner lookup helper**

In `src/lib/newLedgerAdapter.js`, near the existing `resolveAccountCode` helper, add:

```js
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
```

- [ ] **Step 4: Replace the IN-partner throw**

Find the throw at line ~95:

```js
} else if (legacy.inPartnerAccountId) {
  throw new Error("Partner accounts in IN side are not supported in new ledger yet.");
}
```

Replace with:

```js
} else if (legacy.inPartnerAccountId) {
  const code = await resolvePartnerAccountCode(legacy.inPartnerAccountId);
  inLegs.push({
    currency: legacy.currencyIn.toUpperCase(),
    amount: Number(legacy.amountIn),
    account_code: code,
    source: "fresh",
  });
}
```

- [ ] **Step 5: Run, expect PASS**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "feat(adapter): partner-account IN — resolve ledger_account_code via lookup"
git push
```

### Task 1.7: Adapter — partner-account OUT side

**Files:**
- Modify: `src/lib/newLedgerAdapter.js`
- Modify: `src/lib/__integration__/adapter-prod-shape.test.js`

Symmetric to 1.6 but for the OUT leg loop.

- [ ] **Step 1: Failing test**

Append:

```js
describe("adapter — partner-account OUT", () => {
  it("resolves partner account_code for OUT leg", async () => {
    setupPartnerAccountMock({
      "partner-acc-3": { ledger_account_code: "2210", currency_code: "USDT", name: "Sherif USDT" },
    });
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USD",
      amountIn: 1000,
      inAccountId: "acc-cash-usd",
      deferredIn: false,
      outLegs: [{
        currency: "USDT", amount: 990, rate: 1.01,
        partnerAccountId: "partner-acc-3",
      }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.outLegs[0].account_code).toBe("2210");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

- [ ] **Step 3: Replace the OUT-partner throw**

Find the throw at line ~142:

```js
} else if (o.partnerAccountId) {
  throw new Error("Partner accounts in OUT side are not supported in new ledger yet.");
}
```

Replace with:

```js
} else if (o.partnerAccountId) {
  const code = await resolvePartnerAccountCode(o.partnerAccountId);
  outLegs.push({
    currency: o.currency.toUpperCase(),
    amount: Number(o.amount),
    account_code: code,
    rate: Number(o.rate),
    deferred: false,
  });
  continue;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(adapter): partner-account OUT — resolve ledger_account_code"
git push
```

### Task 1.8: Adapter — multi-currency partner inPayments

**Files:**
- Modify: `src/lib/newLedgerAdapter.js`
- Modify: `src/lib/__integration__/adapter-prod-shape.test.js`

The `inPayments[]` loop currently throws on partner refs (line ~120).

- [ ] **Step 1: Failing test**

Append:

```js
describe("adapter — partner inPayments entry", () => {
  it("resolves partner account_code in multi-currency inPayments", async () => {
    setupPartnerAccountMock({
      "partner-acc-4": { ledger_account_code: "2210", currency_code: "USDT", name: "Sherif USDT" },
    });
    setupAccountMock({
      "acc-cash-usd": { ledger_account_code: "1011", legacy_only: false, name: "Cash USD" },
    });
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: null, // multi-currency
      amountIn: null,
      deferredIn: false,
      inPayments: [
        { currency: "USD", amount: 500, accountId: "acc-cash-usd" },
        { currency: "USDT", amount: 100, partnerAccountId: "partner-acc-4" },
      ],
      outLegs: [{ currency: "USDT", amount: 590, rate: 1, accountId: "acc-crypto" }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.inLegs).toHaveLength(2);
    expect(result.inLegs[1].account_code).toBe("2210");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

- [ ] **Step 3: Replace inPayments-partner throw**

Find the throw at line ~120:

```js
} else if (p.partnerAccountId) {
  throw new Error("Partner accounts in inPayments are not supported in new ledger yet.");
}
```

Replace with:

```js
} else if (p.partnerAccountId) {
  leg.account_code = await resolvePartnerAccountCode(p.partnerAccountId);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/__integration__/adapter-prod-shape.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(adapter): partner inPayments — resolve ledger_account_code"
git push
```

### Task 1.9: buildTx — extract `validate(payload)` pure function

**Files:**
- Modify: `src/lib/dealForm/buildTx.js`
- Create: `src/lib/dealForm/validateTx.js`
- Create: `src/lib/dealForm/validateTx.test.js`

Today `buildTx` throws strings on invalid input. Extract a pure `validate(payload)` that returns `{ ok: boolean, errors: [{ legId, field, code, message }] }`. `buildTx` then becomes "validate first → if !ok throw". UI uses `validate` directly to disable Submit and red-highlight.

- [ ] **Step 1: Failing tests for `validate`**

Write `src/lib/dealForm/validateTx.test.js`:

```js
import { describe, it, expect } from "vitest";
import { validateTx } from "./validateTx.js";

describe("validateTx", () => {
  it("returns ok=true for a complete 1-IN + 1-OUT payload", () => {
    const payload = {
      officeId: "office-1",
      legs: [
        { id: "in_1", side: "in", currency: "USD", amount: "1000", source: "fresh", accountId: "acc-1" },
        { id: "out_1", side: "out", currency: "USDT", amount: "990", destination: "physical", deferred: false, accountId: "acc-2", rate: "1.01" },
      ],
    };
    const r = validateTx(payload);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags missing accountId on fresh IN leg", () => {
    const payload = {
      officeId: "office-1",
      legs: [
        { id: "in_2_xyz", side: "in", currency: "USD", amount: "1000", source: "fresh" }, // no accountId
        { id: "out_1", side: "out", currency: "USDT", amount: "990", destination: "physical", deferred: false, accountId: "acc-2", rate: "1.01" },
      ],
    };
    const r = validateTx(payload);
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({
      legId: "in_2_xyz",
      side: "in",
      field: "accountId",
      code: "fresh_requires_accountId",
      message: "Выбери счёт зачисления",
    });
  });

  it("flags non-positive amount", () => {
    const payload = {
      officeId: "office-1",
      legs: [{ id: "in_1", side: "in", currency: "USD", amount: "0", source: "fresh", accountId: "acc-1" }],
    };
    const r = validateTx(payload);
    expect(r.errors.find((e) => e.code === "amount_must_be_positive")).toBeDefined();
  });

  it("flags missing currency", () => {
    const payload = {
      officeId: "office-1",
      legs: [{ id: "in_1", side: "in", amount: "100", source: "fresh", accountId: "acc-1" }],
    };
    expect(validateTx(payload).errors.find((e) => e.code === "currency_required")).toBeDefined();
  });

  it("flags missing officeId", () => {
    const payload = { legs: [] };
    expect(validateTx(payload).errors.find((e) => e.code === "office_required")).toBeDefined();
  });

  it("flags physical OUT leg without accountId (incl. deferred)", () => {
    const payload = {
      officeId: "office-1",
      legs: [
        { id: "in_1", side: "in", currency: "USD", amount: "100", source: "fresh", accountId: "acc-1" },
        { id: "out_1", side: "out", currency: "USDT", amount: "100", destination: "physical", deferred: true, rate: "1" },
      ],
    };
    expect(validateTx(payload).errors.find((e) => e.code === "physical_requires_accountId")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/dealForm/validateTx.test.js
```

Expected: 6 fails — `validateTx` not defined.

- [ ] **Step 3: Implement validateTx**

Write `src/lib/dealForm/validateTx.js`:

```js
// src/lib/dealForm/validateTx.js
// Pure validation for the unified legs[] payload before buildTx maps it
// to v2 RPC shape. Returns { ok, errors } so the UI can disable Submit
// and highlight individual fields rather than discovering errors via
// throw on submit.

export function validateTx(payload) {
  const errors = [];
  if (!payload || !payload.officeId) {
    errors.push({ field: "officeId", code: "office_required", message: "Выбери офис" });
  }
  const legs = (payload && payload.legs) || [];
  for (const leg of legs) {
    const amt = Number(leg.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      errors.push({ legId: leg.id, side: leg.side, field: "amount", code: "amount_must_be_positive", message: "Сумма > 0" });
    }
    if (!leg.currency || String(leg.currency).length < 2) {
      errors.push({ legId: leg.id, side: leg.side, field: "currency", code: "currency_required", message: "Укажи валюту" });
    }
    if (leg.side === "in") {
      const source = leg.source === "from_balance" ? "from_balance" : "fresh";
      if (source === "fresh" && !leg.accountId) {
        errors.push({ legId: leg.id, side: "in", field: "accountId", code: "fresh_requires_accountId", message: "Выбери счёт зачисления" });
      }
    } else if (leg.side === "out") {
      const destination = leg.destination === "to_balance" ? "to_balance" : "physical";
      if (destination === "to_balance" && leg.deferred) {
        errors.push({ legId: leg.id, side: "out", field: "deferred", code: "to_balance_cannot_be_deferred", message: "to_balance не может быть deferred" });
      }
      if (destination === "physical" && !leg.accountId) {
        errors.push({ legId: leg.id, side: "out", field: "accountId", code: "physical_requires_accountId", message: "Выбери счёт списания" });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/dealForm/validateTx.test.js
```

Expected: 6 pass.

- [ ] **Step 5: buildTx delegates to validateTx**

In `src/lib/dealForm/buildTx.js`, before any per-leg work, add:

```js
import { validateTx } from "./validateTx.js";

// ... near top of buildTx:
const { ok, errors } = validateTx({ officeId, legs });
if (!ok) {
  const first = errors[0];
  throw new Error(`${first.side ? first.side.toUpperCase() + " leg " + (first.legId || "?") + ": " : ""}${first.message} (${first.code})`);
}
// ... existing buildTx body proceeds
```

This preserves the throw-on-submit behavior as a defense layer; the UI will catch errors before this point so the throw becomes unreachable.

- [ ] **Step 6: Run buildTx tests, expect still PASS**

```bash
npm run test -- src/lib/dealForm/buildTx.test.js
```

Expected: existing buildTx tests still pass (validateTx replicates their checks).

- [ ] **Step 7: Commit + push**

```bash
git add -A
git commit -m "feat(dealForm): extract validateTx pure function"
git push
```

### Task 1.10: DealLegsTable — render per-leg field errors

**Files:**
- Modify: `src/components/cashier/DealLegsTable.jsx`
- Modify: `src/components/cashier/DealForm.jsx`

The form computes `validateTx(...).errors` once per render and threads `errorsByLeg` to the table. Each leg row consumes its slice and red-highlights the failing field.

- [ ] **Step 1: Read DealForm and DealLegsTable**

```bash
grep -nE "DealLegsTable|legs\.map|onLegChange" src/components/cashier/DealForm.jsx src/components/cashier/DealLegsTable.jsx | head -20
```

Identify where DealForm computes the payload and where DealLegsTable renders rows.

- [ ] **Step 2: Compute errors in DealForm**

In `src/components/cashier/DealForm.jsx`, near the existing `buildTx({...})` call (around line 200), add:

```jsx
import { validateTx } from "../../lib/dealForm/validateTx.js";

// ... inside the component, after legs/conditions state is read:
const validation = useMemo(
  () => validateTx({ officeId: currentOffice, legs }),
  [currentOffice, legs]
);
const errorsByLeg = useMemo(() => {
  const m = new Map();
  for (const e of validation.errors) {
    if (!e.legId) continue;
    const arr = m.get(e.legId) || [];
    arr.push(e);
    m.set(e.legId, arr);
  }
  return m;
}, [validation]);
```

Pass `errorsByLeg` and `validation` into `<DealLegsTable />` and `<SubmitCTA />`.

- [ ] **Step 3: Wire errors into DealLegsTable**

In `src/components/cashier/DealLegsTable.jsx`, accept the new prop and pass slice per row:

```jsx
export default function DealLegsTable({ legs, errorsByLeg, ...rest }) {
  return (
    <table>
      ...
      <tbody>
        {legs.map((leg) => {
          const legErrors = errorsByLeg?.get(leg.id) || [];
          return <LegRow key={leg.id} leg={leg} errors={legErrors} ... />;
        })}
      </tbody>
    </table>
  );
}
```

In `<LegRow>` (or wherever fields are rendered per leg), apply red-ring to the field with a matching error:

```jsx
function fieldClass(base, hasError) {
  return hasError
    ? `${base} ring-2 ring-rose-400 border-rose-400`
    : base;
}

const accountErr = errors.find((e) => e.field === "accountId");
// ... when rendering the account select:
<select
  className={fieldClass("rounded px-2 py-1 ...", !!accountErr)}
  title={accountErr?.message}
  ...
/>
```

Repeat for `amount`, `currency`, `deferred`.

- [ ] **Step 4: Build + visual smoke**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(dealForm): per-leg field error highlighting via validateTx"
git push
```

### Task 1.11: SubmitCTA — disable on validation errors

**Files:**
- Modify: `src/components/cashier/SubmitCTA.jsx`
- Modify: `src/components/cashier/DealForm.jsx` (already passes validation from Task 1.10)

- [ ] **Step 1: Read SubmitCTA**

```bash
cat src/components/cashier/SubmitCTA.jsx
```

Identify the existing `disabled` prop.

- [ ] **Step 2: Accept validation prop**

In `src/components/cashier/SubmitCTA.jsx`, accept `validation` and `errorCount`:

```jsx
export default function SubmitCTA({ submitting, validation, ...rest }) {
  const errorCount = validation?.errors?.length || 0;
  const disabled = submitting || errorCount > 0;
  const tooltip = errorCount > 0
    ? `${errorCount} ошибк(а/и) в форме — исправь чтобы отправить`
    : undefined;
  return (
    <button
      disabled={disabled}
      title={tooltip}
      ...
    >
      {errorCount > 0 ? `Исправь ${errorCount} ошибк(у/и)` : "Создать сделку"}
    </button>
  );
}
```

- [ ] **Step 3: DealForm passes validation prop**

In `src/components/cashier/DealForm.jsx`, where SubmitCTA is rendered:

```jsx
<SubmitCTA submitting={submitting} validation={validation} ... />
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Existing SubmitCTA test**

```bash
npm run test -- src/components/cashier/SubmitCTA.test.jsx
```

Expected: still passes (the test that checks disabled-on-invalid was previously flaky — verify it still satisfies the contract; if it inspects a different prop name, update either the test or the new prop name to match).

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "feat(dealForm): SubmitCTA disabled while validateTx errors > 0"
git push
```

### Task 1.12: dealOperations — `updateDeal` v2 wrapper

**Files:**
- Modify: `src/lib/dealOperations.js`
- Modify: `src/lib/dealOperations.test.js`

Replace the `guardLegacyOnly` for `updateDeal` with a real call to `rpcUpdateDealV2`.

- [ ] **Step 1: Update test expectation**

In `src/lib/dealOperations.test.js`, change the existing `updateDeal throws` test:

```js
it("updateDeal calls rpcUpdateDealV2 when USE_NEW_LEDGER=true", async () => {
  stubV2On();
  const updateDealSpy = vi.fn().mockResolvedValue({ tx_id: "ledger-tx-1" });
  vi.doMock("./newLedger.js", async () => {
    const actual = await vi.importActual("./newLedger.js");
    return { ...actual, USE_NEW_LEDGER: true, rpcUpdateDealV2: updateDealSpy };
  });
  const { updateDeal } = await import("./dealOperations.js");
  const result = await updateDeal({ id: "deal-1", patch: { note: "x" } });
  expect(updateDealSpy).toHaveBeenCalledOnce();
  expect(result).toEqual({ tx_id: "ledger-tx-1" });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/dealOperations.test.js
```

- [ ] **Step 3: Implement wrapper**

In `src/lib/dealOperations.js`, replace the `updateDeal` `guardLegacyOnly` line with:

```js
export async function updateDeal(payload) {
  if (!USE_NEW_LEDGER) return await rpcUpdateDeal(payload);
  // v2: payload shape mirrors legacy enough that rpcUpdateDealV2 accepts it directly.
  return await rpcUpdateDealV2(payload);
}
```

Add `rpcUpdateDealV2` import.

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/dealOperations.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(dealOperations): updateDeal v2 wrapper"
git push
```

### Task 1.13: dealOperations — `deleteDeal` v2 wrapper (reverse_transaction)

**Files:**
- Modify: `src/lib/dealOperations.js`
- Modify: `src/lib/dealOperations.test.js`

Accounting principle: you don't delete posted transactions; you reverse them with a compensating entry. Wrapper calls `rpcReverseTransactionV2`.

- [ ] **Step 1: Update test**

Replace the existing `deleteDeal throws` test:

```js
it("deleteDeal calls rpcReverseTransactionV2 when USE_NEW_LEDGER=true", async () => {
  stubV2On();
  const reverseSpy = vi.fn().mockResolvedValue({ reversal_tx_id: "rev-1" });
  vi.doMock("./newLedger.js", async () => {
    const actual = await vi.importActual("./newLedger.js");
    return { ...actual, USE_NEW_LEDGER: true, rpcReverseTransactionV2: reverseSpy };
  });
  const { deleteDeal } = await import("./dealOperations.js");
  await deleteDeal("deal-uuid", "manual");
  expect(reverseSpy).toHaveBeenCalledWith(expect.objectContaining({
    targetTxId: "deal-uuid",
    reason: expect.stringContaining("delete"),
  }));
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/dealOperations.test.js
```

- [ ] **Step 3: Implement**

```js
export async function deleteDeal(dealId, reason = "manual") {
  if (!USE_NEW_LEDGER) return await rpcDeleteDeal(dealId, reason);
  return await rpcReverseTransactionV2({
    targetTxId: dealId,
    reason: `deleteDeal: ${reason}`,
    cascade: true,
  });
}
```

Add `rpcReverseTransactionV2` import.

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/dealOperations.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(dealOperations): deleteDeal v2 wrapper via reverse_transaction"
git push
```

### Task 1.14: dealOperations — remaining 8 wrappers

**Files:**
- Modify: `src/lib/dealOperations.js`
- Modify: `src/lib/dealOperations.test.js`

Group together (same pattern: replace `guardLegacyOnly` with v2 RPC call). Each maintains a legacy fallback (`if (!USE_NEW_LEDGER) return await rpc<Legacy>(payload)`).

- [ ] **Step 1: Replace all 8 guards in dealOperations.js**

Add imports at top:

```js
import {
  rpcCompleteDealLegV2,
  rpcReverseTransactionV2,        // already imported in 1.13
  rpcCreateAdjustmentV2,          // already imported
  rpcUpdateDealV2,                // already imported in 1.12
  rpcCreateTopupV2,               // already imported in 1.5
  rpcCreateWithdrawalV2,          // already imported in 1.4
} from "./newLedger.js";
```

Replace the 8 `guardLegacyOnly` wrappers with these implementations:

```js
export async function completeDeal(dealId) {
  if (!USE_NEW_LEDGER) return await rpcCompleteDeal(dealId);
  // v2: complete each deferred leg of this deal in turn.
  // Caller-side leg list is fetched from public.deal_legs; for now we
  // pass the dealId and rely on backend `complete_deal_leg` to iterate.
  return await rpcCompleteDealLegV2({ dealTxId: dealId });
}

export async function deleteTransfer(transferId) {
  if (!USE_NEW_LEDGER) return await rpcDeleteTransfer(transferId);
  return await rpcReverseTransactionV2({
    targetTxId: transferId,
    reason: "deleteTransfer",
    cascade: true,
  });
}

export async function settleObligation(obligationId, accountId, amount) {
  if (!USE_NEW_LEDGER) return await rpcSettleObligation(obligationId, accountId, amount);
  // v2: settle = complete the deferred leg associated with the obligation.
  return await rpcCompleteDealLegV2({
    obligationId,
    paymentAccountId: accountId,
    amount,
  });
}

export async function settleObligationPartial(obligationId, accountId, amount) {
  if (!USE_NEW_LEDGER) return await rpcSettleObligationPartial(obligationId, accountId, amount);
  return await rpcCompleteDealLegV2({
    obligationId,
    paymentAccountId: accountId,
    amount,
    partial: true,
  });
}

export async function receivePayment(obligationId, accountId, amount) {
  if (!USE_NEW_LEDGER) return await rpcReceivePayment(obligationId, accountId, amount);
  return await rpcCreateAdjustmentV2({
    kind: "receive_payment",
    obligationId,
    accountId,
    amount,
  });
}

export async function cancelObligation(obligationId) {
  if (!USE_NEW_LEDGER) return await rpcCancelObligation(obligationId);
  return await rpcReverseTransactionV2({
    targetObligationId: obligationId,
    reason: "cancelObligation",
  });
}

export async function recordPartnerInflow(payload) {
  if (!USE_NEW_LEDGER) return await rpcRecordPartnerInflow(payload);
  return await rpcCreateAdjustmentV2({
    kind: "partner_inflow",
    partnerAccountId: payload.partnerAccountId,
    amount: payload.amount,
    currency: payload.currency,
    note: payload.note || null,
  });
}

export async function recordPartnerOutflow(payload) {
  if (!USE_NEW_LEDGER) return await rpcRecordPartnerOutflow(payload);
  return await rpcCreateAdjustmentV2({
    kind: "partner_outflow",
    partnerAccountId: payload.partnerAccountId,
    amount: payload.amount,
    currency: payload.currency,
    fromAccountId: payload.fromAccountId,
    note: payload.note || null,
  });
}
```

Remove the `function guardLegacyOnly(...)` helper definition entirely.

- [ ] **Step 2: Update existing tests**

In `src/lib/dealOperations.test.js`, replace each of the 6 existing "throws" tests with "calls correct v2 RPC". Pattern:

```js
it("completeDeal calls rpcCompleteDealLegV2 when USE_NEW_LEDGER=true", async () => {
  stubV2On();
  const spy = vi.fn().mockResolvedValue({ ok: true });
  vi.doMock("./newLedger.js", async () => {
    const actual = await vi.importActual("./newLedger.js");
    return { ...actual, USE_NEW_LEDGER: true, rpcCompleteDealLegV2: spy };
  });
  const { completeDeal } = await import("./dealOperations.js");
  await completeDeal("deal-1");
  expect(spy).toHaveBeenCalledOnce();
});
```

(Repeat for `deleteTransfer`, `settleObligation`, `settleObligationPartial`, `receivePayment`, `cancelObligation`, `recordPartnerInflow`, `recordPartnerOutflow`.)

- [ ] **Step 3: Run all dealOperations tests**

```bash
npm run test -- src/lib/dealOperations.test.js
```

Expected: all wrapper tests pass.

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "feat(dealOperations): 8 v2 wrappers (completeDeal, settle*, receive, cancel, partner-IO)"
git push
```

### Task 1.15: Lift UI gates added by PR #18

**Files:**
- Modify: `src/components/DeleteDealButton.jsx`
- Modify: `src/components/DeleteTransferButton.jsx`
- Modify: `src/components/EditTransactionModal.jsx`
- Modify: `src/components/ObligationsModal.jsx`
- Modify: `src/components/settings/PartnerSettlementModal.jsx`
- Modify: `src/components/TransactionsTable.jsx`

PR #18 added `disabled={USE_NEW_LEDGER}` and amber banners to disable these buttons. Now that the wrappers work, lift the gates.

- [ ] **Step 1: Find current gates**

```bash
grep -nE "USE_NEW_LEDGER" src/components/DeleteDealButton.jsx src/components/DeleteTransferButton.jsx src/components/EditTransactionModal.jsx src/components/ObligationsModal.jsx src/components/settings/PartnerSettlementModal.jsx src/components/TransactionsTable.jsx
```

- [ ] **Step 2: Remove `USE_NEW_LEDGER` from `disabled` and `title` props**

For each file, restore the original disabled/title logic. Examples:

In `src/components/DeleteDealButton.jsx`, change:

```jsx
disabled={busy || USE_NEW_LEDGER}
title={
  USE_NEW_LEDGER
    ? "Удаление отключено в режиме v2 ledger — wait for v2 deleteDeal support"
    : confirm
    ? "Подтвердить удаление"
    : "Удалить сделку (откатит баланс)"
}
```

back to:

```jsx
disabled={busy}
title={confirm ? "Подтвердить удаление" : "Удалить сделку (откатит баланс)"}
```

Remove the unused `USE_NEW_LEDGER` import from each file.

- [ ] **Step 3: Remove banners from modals**

In `EditTransactionModal.jsx`, `ObligationsModal.jsx`, `PartnerSettlementModal.jsx` — find the `{USE_NEW_LEDGER && (<div ...>...</div>)}` block and delete.

- [ ] **Step 4: Build + lib tests**

```bash
npm run build
npx vitest run --no-file-parallelism src/lib
```

Expected: build clean; lib tests pass.

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(ui): lift v2 disabled gates now that wrappers work"
git push
```

### Task 1.16: Phase 1 integration smoke

**Files:** none (verify only)

- [ ] **Step 1: Full test suite (serial workers)**

```bash
npx vitest run --no-file-parallelism
```

Expected: all green; new test count ~166 + ~20 new = ~186 passing.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Local smoke with v2 enabled**

Open `.env.local` and set:

```
VITE_USE_NEW_LEDGER=true
VITE_FORCE_V2=true
```

Then `npm run dev`. Open `http://localhost:5173`.

Test the following flows in the browser console — for each, the form should submit successfully OR show inline validation errors (no white-screen, no thrown stack):

1. Create a normal 2-sided exchange deal: 1 IN cash USD + 1 OUT crypto USDT.
2. Create a one-sided OUT (withdrawal) deal: 0 IN, 1 OUT.
3. Create a deal with a partner-account on the IN side (using a partner that has `ledger_account_code` set).
4. Try to create a deal with a partner-account that has NO `ledger_account_code` — expect a clear toast: "Счёт партнёра X не маппится на ledger".
5. Try to submit with an empty leg — expect Submit button disabled, red field highlight.

Each should behave as expected. Restore `.env.local` to `=false` for both flags after smoke.

- [ ] **Step 4: Open PR for Phase 1**

```bash
gh pr create --base main --title "feat(v2): Phase 1 — frontend coverage gaps for v2 ledger" --body "$(cat <<'EOF'
## Summary
Restores 100% real-world cashier flow coverage when USE_NEW_LEDGER is enabled. After this lands, flipping the flag in production no longer breaks any deal shape.

- Adapter: one-sided OUT routes via rpcCreateWithdrawalV2; one-sided IN via rpcCreateTopupV2; partner accounts in IN/OUT/inPayments resolve via partner_accounts.ledger_account_code lookup.
- Schema: partner_accounts.accounting_code → ledger_account_code rename; 8 unmapped public.accounts backfilled.
- DealForm v2: validateTx pure function; per-field red highlights; Submit disabled while errors > 0.
- 10 v2 wrappers in dealOperations.js (updateDeal, deleteDeal, completeDeal, deleteTransfer, settleObligation, settleObligationPartial, receivePayment, cancelObligation, recordPartnerInflow, recordPartnerOutflow). guardLegacyOnly removed; UI gates from PR #18 lifted.

## Test plan
- [x] Full test suite passes (~186 tests).
- [x] Local smoke with both env vars true: normal/one-sided/partner deals OK; missing-mapping shows clear error; Submit gating works.
- [ ] Production flag stays OFF until Phase 3 (this PR is safe to merge).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the PR URL.

---

## Phase 2 — Backfill 13 opening journal_entries

Outcome: `cron_reconcile_balances` returns 0 mismatches; the temporary `reconcile_paused_until` pause is removed; runbook updated.

### Task 2.1: Inventory the 13 mismatch rows

**Files:** none (read-only SQL via MCP)

- [ ] **Step 1: List the rows**

Via `mcp__supabase__execute_sql`:

```sql
SELECT account_code, account_name, balance_amount, je_amount, diff
FROM ledger.v_balance_check
WHERE ABS(diff) > 0.00000001
ORDER BY account_code;
```

Expected: 13 rows. Each shows the account code (e.g. `1011`), the `ledger.balances.amount` value, the (currently zero or missing) `journal_entries`-derived value, and the diff.

- [ ] **Step 2: Inventory the equity-side counter-account**

```sql
SELECT code, name, type
FROM ledger.accounts
WHERE type = 'equity' AND name ILIKE '%opening%'
ORDER BY code;
```

Identify the row that represents "opening capital" (likely code `30.10` or similar). This is the Cr counter-account for every backfill entry.

- [ ] **Step 3: Note the inventory date**

```sql
SELECT MAX(updated_at) FROM ledger.balances;
```

This timestamp becomes `effective_date` for the synthetic opening transactions.

(No commit; data only.)

### Task 2.2: Apply backfill migration

**Files:**
- Migration via `mcp__supabase__apply_migration` name `ledger_backfill_13_opening_je_2026_05_10`

- [ ] **Step 1: Use `create_opening_from_inventory`**

The function exists. It accepts an inventory list and emits paired Dr/Cr journal_entries.

Build the inventory list from Task 2.1 results. Migration body:

```sql
-- Single transaction; if any row fails, none persist.
DO $$
DECLARE
  v_tx_id uuid;
BEGIN
  v_tx_id := ledger.create_opening_from_inventory(
    p_idempotency_key := gen_random_uuid(),
    p_request_hash := 'backfill_13_opening_je_2026_05_10',
    p_effective_date := '<DATE FROM TASK 2.1 STEP 3>',
    p_equity_account_code := '<CODE FROM TASK 2.1 STEP 2>',
    p_inventory := ARRAY[
      ROW('<CODE_1>', '<AMOUNT_1>')::ledger.opening_inventory_item,
      ROW('<CODE_2>', '<AMOUNT_2>')::ledger.opening_inventory_item,
      -- ... 13 rows from Task 2.1 Step 1
    ]
  );
  RAISE NOTICE 'Backfill tx: %', v_tx_id;
END
$$;
```

Note: the `ledger.opening_inventory_item` composite type signature may differ — inspect via `\dT ledger.opening_inventory_item` or `pg_type` lookup before composing the migration. If the function takes a JSONB instead, use that shape.

- [ ] **Step 2: Verify zero mismatches**

```sql
SELECT COUNT(*) FROM ledger.v_balance_check WHERE ABS(diff) > 0.00000001;
```

Expected: 0.

- [ ] **Step 3: Verify journal entries balance**

```sql
SELECT
  SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END) AS dr,
  SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END) AS cr
FROM ledger.journal_entries
WHERE transaction_id = '<v_tx_id from Step 1 RAISE NOTICE>';
```

Expected: Dr = Cr (in same currency per row group).

(No commit; migration recorded by MCP.)

### Task 2.3: Remove the temporary cron pause

**Files:**
- Migration via `mcp__supabase__apply_migration` name `remove_reconcile_paused_until_2026_05_10`

- [ ] **Step 1: Apply removal**

```sql
DELETE FROM ledger.config WHERE key = 'reconcile_paused_until';
```

The function `ledger.cron_reconcile_balances` already handles a missing key (early-return only triggers when the row exists AND `now() < paused_until`).

- [ ] **Step 2: Run the cron manually**

```sql
SELECT ledger.cron_reconcile_balances();
SELECT created_at, level, message
  FROM ledger.audit_alerts
 WHERE source = 'cron_reconcile_balances'
   AND created_at > now() - interval '5 minutes'
 ORDER BY created_at DESC;
```

Expected: zero rows in the post-`now() − 5min` window. (Backfill in Task 2.2 made `v_balance_check` clean, so the cron does nothing.)

(No commit.)

### Task 2.4: Update the runbook

**Files:**
- Modify: `docs/CUTOVER_RUNBOOK.md`

- [ ] **Step 1: Mark the temporary-pause section resolved**

Find the `## ⚠️ Temporary alert pause (2026-05-09 → 2026-05-23)` section. Replace with:

```markdown
## ✅ Resolved — temporary alert pause (closed 2026-05-10)

`ledger.cron_reconcile_balances` was paused 2026-05-09 to silence the "Detected 13 balance mismatches" noise while the orphan opening balances were investigated.

**Resolution (2026-05-10):** the 13 orphan rows were backfilled via `ledger.create_opening_from_inventory` in migration `ledger_backfill_13_opening_je_2026_05_10`. `v_balance_check` now returns 0 mismatches. `ledger.config.reconcile_paused_until` row removed (migration `remove_reconcile_paused_until_2026_05_10`). Cron is healthy again.
```

- [ ] **Step 2: Commit + push**

```bash
git add docs/CUTOVER_RUNBOOK.md
git commit -m "docs(runbook): close temp alert-pause section after Phase 2 backfill"
git push
```

### Task 2.5: Open PR for Phase 2

**Files:** none

- [ ] **Step 1: Open PR via gh**

```bash
gh pr create --base main --title "chore(v2): Phase 2 — backfill 13 opening journal entries + lift cron pause" --body "$(cat <<'EOF'
## Summary
- Migration ledger_backfill_13_opening_je_2026_05_10 emits paired Dr/Cr journal entries for the 13 orphan rows in ledger.balances via ledger.create_opening_from_inventory.
- Migration remove_reconcile_paused_until_2026_05_10 deletes ledger.config.reconcile_paused_until → cron_reconcile_balances runs healthy again.
- Runbook section marked resolved.

## Test plan
- [x] SELECT COUNT(*) FROM ledger.v_balance_check WHERE ABS(diff) > 0.00000001 returns 0.
- [x] SELECT ledger.cron_reconcile_balances() emits no new audit_alerts.
- [ ] After 1 hour: still no audit_alerts from this cron.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 3 — Cutover

Outcome: `VITE_FORCE_V2=true` in Vercel; cashiers create deals through v2; `public.deals` frozen; first real `ledger.transactions` row exists.

### Task 3.1: Pre-flight validation

**Files:** none (read-only SQL via MCP)

- [ ] **Step 1: C1 — pending deals**

```sql
SELECT COUNT(*) FROM public.deals WHERE status IN ('pending', 'checking');
```

Expected: 0. If > 0, STOP — resolve in legacy first.

- [ ] **Step 2: C2 — open obligations**

```sql
SELECT COUNT(*) FROM public.obligations
WHERE settled_at IS NULL AND COALESCE(canceled_at, NULL) IS NULL;
```

Expected: 0.

- [ ] **Step 3: C3 — in-flight transfers (if applicable)**

```sql
SELECT COUNT(*) FROM public.transfers WHERE status NOT IN ('completed', 'cancelled');
```

(If `public.transfers` lacks a `status` column, SKIP this check; transfers complete synchronously.)

If any C1-C3 returns > 0 → STOP and ask owner to resolve in legacy.

(No commit; verification only.)

### Task 3.2: Flip Vercel env + redeploy

**Files:** none (Vercel UI + verification SQL)

- [ ] **Step 1: Flip the flag**

In Vercel → coinplata project → Settings → Environment Variables → Production:

- Add `VITE_FORCE_V2 = true` (currently absent).
- Confirm `VITE_USE_NEW_LEDGER = true` is still present.

- [ ] **Step 2: Trigger redeploy**

In Vercel → Deployments → most-recent production → "..." → Redeploy. Choose "without build cache" so the new env value bakes in.

- [ ] **Step 3: Verify env in bundle**

After deploy completes (~2 min):

```bash
curl -s https://coinplata.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1
```

Note the bundle hash.

```bash
curl -s "https://coinplata.vercel.app/assets/<HASH>.js" | grep -oE "VITE_FORCE_V2|VITE_USE_NEW_LEDGER" | sort -u
```

Expected: both strings present (proves both env reads exist in compiled code).

(No commit.)

### Task 3.3: Freeze legacy tables

**Files:**
- Migration via `mcp__supabase__execute_sql` (idempotent function call, not a structural migration)

- [ ] **Step 1: Run freeze**

```sql
SELECT ledger.freeze_legacy_tables();
```

The function REVOKEs INSERT/UPDATE/DELETE on `public.{deals, deal_legs, deal_in_payments, deal_leg_payments, account_movements, partner_account_movements, obligations, transfers}` from app roles. Idempotent.

- [ ] **Step 2: Verify legacy is frozen**

```sql
-- Try to insert a probe row from authenticated role:
SET ROLE authenticated;
INSERT INTO public.deals (id, status, ...) VALUES (gen_random_uuid(), 'pending', ...);
RESET ROLE;
```

Expected: ERROR with permission denied. Reset role on error.

(Or simply check `pg_class` privileges — quicker:

```sql
SELECT relname, has_table_privilege('authenticated', 'public.' || relname, 'INSERT') AS can_insert
FROM pg_class
WHERE relname IN ('deals', 'account_movements', 'obligations');
```

Expected: all `can_insert = false`.)

(No commit.)

### Task 3.4: Smoke deal in production

**Files:** none (manual UI + verification SQL)

- [ ] **Step 1: Create one real test deal**

Owner opens `coinplata.vercel.app` → Кассир → "+ Сделка". Submit a small deal: e.g. **100 USD cash IN → 95 USDT TRC20 OUT**. Submit.

Expected: success toast, no console errors.

- [ ] **Step 2: Verify in `ledger.transactions`**

```sql
SELECT id, source_kind, status, created_at
FROM ledger.transactions
ORDER BY created_at DESC
LIMIT 3;
```

Expected: at least one row from the last 5 minutes with `source_kind = 'deal'` and `status IN ('posted', 'committed')` (whichever the schema uses).

- [ ] **Step 3: Verify journal_entries**

```sql
SELECT je.account_code, je.direction, je.amount, je.currency_code
FROM ledger.journal_entries je
WHERE je.transaction_id = '<id from Step 2>'
ORDER BY je.direction, je.account_code;
```

Expected: at least 4 rows (Dr cash 100 USD, Cr customer-Liab 100 USD, Dr customer-Liab 95 USDT-eq, Cr crypto 95 USDT — exact pattern depends on the chart-of-accounts mapping). Sum of Dr = sum of Cr per currency.

- [ ] **Step 4: Verify legacy stayed empty**

```sql
SELECT COUNT(*) FROM public.deals WHERE created_at > now() - interval '5 minutes';
```

Expected: 0 (the new deal went to v2, not legacy).

If anything in Steps 1-4 fails: rollback by setting `VITE_FORCE_V2=false` in Vercel and `GRANT INSERT, UPDATE, DELETE ON public.{deals, ...} TO authenticated, anon, service_role` (see `CUTOVER_RUNBOOK.md` rollback section).

### Task 3.5: Open PR for Phase 3 docs

**Files:**
- Modify: `docs/CUTOVER_RUNBOOK.md` (mark cutover complete)

- [ ] **Step 1: Update runbook**

In `docs/CUTOVER_RUNBOOK.md`, find the top section:

```markdown
**Дата cutover:** 2026-06-01 00:00 UTC (или сдвинутая по решению owner).
```

Replace with:

```markdown
**Cutover completed:** 2026-05-10 — v2 ledger active in Production. Legacy tables frozen via ledger.freeze_legacy_tables(). Smoke deal verified.
```

Add a new "Post-cutover monitoring" section:

```markdown
## Post-cutover monitoring (first 7 days)

- Daily: SELECT COUNT(*) FROM ledger.transactions WHERE created_at > now() - interval '24h'; — expect monotonically increasing.
- Daily: SELECT COUNT(*) FROM ledger.audit_alerts WHERE created_at > now() - interval '24h'; — expect 0 critical alerts.
- Weekly: SELECT COUNT(*) FROM ledger.v_balance_check WHERE ABS(diff) > 0.00000001; — expect 0.
- After 7 quiet days: open Spec B (Treasury & P&L on Journal Entries).
```

- [ ] **Step 2: Commit + push**

```bash
git add docs/CUTOVER_RUNBOOK.md
git commit -m "docs(runbook): mark cutover complete + post-cutover monitoring"
git push
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main --title "feat(v2): Phase 3 — production cutover (v2 ON, legacy frozen)" --body "$(cat <<'EOF'
## Summary
Cutover to v2 ledger in production:
- VITE_FORCE_V2=true set in Vercel; redeploy verified by bundle inspection.
- ledger.freeze_legacy_tables() executed → public.deals/etc. read-only.
- Smoke deal created in production: ledger.transactions row exists with paired journal_entries.
- Runbook updated; post-cutover monitoring section added.

## Test plan
- [x] Pre-flight: 0 pending deals, 0 open obligations, 0 in-flight transfers.
- [x] Bundle includes both VITE_FORCE_V2 and VITE_USE_NEW_LEDGER strings.
- [x] Smoke deal: ledger.transactions has the row; journal_entries balance Dr=Cr.
- [x] public.deals INSERT denied for authenticated role.
- [ ] First 24h: no critical audit_alerts. (Owner monitors.)

After this lands, Spec B (Treasury & P&L on Journal Entries) follows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Task 3.6: Hand off to Spec B

**Files:** none

- [ ] **Step 1: Confirm v2 has real data**

After Phase 3 PR merges and cashiers have used v2 for at least an hour:

```sql
SELECT COUNT(*), MAX(created_at) FROM ledger.transactions;
```

Expected: count > 1 (the smoke deal + at least one real cashier deal).

- [ ] **Step 2: Trigger Spec B brainstorming**

In a new session (or this one), invoke `superpowers:brainstorming` with the prompt:

> Treasury & P&L on Journal Entries — design balance-sheet view (Активы/Пассивы/Капитал as 3 tabs) and P&L statement on top of `ledger.journal_entries`. Now that v2 is live in production, real data is flowing. Replaces Treasury MVP shipped on 2026-05-09.

This is the terminal step of the v2 revival plan.

---

## Self-review checklist (run before declaring plan complete)

**Spec coverage:**
- ✅ Phase 1: DealForm UX inline validation → Tasks 1.9, 1.10, 1.11
- ✅ Phase 1: Adapter coverage of all shapes → Tasks 1.4, 1.5, 1.6, 1.7, 1.8
- ✅ Phase 1: 10 v2 wrappers → Tasks 1.12, 1.13, 1.14
- ✅ Phase 1: Schema rename + backfill → Tasks 1.1, 1.3
- ✅ Phase 1: PartnerAccountEditor field → Task 1.2
- ✅ Phase 1: UI gates lifted → Task 1.15
- ✅ Phase 2: Backfill 13 opening journal entries → Tasks 2.1-2.3
- ✅ Phase 2: Runbook updated → Task 2.4
- ✅ Phase 3: Pre-flight, env flip, freeze, smoke → Tasks 3.1-3.4
- ✅ Phase 3: Runbook closed + post-cutover monitoring → Task 3.5
- ✅ Hand off to Spec B → Task 3.6
- ⏸ Treasury redesign + P&L view → explicitly out of scope (Spec B post-Phase 3)

**Placeholder scan:**
- Two intentional `<CODE_*>` placeholders in Task 1.3 — engineer fills them after Step 1 inventory query (this is the standard "look up the data first, then write the SQL" pattern; not a plan failure since Step 1 produces the values).
- Task 2.2 has `<DATE FROM TASK 2.1 STEP 3>` and `<CODE FROM TASK 2.1 STEP 2>` — same pattern.
- No "TBD"/"TODO"/"add appropriate error handling" anywhere. Every code step has actual code.

**Type / signature consistency:**
- Adapter return shape: `{ kind: 'withdrawal' | 'topup' | undefined, ...legs }` — used consistently in Tasks 1.4, 1.5 and the dealOperations.createDeal switch.
- Wrapper signatures preserved (e.g., `deleteDeal(dealId, reason)` — 2nd arg keeps default `"manual"` matching legacy callers in TransactionsTable / DeleteDealButton).
- `validateTx` returns `{ ok, errors: [{ legId, side, field, code, message }] }` — used identically in Tasks 1.9, 1.10, 1.11.
- All v2 RPC names are `rpcXxxV2` per existing `newLedger.js` exports.

No issues found.
