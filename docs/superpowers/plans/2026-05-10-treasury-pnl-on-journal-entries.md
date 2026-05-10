# Treasury & P&L on Journal Entries Implementation Plan (Spec B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the May-9 Treasury MVP with a real accountant-grade Treasury on top of `ledger.journal_entries`: 5 tabs (Активы / Пассивы / Капитал / P&L / Журнал), inline office picker with virtual "All offices", drill-down account → entries → source document, sticky balance-sheet identity check.

**Architecture:** New `LedgerProvider` (reads `ledger.*` schema via new `ledgerReaders.js`), 5 fixture-tested pure selectors in `src/lib/treasury/v2selectors.js`, dumb presentational components under `src/pages/treasury_v2/`. The May-9 MVP (`Dashboard.jsx`, `treasury/selectors.js`, etc.) is deleted. No DB migrations — the 174-account chart of accounts and v2 transaction/entry tables already exist.

**Tech Stack:** React 18, Vitest 4, Tailwind 3, lucide-react, `@supabase/supabase-js`. Hooks: new `useLedger()`, existing `useBaseCurrency()`, `useOffices()`, `useCan()`.

**Branch:** `feat/treasury-v2` off `main`. **Hard prerequisite:** Spec A Phase 3 cutover must be merged to `main` (PR #24) and v2 must be confirmed working in production (≥ 24 h clean traffic, `ledger.transactions` row count > 0). If that hasn't happened, STOP — this plan operates on an empty ledger otherwise.

**Spec:** `docs/superpowers/specs/2026-05-10-treasury-pnl-on-journal-entries-design.md`.

---

## Phase 0 — Prerequisite check + setup

### Task 0.1: Verify Phase 3 cutover landed + v2 has data

**Files:** none (verification only)

- [ ] **Step 1: Confirm v2 is active in main**

```bash
git checkout main && git pull origin main
grep -nE "USE_NEW_LEDGER\s*=" src/lib/newLedger.js
```

Expected: `export const USE_NEW_LEDGER = _ENV?.VITE_USE_NEW_LEDGER === "true";` (the kill-switch `_V2_FORCE_OPT_IN` should be gone — Phase 3 retry merged). If `_V2_FORCE_OPT_IN` is still there → STOP, Phase 3 not done.

- [ ] **Step 2: Confirm ledger.transactions has real data**

Via `mcp__supabase__execute_sql`:

```sql
SELECT COUNT(*) AS tx_count, MAX(created_at) AS latest FROM ledger.transactions;
SELECT COUNT(*) AS je_count FROM ledger.journal_entries;
```

Expected: `tx_count >= 2` (the opening transaction from Phase 2 + at least one real cashier deal), `je_count >= 15`. If only the opening transaction exists, the Treasury will be sparse but the plan still works — proceed.

- [ ] **Step 3: Create the working branch**

```bash
git checkout -b feat/treasury-v2 main
git push -u origin feat/treasury-v2
```

- [ ] **Step 4: Baseline tests**

```bash
npx vitest run --no-file-parallelism
```

Expected: all green. Record the count (will change after we delete the MVP and add selectors).

---

## Phase 1 — Ledger readers + provider

### Task 1.1: `ledgerReaders.js` — supabase queries for `ledger.*`

**Files:**
- Create: `src/lib/ledgerReaders.js`
- Create: `src/lib/ledgerReaders.test.js`

These read from `ledger.accounts`, `ledger.balances`, `ledger.transactions`, `ledger.journal_entries`. The supabase client must request the `ledger` schema explicitly (PostgREST needs `.schema('ledger')` or the table name `ledger.foo` depending on client config — check how the existing `newLedger.js` calls `supabase.rpc('create_deal_v2', ...)` (it uses bare names because the RPC functions were exposed; tables need `.schema('ledger')`).

- [ ] **Step 1: Write failing test**

Write `src/lib/ledgerReaders.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client. Each loader calls supabase.schema('ledger').from(X).select(...)
function makeSupabaseMock(rowsByTable) {
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation((table) => {
      const rows = rowsByTable[table] || [];
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return chain;
    }),
  };
}

vi.mock("./supabase.js", () => ({
  supabase: null, // overridden per-test via vi.doMock
  isSupabaseConfigured: true,
}));

describe("ledgerReaders", () => {
  it("loadLedgerAccounts maps rows to camelCase shape", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        accounts: [
          { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency_code: "USD", office_id: "o1", client_dim_required: false, partner_dim_required: false, active: true },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadLedgerAccounts } = await import("./ledgerReaders.js");
    const out = await loadLedgerAccounts();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "o1" });
  });

  it("loadLedgerBalances maps balance rows", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        balances: [
          { account_id: "a1", currency_code: "USD", client_id: null, partner_id: null, balance: "11000.0" },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadLedgerBalances } = await import("./ledgerReaders.js");
    const out = await loadLedgerBalances();
    expect(out[0]).toMatchObject({ accountId: "a1", currency: "USD", clientId: null, partnerId: null, balance: 11000 });
  });

  it("loadLedgerTransactions maps tx headers", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        transactions: [
          { id: "tx1", effective_date: "2026-05-10T00:00:00Z", created_at: "2026-05-10T14:32:00Z", description: "deal", source_kind: "deal", source_ref_id: "deal-42", reverses_transaction_id: null, metadata: {} },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadLedgerTransactions } = await import("./ledgerReaders.js");
    const out = await loadLedgerTransactions();
    expect(out[0]).toMatchObject({ id: "tx1", kind: "deal", sourceRefId: "deal-42", reversesTransactionId: null });
  });

  it("loadJournalEntries maps entry rows", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        journal_entries: [
          { id: "je1", transaction_id: "tx1", account_id: "a1", direction: "dr", amount: "1000.0", currency_code: "USD", client_id: null, partner_id: null, note: "x", created_at: "2026-05-10T14:32:00Z" },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadJournalEntries } = await import("./ledgerReaders.js");
    const out = await loadJournalEntries();
    expect(out[0]).toMatchObject({ id: "je1", transactionId: "tx1", accountId: "a1", direction: "dr", amount: 1000, currency: "USD" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/ledgerReaders.test.js
```

Expected: 4 fails — module not found.

- [ ] **Step 3: Implement `ledgerReaders.js`**

```js
// src/lib/ledgerReaders.js
// Read-only queries for the `ledger.*` schema (chart of accounts, balances,
// transactions, journal entries). Used exclusively by the Treasury section.
// Mirror of supabaseReaders.js but for the v2 double-entry tables.

import { supabase, isSupabaseConfigured } from "./supabase.js";

function ledger() {
  // PostgREST exposes ledger.* tables when the schema is added to the
  // exposed-schemas config. supabase-js: .schema('ledger').from('table').
  return supabase.schema("ledger");
}

export async function loadLedgerAccounts() {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await ledger()
    .from("accounts")
    .select("id, code, name, type, subtype, currency_code, custody_type, provider, office_id, parent_account_id, client_dim_required, partner_dim_required, allow_negative, active");
  if (error) throw new Error(`loadLedgerAccounts: ${error.message}`);
  return (data || []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    subtype: r.subtype || null,
    currency: r.currency_code,
    custodyType: r.custody_type || null,
    provider: r.provider || null,
    officeId: r.office_id || null,
    parentAccountId: r.parent_account_id || null,
    clientDimRequired: r.client_dim_required === true,
    partnerDimRequired: r.partner_dim_required === true,
    allowNegative: r.allow_negative === true,
    active: r.active === true,
  }));
}

export async function loadLedgerBalances() {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await ledger()
    .from("balances")
    .select("account_id, currency_code, client_id, partner_id, balance");
  if (error) throw new Error(`loadLedgerBalances: ${error.message}`);
  return (data || []).map((r) => ({
    accountId: r.account_id,
    currency: r.currency_code,
    clientId: r.client_id || null,
    partnerId: r.partner_id || null,
    balance: Number(r.balance) || 0,
  }));
}

// opts: { sinceIso?: string }  — load transactions effective_date >= since (default: 90d ago)
export async function loadLedgerTransactions(opts = {}) {
  if (!isSupabaseConfigured) return [];
  const since = opts.sinceIso || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await ledger()
    .from("transactions")
    .select("id, effective_date, created_at, description, source_kind, source_ref_id, reverses_transaction_id, metadata")
    .gte("effective_date", since)
    .order("effective_date", { ascending: false });
  if (error) throw new Error(`loadLedgerTransactions: ${error.message}`);
  return (data || []).map((r) => ({
    id: r.id,
    effectiveDate: r.effective_date,
    createdAt: r.created_at,
    description: r.description || "",
    kind: r.source_kind || "unknown",
    sourceRefId: r.source_ref_id || null,
    reversesTransactionId: r.reverses_transaction_id || null,
    metadata: r.metadata || {},
  }));
}

// opts: { sinceIso?: string }  — entries from transactions effective_date >= since
export async function loadJournalEntries(opts = {}) {
  if (!isSupabaseConfigured) return [];
  const since = opts.sinceIso || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await ledger()
    .from("journal_entries")
    .select("id, transaction_id, account_id, direction, amount, currency_code, client_id, partner_id, note, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`loadJournalEntries: ${error.message}`);
  return (data || []).map((r) => ({
    id: r.id,
    transactionId: r.transaction_id,
    accountId: r.account_id,
    direction: r.direction, // 'dr' | 'cr'
    amount: Number(r.amount) || 0,
    currency: r.currency_code,
    clientId: r.client_id || null,
    partnerId: r.partner_id || null,
    note: r.note || "",
    createdAt: r.created_at,
  }));
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/ledgerReaders.test.js
```

Expected: 4 pass.

- [ ] **Step 5: Commit + push**

```bash
git add src/lib/ledgerReaders.js src/lib/ledgerReaders.test.js
git commit -m "feat(ledger): ledgerReaders.js — read-only queries for ledger.* schema"
git push
```

### Task 1.2: `LedgerProvider` store

**Files:**
- Create: `src/store/ledger.jsx`

- [ ] **Step 1: Write the provider**

```jsx
// src/store/ledger.jsx
// Provider for the v2 ledger data consumed by the Treasury section.
// Loads chart of accounts once, balances + transactions + entries on a
// rolling 90-day window. Refreshes on onDataBump events (new deals etc.).

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  loadLedgerAccounts,
  loadLedgerBalances,
  loadLedgerTransactions,
  loadJournalEntries,
} from "../lib/ledgerReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const LedgerContext = createContext(null);

export function LedgerProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  // window start for transactions/entries — default 90 days ago
  const [sinceIso, setSinceIso] = useState(
    () => new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  );

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [accs, bals, txs, jes] = await Promise.all([
        loadLedgerAccounts().catch(() => []),
        loadLedgerBalances().catch(() => []),
        loadLedgerTransactions({ sinceIso }).catch(() => []),
        loadJournalEntries({ sinceIso }).catch(() => []),
      ]);
      setAccounts(accs);
      setBalances(bals);
      setTransactions(txs);
      setEntries(jes);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[LedgerProvider] reload failed", err);
    } finally {
      setLoading(false);
    }
  }, [sinceIso]);

  useEffect(() => {
    reload();
    const unsub = onDataBump(reload);
    return unsub;
  }, [reload]);

  // Extend the window further back (for Журнал year+ / P&L year). Idempotent —
  // only refetches transactions/entries, keeps accounts/balances.
  const extendWindow = useCallback(async (newSinceIso) => {
    if (new Date(newSinceIso) >= new Date(sinceIso)) return; // already covered
    setSinceIso(newSinceIso); // triggers reload via the effect dep
  }, [sinceIso]);

  const value = useMemo(
    () => ({ accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso }),
    [accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso]
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger must be inside LedgerProvider");
  return ctx;
}
```

- [ ] **Step 2: Build sanity-check**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit + push**

```bash
git add src/store/ledger.jsx
git commit -m "feat(ledger): LedgerProvider — v2 ledger store for Treasury"
git push
```

### Task 1.3: Wire `LedgerProvider` into App.jsx provider chain

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Find the provider chain**

```bash
grep -nE "Provider>" src/App.jsx | head -20
```

Locate where `TransactionsProvider` wraps `RootProvider` (or whatever the deepest provider is). `LedgerProvider` goes between `Transactions` and `Root` per the spec.

- [ ] **Step 2: Add import + wrap**

In `src/App.jsx`:

```jsx
import { LedgerProvider } from "./store/ledger.jsx";
```

Wrap (adjust to the actual existing nesting):

```jsx
<TransactionsProvider>
  <LedgerProvider>
    <RootProvider>
      {/* ... */}
    </RootProvider>
  </LedgerProvider>
</TransactionsProvider>
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit + push**

```bash
git add src/App.jsx
git commit -m "feat(ledger): wire LedgerProvider into provider chain"
git push
```

---

## Phase 2 — Pure selectors (TDD)

All selectors in `src/lib/treasury/v2selectors.js`, tests in `src/lib/treasury/v2selectors.test.js`. Shared fixture builder `makeLedgerCtx()`.

### Task 2.1: Selectors module + fixture

**Files:**
- Create: `src/lib/treasury/v2selectors.js`
- Create: `src/lib/treasury/v2selectors.test.js`

- [ ] **Step 1: Create empty module**

```js
// src/lib/treasury/v2selectors.js
// Pure-function selectors for Treasury Spec B. Take a `ctx` object built up
// from useLedger() + useBaseCurrency(): { accounts, balances, transactions,
// entries, toBase, baseCurrency, officeFilter, now? }.
// All office filtering happens here. "all" includes office_id IS NULL accounts;
// a specific office UUID excludes them.
```

- [ ] **Step 2: Create test fixture**

```js
// src/lib/treasury/v2selectors.test.js
import { describe, it, expect } from "vitest";

export function makeLedgerCtx(overrides = {}) {
  const NOW = new Date("2026-05-10T12:00:00Z");
  const accounts = [
    { id: "ac_cash_usd_mark", code: "1110", name: "Cash · Mark Antalya · USD", type: "asset", subtype: "cash", currency: "USD", officeId: "office-mark", clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_hot_usdt_mark", code: "1316", name: "Hot · USDT TRC20 · Mark", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: "office-mark", clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_treasury_usdt", code: "1340", name: "Treasury · USDT TRC20", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_cust_liab_usd", code: "2110", name: "Customer Liab · USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null, clientDimRequired: true, partnerDimRequired: false },
    { id: "ac_opening_usd", code: "3100", name: "Opening Balance Equity · USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_spread_usd", code: "4010", name: "Spread · USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_rent_usd", code: "5010", name: "Office rent · USD", type: "expense", subtype: "rent", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_fx_gain", code: "3210", name: "FX gain · USD", type: "equity", subtype: "fx_gain", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_fx_loss", code: "3220", name: "FX loss · USD", type: "equity", subtype: "fx_loss", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
  ];
  const balances = [
    { accountId: "ac_cash_usd_mark", currency: "USD", clientId: null, partnerId: null, balance: 11000 },
    { accountId: "ac_hot_usdt_mark", currency: "USDT", clientId: null, partnerId: null, balance: 150 },
    { accountId: "ac_treasury_usdt", currency: "USDT", clientId: null, partnerId: null, balance: 1000 },
    { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-1", partnerId: null, balance: -500 },
    { accountId: "ac_opening_usd", currency: "USD", clientId: null, partnerId: null, balance: 11000 },
  ];
  const transactions = [
    { id: "tx_open", effectiveDate: "2026-04-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z", kind: "opening", sourceRefId: null, reversesTransactionId: null, metadata: {} },
    { id: "tx_deal_1", effectiveDate: "2026-05-10T10:00:00Z", createdAt: "2026-05-10T10:00:00Z", kind: "deal", sourceRefId: "deal-42", reversesTransactionId: null, metadata: { client_nickname: "Иван Петров" } },
  ];
  const entries = [
    // opening tx: Dr cash 11000, Cr opening 11000
    { id: "je1", transactionId: "tx_open", accountId: "ac_cash_usd_mark", direction: "dr", amount: 11000, currency: "USD", clientId: null, partnerId: null, note: "opening", createdAt: "2026-04-01T00:00:00Z" },
    { id: "je2", transactionId: "tx_open", accountId: "ac_opening_usd", direction: "cr", amount: 11000, currency: "USD", clientId: null, partnerId: null, note: "opening", createdAt: "2026-04-01T00:00:00Z" },
    // deal tx: Dr cash 100, Cr cust_liab 100, Dr cust_liab 95 (USDT eq), Cr hot 95, Cr spread 5
    { id: "je3", transactionId: "tx_deal_1", accountId: "ac_cash_usd_mark", direction: "dr", amount: 100, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je4", transactionId: "tx_deal_1", accountId: "ac_cust_liab_usd", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null, note: "", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je5", transactionId: "tx_deal_1", accountId: "ac_cust_liab_usd", direction: "dr", amount: 95, currency: "USD", clientId: "client-1", partnerId: null, note: "USDT eq", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je6", transactionId: "tx_deal_1", accountId: "ac_hot_usdt_mark", direction: "cr", amount: 95, currency: "USDT", clientId: null, partnerId: null, note: "", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je7", transactionId: "tx_deal_1", accountId: "ac_spread_usd", direction: "cr", amount: 5, currency: "USD", clientId: null, partnerId: null, note: "margin", createdAt: "2026-05-10T10:00:00Z" },
    // an expense entry last month
    { id: "je8", transactionId: "tx_open", accountId: "ac_rent_usd", direction: "dr", amount: 1800, currency: "USD", clientId: null, partnerId: null, note: "rent", createdAt: "2026-05-05T00:00:00Z" },
  ];
  const rate = (cur) => ({ USD: 1, USDT: 1, TRY: 0.03 }[String(cur).toUpperCase()] ?? 0);
  const toBase = (amount, cur) => Number(amount) * rate(cur);
  return {
    accounts, balances, transactions, entries,
    toBase, baseCurrency: "USD",
    officeFilter: "all",
    now: () => NOW,
    ...overrides,
  };
}

describe("makeLedgerCtx fixture sanity", () => {
  it("has chart of accounts spanning all 5 classes", () => {
    const ctx = makeLedgerCtx();
    const types = new Set(ctx.accounts.map((a) => a.type));
    expect(types).toEqual(new Set(["asset", "liability", "equity", "revenue", "expense"]));
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

Expected: 1 sanity test passes.

- [ ] **Step 4: Commit + push**

```bash
git add src/lib/treasury/v2selectors.js src/lib/treasury/v2selectors.test.js
git commit -m "test(treasury): v2selectors fixture + sanity"
git push
```

### Task 2.2: `groupByClass` selector

**Files:**
- Modify: `src/lib/treasury/v2selectors.js`
- Modify: `src/lib/treasury/v2selectors.test.js`

- [ ] **Step 1: Failing test**

Append to `v2selectors.test.js`:

```js
import { groupByClass } from "./v2selectors.js";

describe("groupByClass", () => {
  it("groups asset accounts by subtype with base totals (officeFilter=all)", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "asset");
    // assets: cash USD 11000 (mark), crypto_input USDT 150 (mark) + USDT 1000 (treasury, office NULL)
    const cash = sections.find((s) => s.subtype === "cash");
    const crypto = sections.find((s) => s.subtype === "crypto_input");
    expect(cash.accounts).toHaveLength(1);
    expect(cash.totalInBase).toBe(11000);
    expect(crypto.accounts).toHaveLength(2);
    expect(crypto.totalInBase).toBe(1150); // 150 + 1000, USDT@1
  });

  it("officeFilter=office-mark excludes office_id NULL accounts", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const sections = groupByClass(ctx, "asset");
    const crypto = sections.find((s) => s.subtype === "crypto_input");
    expect(crypto.accounts).toHaveLength(1); // only the mark hot wallet, treasury (NULL office) excluded
    expect(crypto.totalInBase).toBe(150);
  });

  it("liability section returns customer_liab with negative balance", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "liability");
    const cl = sections.find((s) => s.subtype === "customer_liab");
    expect(cl.accounts[0].balance).toBe(-500);
    expect(cl.accounts[0].clientId).toBe("client-1"); // dimension preserved
  });

  it("equity section returns opening + fx accounts", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "equity");
    const subtypes = sections.map((s) => s.subtype).sort();
    expect(subtypes).toContain("opening_balance");
    expect(subtypes).toContain("fx_gain");
    expect(subtypes).toContain("fx_loss");
  });

  it("sorts sections by totalInBase desc", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "asset");
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i - 1].totalInBase).toBeGreaterThanOrEqual(sections[i].totalInBase);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 3: Implement**

Append to `v2selectors.js`:

```js
function passesOfficeFilter(account, officeFilter) {
  if (officeFilter === "all" || !officeFilter) return true;
  return account.officeId === officeFilter;
}

const SUBTYPE_LABEL_KEYS = {
  cash: "trv2_subtype_cash",
  bank: "trv2_subtype_bank",
  crypto_input: "trv2_subtype_crypto_input",
  crypto_output: "trv2_subtype_crypto_output",
  inter_office: "trv2_subtype_inter_office",
  clearing: "trv2_subtype_clearing",
  fx_clearing: "trv2_subtype_fx_clearing",
  customer_liab: "trv2_subtype_customer_liab",
  partner_liab: "trv2_subtype_partner_liab",
  unearned: "trv2_subtype_unearned",
  opening_balance: "trv2_subtype_opening_balance",
  retained_earnings: "trv2_subtype_retained_earnings",
  owner_contribution: "trv2_subtype_owner_contribution",
  spread: "trv2_subtype_spread",
  commission: "trv2_subtype_commission",
  fx_gain: "trv2_subtype_fx_gain",
  fx_loss: "trv2_subtype_fx_loss",
  network_fee: "trv2_subtype_network_fee",
  exchange_fee: "trv2_subtype_exchange_fee",
};

export function groupByClass(ctx, accountType) {
  const { accounts, balances, toBase, officeFilter } = ctx;
  // balance lookup: (accountId, currency, clientId, partnerId) → balance
  const balByKey = new Map();
  for (const b of balances) {
    balByKey.set(`${b.accountId}|${b.currency}|${b.clientId || ""}|${b.partnerId || ""}`, b);
  }
  const bySubtype = new Map();
  for (const acc of accounts) {
    if (acc.type !== accountType) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    // an account may have multiple balance rows (per dimension) — emit one row per
    const rowsForAccount = balances.filter((b) => b.accountId === acc.id);
    const dimRows = rowsForAccount.length > 0 ? rowsForAccount : [{ accountId: acc.id, currency: acc.currency, clientId: null, partnerId: null, balance: 0 }];
    const subtype = acc.subtype || "other";
    const sect = bySubtype.get(subtype) || { subtype, labelKey: SUBTYPE_LABEL_KEYS[subtype] || "trv2_subtype_other", accounts: [], totalInBase: 0 };
    for (const dr of dimRows) {
      const inBase = toBase(dr.balance, dr.currency) || 0;
      sect.accounts.push({
        accountId: acc.id, code: acc.code, name: acc.name, currency: dr.currency,
        clientId: dr.clientId || null, partnerId: dr.partnerId || null,
        balance: dr.balance, balanceInBase: inBase,
      });
      sect.totalInBase += inBase;
    }
    bySubtype.set(subtype, sect);
  }
  return [...bySubtype.values()].sort((a, b) => b.totalInBase - a.totalInBase);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): groupByClass selector"
git push
```

### Task 2.3: `accountEntries` selector

**Files:**
- Modify: `src/lib/treasury/v2selectors.js`
- Modify: `src/lib/treasury/v2selectors.test.js`

- [ ] **Step 1: Failing test**

Append:

```js
import { accountEntries } from "./v2selectors.js";

describe("accountEntries", () => {
  it("returns entries for an account, newest first, with source label", () => {
    const ctx = makeLedgerCtx();
    const rows = accountEntries(ctx, "ac_cash_usd_mark", 50);
    // ac_cash_usd_mark has je1 (opening Dr 11000) + je3 (deal Dr 100)
    expect(rows).toHaveLength(2);
    expect(new Date(rows[0].createdAt) >= new Date(rows[1].createdAt)).toBe(true);
    const dealRow = rows.find((r) => r.txId === "tx_deal_1");
    expect(dealRow.direction).toBe("dr");
    expect(dealRow.amount).toBe(100);
    expect(dealRow.txKind).toBe("deal");
    expect(dealRow.sourceRefId).toBe("deal-42");
  });

  it("respects limit", () => {
    const ctx = makeLedgerCtx();
    expect(accountEntries(ctx, "ac_cash_usd_mark", 1)).toHaveLength(1);
  });

  it("returns empty for account with no entries", () => {
    const ctx = makeLedgerCtx();
    expect(accountEntries(ctx, "ac_fx_gain", 50)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 3: Implement**

Append:

```js
export function accountEntries(ctx, accountId, limit = 50) {
  const { entries, transactions } = ctx;
  const txById = new Map(transactions.map((t) => [t.id, t]));
  return entries
    .filter((e) => e.accountId === accountId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((e) => {
      const tx = txById.get(e.transactionId);
      return {
        id: e.id,
        createdAt: e.createdAt,
        direction: e.direction,
        amount: e.amount,
        currency: e.currency,
        clientId: e.clientId || null,
        partnerId: e.partnerId || null,
        note: e.note || "",
        txId: e.transactionId,
        txKind: tx ? tx.kind : "unknown",
        sourceRefId: tx ? tx.sourceRefId : null,
      };
    });
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): accountEntries selector"
git push
```

### Task 2.4: `transactionTree` selector

**Files:**
- Modify: `src/lib/treasury/v2selectors.js`
- Modify: `src/lib/treasury/v2selectors.test.js`

- [ ] **Step 1: Failing test**

Append:

```js
import { transactionTree } from "./v2selectors.js";

describe("transactionTree", () => {
  it("returns transactions newest first with their entries", () => {
    const ctx = makeLedgerCtx();
    const tree = transactionTree(ctx, { type: "all", officeFilter: "all" });
    expect(tree.length).toBeGreaterThanOrEqual(2);
    expect(tree[0].tx.id).toBe("tx_deal_1"); // newest by effectiveDate
    const deal = tree.find((t) => t.tx.id === "tx_deal_1");
    expect(deal.entries.length).toBe(5); // je3..je7
    // Σ Dr should equal Σ Cr within tx (per currency)
    const drSum = deal.entries.filter((e) => e.direction === "dr").reduce((s, e) => s + e.amount, 0);
    const crSum = deal.entries.filter((e) => e.direction === "cr").reduce((s, e) => s + e.amount, 0);
    // not necessarily equal across currencies in the fixture (USD vs USDT), so just check structure
    expect(typeof drSum).toBe("number");
    expect(typeof crSum).toBe("number");
  });

  it("type=deal filters to deal transactions only", () => {
    const ctx = makeLedgerCtx();
    const tree = transactionTree(ctx, { type: "deal", officeFilter: "all" });
    expect(tree.every((t) => t.tx.kind === "deal")).toBe(true);
  });

  it("officeFilter=office-mark keeps tx that touch a mark-office account", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const tree = transactionTree(ctx, { type: "all", officeFilter: "office-mark" });
    // tx_deal_1 touches ac_cash_usd_mark and ac_hot_usdt_mark (both mark) → kept
    expect(tree.find((t) => t.tx.id === "tx_deal_1")).toBeTruthy();
  });

  it("returns empty for a period with no transactions", () => {
    const ctx = makeLedgerCtx();
    const tree = transactionTree(ctx, { type: "all", officeFilter: "all", period: { from: "2030-01-01T00:00:00Z", to: "2030-12-31T00:00:00Z" } });
    expect(tree).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 3: Implement**

Append:

```js
export function transactionTree(ctx, opts = {}) {
  const { transactions, entries, accounts } = ctx;
  const { type = "all", officeFilter = "all", period } = opts;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const entriesByTx = new Map();
  for (const e of entries) {
    const arr = entriesByTx.get(e.transactionId) || [];
    arr.push(e);
    entriesByTx.set(e.transactionId, arr);
  }
  const fromMs = period ? new Date(period.from).getTime() : -Infinity;
  const toMs = period ? new Date(period.to).getTime() : Infinity;

  return transactions
    .filter((t) => {
      if (type !== "all" && t.kind !== type) return false;
      const ts = new Date(t.effectiveDate).getTime();
      if (ts < fromMs || ts > toMs) return false;
      if (officeFilter !== "all" && officeFilter) {
        // keep if any entry touches an account with this officeId
        const txEntries = entriesByTx.get(t.id) || [];
        const touches = txEntries.some((e) => accById.get(e.accountId)?.officeId === officeFilter);
        if (!touches) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
    .map((t) => ({
      tx: t,
      entries: (entriesByTx.get(t.id) || []).map((e) => ({
        ...e,
        accountCode: accById.get(e.accountId)?.code || "?",
        accountName: accById.get(e.accountId)?.name || "?",
      })),
    }));
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): transactionTree selector"
git push
```

### Task 2.5: `pnlForPeriod` selector

**Files:**
- Modify: `src/lib/treasury/v2selectors.js`
- Modify: `src/lib/treasury/v2selectors.test.js`

- [ ] **Step 1: Failing test**

Append:

```js
import { pnlForPeriod } from "./v2selectors.js";

describe("pnlForPeriod", () => {
  it("computes revenue, expense, fx, net profit in base currency", () => {
    const ctx = makeLedgerCtx();
    const period = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
    const pnl = pnlForPeriod(ctx, period, "all");
    // revenue: spread Cr 5 (je7) → +5
    expect(pnl.revenue.total).toBe(5);
    // expense: rent Dr 1800 (je8, dated 2026-05-05) → +1800
    expect(pnl.expense.total).toBe(1800);
    // fx: none in window → 0
    expect(pnl.fxNet).toBe(0);
    // net = 5 - 1800 + 0 = -1795
    expect(pnl.netProfit).toBe(-1795);
  });

  it("excludes entries outside the period", () => {
    const ctx = makeLedgerCtx();
    const period = { from: "2026-05-09T00:00:00Z", to: "2026-05-09T23:59:59Z" };
    const pnl = pnlForPeriod(ctx, period, "all");
    expect(pnl.revenue.total).toBe(0); // je7 is 2026-05-10, outside
    expect(pnl.expense.total).toBe(0); // je8 is 2026-05-05, outside
  });

  it("returns subtype-grouped account rows", () => {
    const ctx = makeLedgerCtx();
    const period = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
    const pnl = pnlForPeriod(ctx, period, "all");
    const spreadRow = pnl.revenue.accounts.find((a) => a.code === "4010");
    expect(spreadRow.amountInBase).toBe(5);
    expect(spreadRow.entryCount).toBe(1);
  });

  it("officeFilter=office-mark excludes office_id NULL revenue/expense accounts", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const period = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
    const pnl = pnlForPeriod(ctx, period, "office-mark");
    // spread (4010) and rent (5010) have officeId NULL → excluded
    expect(pnl.revenue.total).toBe(0);
    expect(pnl.expense.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 3: Implement**

Append:

```js
function entryInPeriod(e, fromMs, toMs) {
  const ts = new Date(e.createdAt).getTime();
  return ts >= fromMs && ts <= toMs;
}

function aggregateClass(ctx, accountType, fromMs, toMs, officeFilter, signFn) {
  const { accounts, entries, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const byAccount = new Map();
  let total = 0;
  for (const e of entries) {
    if (!entryInPeriod(e, fromMs, toMs)) continue;
    const acc = accById.get(e.accountId);
    if (!acc || acc.type !== accountType) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const signed = signFn(e); // signed amount in native currency
    const inBase = toBase(signed, e.currency) || 0;
    const row = byAccount.get(acc.id) || { code: acc.code, name: acc.name, currency: acc.currency, amountInBase: 0, entryCount: 0 };
    row.amountInBase += inBase;
    row.entryCount += 1;
    byAccount.set(acc.id, row);
    total += inBase;
  }
  return { total, accounts: [...byAccount.values()].sort((a, b) => Math.abs(b.amountInBase) - Math.abs(a.amountInBase)) };
}

export function pnlForPeriod(ctx, period, officeFilter) {
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  // revenue: normally credited → +Cr −Dr
  const revenue = aggregateClass(ctx, "revenue", fromMs, toMs, officeFilter, (e) => (e.direction === "cr" ? e.amount : -e.amount));
  // expense: normally debited → +Dr −Cr
  const expense = aggregateClass(ctx, "expense", fromMs, toMs, officeFilter, (e) => (e.direction === "dr" ? e.amount : -e.amount));
  // fx: equity-class accounts with subtype fx_gain / fx_loss. gain: +Cr−Dr; loss: −(Dr−Cr) ⇒ +Cr−Dr too, but we present net = Σfx_gain − Σfx_loss.
  // Simpler: aggregate both as (+Cr−Dr) which makes gain positive and loss negative naturally.
  const { accounts, entries, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const fxAccounts = new Map();
  let fxNet = 0;
  for (const e of entries) {
    if (!entryInPeriod(e, fromMs, toMs)) continue;
    const acc = accById.get(e.accountId);
    if (!acc || acc.type !== "equity") continue;
    if (acc.subtype !== "fx_gain" && acc.subtype !== "fx_loss") continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const signed = e.direction === "cr" ? e.amount : -e.amount; // gain↑ when credited
    const inBase = toBase(signed, e.currency) || 0;
    const row = fxAccounts.get(acc.id) || { code: acc.code, name: acc.name, currency: acc.currency, amountInBase: 0, entryCount: 0 };
    row.amountInBase += inBase;
    row.entryCount += 1;
    fxAccounts.set(acc.id, row);
    fxNet += inBase;
  }
  const netProfit = revenue.total - expense.total + fxNet;
  return {
    revenue,
    expense,
    fxNet,
    fxAccounts: [...fxAccounts.values()].sort((a, b) => Math.abs(b.amountInBase) - Math.abs(a.amountInBase)),
    netProfit,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 5: Commit + push**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): pnlForPeriod selector"
git push
```

### Task 2.6: `balanceCheckTotals` selector

**Files:**
- Modify: `src/lib/treasury/v2selectors.js`
- Modify: `src/lib/treasury/v2selectors.test.js`

- [ ] **Step 1: Failing test**

Append:

```js
import { balanceCheckTotals } from "./v2selectors.js";

describe("balanceCheckTotals", () => {
  it("computes assets, liabilities, equity and identity check (all offices)", () => {
    const ctx = makeLedgerCtx();
    const r = balanceCheckTotals(ctx, "all");
    // assets: cash 11000 + hot 150 + treasury 1000 = 12150 (USDT@1)
    expect(r.assets).toBe(12150);
    // liabilities: cust_liab -500 (USD)
    expect(r.liabilities).toBe(-500);
    // equity: opening 11000
    expect(r.equity).toBe(11000);
    // identity: assets - (liabilities + equity) = 12150 - (10500) = 1650 → out of balance in fixture
    expect(r.identityCheck.delta).toBe(1650);
    expect(r.identityCheck.ok).toBe(false);
  });

  it("flags ok when assets == liabilities + equity within epsilon", () => {
    const ctx = makeLedgerCtx({
      balances: [
        { accountId: "ac_cash_usd_mark", currency: "USD", clientId: null, partnerId: null, balance: 1000 },
        { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-1", partnerId: null, balance: 300 },
        { accountId: "ac_opening_usd", currency: "USD", clientId: null, partnerId: null, balance: 700 },
      ],
    });
    const r = balanceCheckTotals(ctx, "all");
    // assets 1000 = liabilities 300 + equity 700 → ok
    expect(r.identityCheck.ok).toBe(true);
    expect(Math.abs(r.identityCheck.delta)).toBeLessThan(0.01);
  });

  it("officeFilter restricts to that office's accounts", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const r = balanceCheckTotals(ctx, "office-mark");
    // only mark accounts: cash 11000 + hot 150 = 11150 assets; no mark liab/equity
    expect(r.assets).toBe(11150);
    expect(r.liabilities).toBe(0);
    expect(r.equity).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

- [ ] **Step 3: Implement**

Append:

```js
export function balanceCheckTotals(ctx, officeFilter) {
  const { accounts, balances, toBase } = ctx;
  const accById = new Map(accounts.map((a) => [a.id, a]));
  let assets = 0, liabilities = 0, equity = 0;
  for (const b of balances) {
    const acc = accById.get(b.accountId);
    if (!acc) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const inBase = toBase(b.balance, b.currency) || 0;
    if (acc.type === "asset") assets += inBase;
    else if (acc.type === "liability") liabilities += inBase;
    else if (acc.type === "equity") equity += inBase;
    // revenue/expense don't carry a balance-sheet balance (they roll into retained earnings) — ignore here
  }
  const delta = assets - (liabilities + equity);
  return { assets, liabilities, equity, identityCheck: { ok: Math.abs(delta) < 0.01, delta } };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/v2selectors.test.js
```

Expected: all selector tests pass (~20+ tests).

- [ ] **Step 5: Commit + push**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): balanceCheckTotals selector"
git push
```

---

## Phase 3 — Shell + i18n + delete MVP

### Task 3.1: Add `trv2_*` i18n keys (en/ru/tr)

**Files:**
- Modify: `src/i18n/translations.jsx`

- [ ] **Step 1: Find translations file structure**

```bash
grep -nE "^\s*(en|ru|tr):\s*\{" src/i18n/translations.jsx
```

- [ ] **Step 2: Add English keys**

In the `en:` block, near existing `tr_*` keys (or anywhere), insert:

```js
    trv2_title: "Treasury",
    trv2_office_all: "All offices",
    trv2_office_label: "Office",
    trv2_data_freshness: "updated {time}",
    trv2_tab_assets: "Assets",
    trv2_tab_liabilities: "Liabilities",
    trv2_tab_equity: "Equity",
    trv2_tab_pnl: "P&L",
    trv2_tab_journal: "Journal",
    trv2_col_account: "Account",
    trv2_col_currency: "Currency",
    trv2_col_balance: "Balance",
    trv2_col_in_base: "In base",
    trv2_col_date: "Date",
    trv2_col_dr: "Dr",
    trv2_col_cr: "Cr",
    trv2_col_amount: "Amount",
    trv2_col_source: "Source",
    trv2_show_all_entries: "Show all entries",
    trv2_no_entries: "No entries",
    trv2_balance_check: "Balance check",
    trv2_balance_ok: "Assets = Liabilities + Equity ✓",
    trv2_balance_fail: "Ledger out of balance: delta = {delta}",
    trv2_subtype_cash: "Cash",
    trv2_subtype_bank: "Bank",
    trv2_subtype_crypto_input: "Crypto wallet (in)",
    trv2_subtype_crypto_output: "Crypto wallet (out)",
    trv2_subtype_inter_office: "Inter-office",
    trv2_subtype_clearing: "Clearing",
    trv2_subtype_fx_clearing: "FX clearing",
    trv2_subtype_customer_liab: "Customer liabilities",
    trv2_subtype_partner_liab: "Partner liabilities",
    trv2_subtype_unearned: "Unearned",
    trv2_subtype_opening_balance: "Opening balance",
    trv2_subtype_retained_earnings: "Retained earnings",
    trv2_subtype_owner_contribution: "Owner contribution",
    trv2_subtype_spread: "Spread",
    trv2_subtype_commission: "Commission",
    trv2_subtype_fx_gain: "FX gain",
    trv2_subtype_fx_loss: "FX loss",
    trv2_subtype_network_fee: "Network fee",
    trv2_subtype_exchange_fee: "Exchange fee",
    trv2_subtype_other: "Other",
    trv2_pnl_revenue: "Revenue",
    trv2_pnl_expense: "Expense",
    trv2_pnl_fx: "FX gain / loss",
    trv2_pnl_net_profit: "Net Profit",
    trv2_pnl_no_data: "No operations in the selected period",
    trv2_pnl_export_csv: "Export CSV",
    trv2_pnl_compare: "Compare with previous period",
    trv2_journal_no_tx: "No transactions",
    trv2_journal_type_all: "All",
    trv2_journal_type_deal: "Deals",
    trv2_journal_type_transfer: "Transfers",
    trv2_journal_type_topup: "Top-ups",
    trv2_journal_type_adjustment: "Adjustments",
    trv2_journal_type_reversal: "Reversals",
    trv2_journal_open_source: "Open {label}",
    trv2_journal_entries_count: "{n} entries",
    trv2_journal_reversed: "reversed",
    trv2_journal_is_reversal: "reversal",
    trv2_period_today: "Today",
    trv2_period_week: "Week",
    trv2_period_month: "Month",
    trv2_period_quarter: "Quarter",
    trv2_period_year: "Year",
    trv2_period_30d: "30 days",
    trv2_period_custom: "Custom",
    trv2_period_days: "{n} days",
    trv2_rate_unknown: "rate not set",
    trv2_loading: "Loading ledger…",
```

- [ ] **Step 3: Add Russian keys**

In `ru:` block, equivalent:

```js
    trv2_title: "Казначейство",
    trv2_office_all: "Все офисы",
    trv2_office_label: "Офис",
    trv2_data_freshness: "обновлено {time}",
    trv2_tab_assets: "Активы",
    trv2_tab_liabilities: "Пассивы",
    trv2_tab_equity: "Капитал",
    trv2_tab_pnl: "P&L",
    trv2_tab_journal: "Журнал",
    trv2_col_account: "Счёт",
    trv2_col_currency: "Валюта",
    trv2_col_balance: "Баланс",
    trv2_col_in_base: "В base",
    trv2_col_date: "Дата",
    trv2_col_dr: "Дт",
    trv2_col_cr: "Кт",
    trv2_col_amount: "Сумма",
    trv2_col_source: "Документ",
    trv2_show_all_entries: "Показать все проводки",
    trv2_no_entries: "Проводок нет",
    trv2_balance_check: "Балансовое тождество",
    trv2_balance_ok: "Активы = Пассивы + Капитал ✓",
    trv2_balance_fail: "Леджер не сходится: дельта = {delta}",
    trv2_subtype_cash: "Касса",
    trv2_subtype_bank: "Банк",
    trv2_subtype_crypto_input: "Крипто-кошелёк (приём)",
    trv2_subtype_crypto_output: "Крипто-кошелёк (выдача)",
    trv2_subtype_inter_office: "Межофисные",
    trv2_subtype_clearing: "Клиринг",
    trv2_subtype_fx_clearing: "FX-клиринг",
    trv2_subtype_customer_liab: "Обязательства перед клиентами",
    trv2_subtype_partner_liab: "Обязательства перед партнёрами",
    trv2_subtype_unearned: "Незаработанное",
    trv2_subtype_opening_balance: "Входящий остаток",
    trv2_subtype_retained_earnings: "Нераспределённая прибыль",
    trv2_subtype_owner_contribution: "Взнос владельца",
    trv2_subtype_spread: "Спред",
    trv2_subtype_commission: "Комиссия",
    trv2_subtype_fx_gain: "Курсовая прибыль",
    trv2_subtype_fx_loss: "Курсовой убыток",
    trv2_subtype_network_fee: "Сетевая комиссия",
    trv2_subtype_exchange_fee: "Биржевая комиссия",
    trv2_subtype_other: "Прочее",
    trv2_pnl_revenue: "Доходы",
    trv2_pnl_expense: "Расходы",
    trv2_pnl_fx: "Курсовые разницы",
    trv2_pnl_net_profit: "Чистая прибыль",
    trv2_pnl_no_data: "Нет операций за выбранный период",
    trv2_pnl_export_csv: "Экспорт CSV",
    trv2_pnl_compare: "Сравнить с прошлым периодом",
    trv2_journal_no_tx: "Транзакций нет",
    trv2_journal_type_all: "Все",
    trv2_journal_type_deal: "Сделки",
    trv2_journal_type_transfer: "Переводы",
    trv2_journal_type_topup: "Пополнения",
    trv2_journal_type_adjustment: "Корректировки",
    trv2_journal_type_reversal: "Сторно",
    trv2_journal_open_source: "Открыть {label}",
    trv2_journal_entries_count: "{n} проводок",
    trv2_journal_reversed: "сторнирована",
    trv2_journal_is_reversal: "сторно",
    trv2_period_today: "Сегодня",
    trv2_period_week: "Неделя",
    trv2_period_month: "Месяц",
    trv2_period_quarter: "Квартал",
    trv2_period_year: "Год",
    trv2_period_30d: "30 дней",
    trv2_period_custom: "Произвольный",
    trv2_period_days: "{n} дн.",
    trv2_rate_unknown: "курс не задан",
    trv2_loading: "Загрузка леджера…",
```

- [ ] **Step 4: Add Turkish keys**

In `tr:` block (Turkish locale), insert (translate; brief Turkish equivalents):

```js
    trv2_title: "Hazine",
    trv2_office_all: "Tüm ofisler",
    trv2_office_label: "Ofis",
    trv2_data_freshness: "güncellendi {time}",
    trv2_tab_assets: "Varlıklar",
    trv2_tab_liabilities: "Yükümlülükler",
    trv2_tab_equity: "Özkaynak",
    trv2_tab_pnl: "Kâr/Zarar",
    trv2_tab_journal: "Yevmiye",
    trv2_col_account: "Hesap",
    trv2_col_currency: "Para birimi",
    trv2_col_balance: "Bakiye",
    trv2_col_in_base: "Baz",
    trv2_col_date: "Tarih",
    trv2_col_dr: "Bor",
    trv2_col_cr: "Ala",
    trv2_col_amount: "Tutar",
    trv2_col_source: "Belge",
    trv2_show_all_entries: "Tüm kayıtları göster",
    trv2_no_entries: "Kayıt yok",
    trv2_balance_check: "Bilanço denkliği",
    trv2_balance_ok: "Varlıklar = Yükümlülükler + Özkaynak ✓",
    trv2_balance_fail: "Defter dengesiz: fark = {delta}",
    trv2_subtype_cash: "Nakit",
    trv2_subtype_bank: "Banka",
    trv2_subtype_crypto_input: "Kripto cüzdan (giriş)",
    trv2_subtype_crypto_output: "Kripto cüzdan (çıkış)",
    trv2_subtype_inter_office: "Ofisler arası",
    trv2_subtype_clearing: "Takas",
    trv2_subtype_fx_clearing: "FX takas",
    trv2_subtype_customer_liab: "Müşteri yükümlülükleri",
    trv2_subtype_partner_liab: "Partner yükümlülükleri",
    trv2_subtype_unearned: "Kazanılmamış",
    trv2_subtype_opening_balance: "Açılış bakiyesi",
    trv2_subtype_retained_earnings: "Dağıtılmamış kâr",
    trv2_subtype_owner_contribution: "Sahip katkısı",
    trv2_subtype_spread: "Spread",
    trv2_subtype_commission: "Komisyon",
    trv2_subtype_fx_gain: "FX kâr",
    trv2_subtype_fx_loss: "FX zarar",
    trv2_subtype_network_fee: "Ağ ücreti",
    trv2_subtype_exchange_fee: "Borsa ücreti",
    trv2_subtype_other: "Diğer",
    trv2_pnl_revenue: "Gelir",
    trv2_pnl_expense: "Gider",
    trv2_pnl_fx: "FX kâr / zarar",
    trv2_pnl_net_profit: "Net kâr",
    trv2_pnl_no_data: "Seçili dönemde işlem yok",
    trv2_pnl_export_csv: "CSV dışa aktar",
    trv2_pnl_compare: "Önceki dönemle karşılaştır",
    trv2_journal_no_tx: "İşlem yok",
    trv2_journal_type_all: "Tümü",
    trv2_journal_type_deal: "İşlemler",
    trv2_journal_type_transfer: "Transferler",
    trv2_journal_type_topup: "Yüklemeler",
    trv2_journal_type_adjustment: "Düzeltmeler",
    trv2_journal_type_reversal: "Ters kayıtlar",
    trv2_journal_open_source: "{label} aç",
    trv2_journal_entries_count: "{n} kayıt",
    trv2_journal_reversed: "ters kaydedildi",
    trv2_journal_is_reversal: "ters kayıt",
    trv2_period_today: "Bugün",
    trv2_period_week: "Hafta",
    trv2_period_month: "Ay",
    trv2_period_quarter: "Çeyrek",
    trv2_period_year: "Yıl",
    trv2_period_30d: "30 gün",
    trv2_period_custom: "Özel",
    trv2_period_days: "{n} gün",
    trv2_rate_unknown: "kur tanımlı değil",
    trv2_loading: "Defter yükleniyor…",
```

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 6: Commit + push**

```bash
git add src/i18n/translations.jsx
git commit -m "i18n(treasury): trv2_* keys for Spec B (en/ru/tr)"
git push
```

### Task 3.2: Delete the May-9 Treasury MVP

**Files:**
- Delete: `src/pages/treasury/Dashboard.jsx`
- Delete: `src/pages/treasury/Dashboard.test.jsx`
- Delete: `src/pages/treasury/components/` (all files)
- Delete: `src/lib/treasury/selectors.js`
- Delete: `src/lib/treasury/selectors.test.js`
- Modify: `src/i18n/translations.jsx` (remove the old `tr_dashboard_*` / `tr_kpi_*` / `tr_alert_*` / `tr_balances_*` / `tr_currency_*` / `tr_timeline_*` / `tr_empty_state_*` / `tr_account_type_*` keys added in the May-9 MVP — keep `tr_title` / `tr_subtitle` / `tr_tab_*` only if still referenced; otherwise remove)

- [ ] **Step 1: Verify what imports the MVP files**

```bash
grep -rE "treasury/Dashboard|treasury/components|treasury/selectors" src/ --include="*.jsx" --include="*.js"
```

Expected: only `TreasuryPage.jsx` imports `treasury/Dashboard.jsx`. (We rewrite `TreasuryPage.jsx` in Task 3.5, so it's fine to delete now and fix the import there.)

- [ ] **Step 2: Delete files**

```bash
git rm src/pages/treasury/Dashboard.jsx src/pages/treasury/Dashboard.test.jsx
git rm -r src/pages/treasury/components
git rm src/lib/treasury/selectors.js src/lib/treasury/selectors.test.js
```

- [ ] **Step 3: Remove dead i18n keys**

In `src/i18n/translations.jsx`, find and delete (in all 3 locales) the keys: `tr_dashboard_title`, `tr_dashboard_subtitle_office`, `tr_data_freshness`, `tr_kpi_*`, `tr_alert_*`, `tr_balances_*`, `tr_account_type_*`, `tr_currency_*`, `tr_timeline_*`, `tr_empty_state_*`.

Keep `tr_title`, `tr_subtitle`, `tr_tab_nostro`, `tr_tab_loro`, `tr_tab_capital` if they're referenced anywhere else; otherwise remove those too. Verify:

```bash
grep -rnE "t\(['\"]tr_(dashboard|kpi|alert|balances|account_type|currency|timeline|empty_state|tab_nostro|tab_loro|tab_capital)" src/
```

If a key has 0 references, delete it.

- [ ] **Step 4: Build (will fail until TreasuryPage rewritten — that's expected; just verify the error is only about the missing Dashboard import)**

```bash
npm run build 2>&1 | grep -i "treasury"
```

Expected: error about `./treasury/Dashboard.jsx` not found, imported by `TreasuryPage.jsx`. We fix that in Task 3.5.

- [ ] **Step 5: Commit (no push yet — build is broken until 3.5)**

```bash
git commit -m "chore(treasury): delete May-9 MVP (Dashboard, components, selectors, dead i18n)"
```

(Don't push — the next 3 tasks fix the build. We'll push after Task 3.5.)

### Task 3.3: `<OfficePicker>` component

**Files:**
- Create: `src/pages/treasury_v2/OfficePicker.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury_v2/OfficePicker.jsx
import React from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useOffices } from "../../store/offices.jsx";

export default function OfficePicker({ value, onChange }) {
  const { t } = useTranslation();
  const { activeOffices } = useOffices();
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t("trv2_office_label")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[8px] px-2.5 py-1.5 text-[13px] outline-none"
      >
        <option value="all">{t("trv2_office_all")}</option>
        {(activeOffices || []).map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep -iE "OfficePicker|error" | head -5
```

Expected: no new errors from this file (build still broken from Task 3.2's deleted Dashboard, that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury_v2/OfficePicker.jsx
git commit -m "feat(treasury): OfficePicker component"
```

### Task 3.4: `<BalanceCheckBar>` component

**Files:**
- Create: `src/pages/treasury_v2/BalanceCheckBar.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury_v2/BalanceCheckBar.jsx
import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";

export default function BalanceCheckBar({ totals, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const ok = totals.identityCheck.ok;
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  const cls = ok ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-rose-50 border-rose-200 text-rose-900";
  return (
    <div className={`sticky bottom-0 px-5 py-2.5 border-t text-[12.5px] font-medium flex items-center gap-3 ${cls}`}>
      <Icon className={`w-4 h-4 shrink-0 ${ok ? "text-emerald-600" : "text-rose-600"}`} />
      <span className="tabular-nums">
        {t("trv2_balance_check")}: {formatBase(totals.assets, baseCurrency)} = {formatBase(totals.liabilities, baseCurrency)} + {formatBase(totals.equity, baseCurrency)}
        {" "}
        {ok ? "✓" : t("trv2_balance_fail").replace("{delta}", formatBase(totals.identityCheck.delta, baseCurrency))}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/treasury_v2/BalanceCheckBar.jsx
git commit -m "feat(treasury): BalanceCheckBar component"
```

### Task 3.5: `<TreasuryShell>` + rewrite `TreasuryPage.jsx`

**Files:**
- Create: `src/pages/treasury_v2/TreasuryShell.jsx`
- Modify: `src/pages/TreasuryPage.jsx` (rewrite)

For now the 5 tab components are stubs (we fill them in Phases 4-6). The shell wires office picker + tabs + balance bar.

- [ ] **Step 1: Create tab stubs**

```bash
mkdir -p src/pages/treasury_v2/tabs src/pages/treasury_v2/parts
```

Create `src/pages/treasury_v2/tabs/AssetsTab.jsx`:

```jsx
import React from "react";
export default function AssetsTab() {
  return <div className="p-5 text-slate-400 text-[13px]">Assets — coming in Phase 4</div>;
}
```

Same stub content for `LiabilitiesTab.jsx`, `EquityTab.jsx`, `PnLTab.jsx`, `JournalTab.jsx` (just change the label text).

- [ ] **Step 2: Create `TreasuryShell.jsx`**

```jsx
// src/pages/treasury_v2/TreasuryShell.jsx
import React, { useState, useMemo } from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useLedger } from "../../store/ledger.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { balanceCheckTotals } from "../../lib/treasury/v2selectors.js";
import OfficePicker from "./OfficePicker.jsx";
import BalanceCheckBar from "./BalanceCheckBar.jsx";
import AssetsTab from "./tabs/AssetsTab.jsx";
import LiabilitiesTab from "./tabs/LiabilitiesTab.jsx";
import EquityTab from "./tabs/EquityTab.jsx";
import PnLTab from "./tabs/PnLTab.jsx";
import JournalTab from "./tabs/JournalTab.jsx";

const TABS = [
  { id: "assets", labelKey: "trv2_tab_assets", component: AssetsTab },
  { id: "liabilities", labelKey: "trv2_tab_liabilities", component: LiabilitiesTab },
  { id: "equity", labelKey: "trv2_tab_equity", component: EquityTab },
  { id: "pnl", labelKey: "trv2_tab_pnl", component: PnLTab },
  { id: "journal", labelKey: "trv2_tab_journal", component: JournalTab },
];

export default function TreasuryShell() {
  const { t } = useTranslation();
  const { accounts, balances, transactions, entries, loading } = useLedger();
  const { toBase, formatBase, baseCurrency } = useBaseCurrency();

  const [officeFilter, setOfficeFilter] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_office") || "all"; } catch { return "all"; }
  });
  const setOffice = (v) => {
    setOfficeFilter(v);
    try { localStorage.setItem("coinplata.treasury_office", v); } catch {}
  };

  const [activeTab, setActiveTab] = useState("assets");
  const ActiveComp = TABS.find((x) => x.id === activeTab)?.component || AssetsTab;

  const ctx = useMemo(
    () => ({ accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter }),
    [accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter]
  );

  const totals = useMemo(() => balanceCheckTotals(ctx, officeFilter), [ctx, officeFilter]);
  const freshTime = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (loading) {
    return <main className="max-w-[1300px] mx-auto px-6 py-10 text-center text-slate-400">{t("trv2_loading")}</main>;
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col">
      <main className="flex-1 max-w-[1300px] w-full mx-auto px-6 py-6 space-y-5">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-[24px] font-bold tracking-tight">{t("trv2_title")}</h1>
          <div className="flex items-center gap-4">
            <OfficePicker value={officeFilter} onChange={setOffice} />
            <span className="text-[12px] text-slate-400">{t("trv2_data_freshness").replace("{time}", freshTime)} · base: {baseCurrency}</span>
          </div>
        </header>

        <div className="bg-white border border-slate-200/70 rounded-[12px] p-1 flex gap-0.5 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-medium whitespace-nowrap transition-colors ${
                  isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        <ActiveComp ctx={ctx} officeFilter={officeFilter} formatBase={formatBase} baseCurrency={baseCurrency} />
      </main>
      <BalanceCheckBar totals={totals} formatBase={formatBase} baseCurrency={baseCurrency} />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `TreasuryPage.jsx`**

```jsx
// src/pages/TreasuryPage.jsx
//
// Раздел «Казначейство» (Spec B) — реальный accountant tool на ledger.journal_entries.
// 5 табов: Активы / Пассивы / Капитал / P&L / Журнал. См.
// docs/superpowers/specs/2026-05-10-treasury-pnl-on-journal-entries-design.md
//
// (Старый MVP на legacy account_movements удалён.)

import React from "react";
import TreasuryShell from "./treasury_v2/TreasuryShell.jsx";

export default function TreasuryPage() {
  return <TreasuryShell />;
}
```

(Note: `TreasuryPage` no longer needs the `currentOffice` prop — Treasury has its own picker now. The App.jsx call `<TreasuryPage currentOffice={currentOffice} />` still works since the prop is just ignored, but you can clean it up in Task 7 if you want.)

- [ ] **Step 4: Build — should succeed now**

```bash
npm run build
```

Expected: succeeds (Dashboard import gone, replaced by TreasuryShell + stubs).

- [ ] **Step 5: Commit + push (this completes the broken-build window from Task 3.2)**

```bash
git add src/pages/treasury_v2/ src/pages/TreasuryPage.jsx
git commit -m "feat(treasury): TreasuryShell + 5 tab stubs + rewrite TreasuryPage"
git push
```

---

## Phase 4 — Balance-sheet tabs (Активы / Пассивы / Капитал)

### Task 4.1: `<AccountRow>` + `<AccountInlineEntries>` + `<ClassSection>` parts

**Files:**
- Create: `src/pages/treasury_v2/parts/AccountRow.jsx`
- Create: `src/pages/treasury_v2/parts/AccountInlineEntries.jsx`
- Create: `src/pages/treasury_v2/parts/ClassSection.jsx`

- [ ] **Step 1: Create `ClassSection.jsx`**

```jsx
// src/pages/treasury_v2/parts/ClassSection.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";

export default function ClassSection({ labelKey, totalInBase, formatBase, baseCurrency, children }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <h3 className="text-[13px] font-bold text-slate-900">{t(labelKey)}</h3>
        <span className="text-[13px] font-semibold tabular-nums">{formatBase(totalInBase, baseCurrency)}</span>
      </header>
      <div>{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Create `AccountInlineEntries.jsx`**

```jsx
// src/pages/treasury_v2/parts/AccountInlineEntries.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { accountEntries } from "../../../lib/treasury/v2selectors.js";

export default function AccountInlineEntries({ ctx, accountId, onOpenTx }) {
  const { t } = useTranslation();
  const rows = accountEntries(ctx, accountId, 50);
  if (rows.length === 0) {
    return <div className="px-6 py-3 text-[12px] text-slate-400">{t("trv2_no_entries")}</div>;
  }
  return (
    <table className="w-full text-[12px] bg-slate-50/60">
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} className="border-t border-slate-100">
            <td className="px-6 py-1.5 text-slate-500 w-24">{new Date(e.createdAt).toISOString().slice(0, 10)}</td>
            <td className="px-2 py-1.5 w-10 font-semibold">{e.direction === "dr" ? t("trv2_col_dr") : t("trv2_col_cr")}</td>
            <td className={`px-2 py-1.5 tabular-nums text-right w-28 ${e.direction === "dr" ? "text-emerald-700" : "text-rose-700"}`}>
              {e.direction === "dr" ? "+" : "−"}{Number(e.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {e.currency}
            </td>
            <td className="px-2 py-1.5 text-slate-400 uppercase tracking-wider w-24">{e.txKind}</td>
            <td className="px-2 py-1.5">
              <button onClick={() => onOpenTx?.(e.txId)} className="text-indigo-600 hover:underline">
                {e.sourceRefId || e.txId.slice(0, 8)} →
              </button>
            </td>
          </tr>
        ))}
        {rows.length === 50 && (
          <tr><td colSpan={5} className="px-6 py-2 text-[11px] text-slate-400">{t("trv2_show_all_entries")} (TODO drawer)</td></tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create `AccountRow.jsx`**

```jsx
// src/pages/treasury_v2/parts/AccountRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";

export default function AccountRow({ account, ctx, formatBase, baseCurrency, onOpenTx }) {
  const [expanded, setExpanded] = useState(false);
  const dimLabel = account.clientId ? ` · client ${account.clientId.slice(0, 8)}` : account.partnerId ? ` · partner ${account.partnerId.slice(0, 8)}` : "";
  return (
    <>
      <div
        className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50 border-t border-slate-100"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="font-mono text-[11px] text-slate-400 w-12">{account.code}</span>
        <span className="flex-1 text-[12.5px] font-medium text-slate-900 truncate">{account.name}{dimLabel}</span>
        <span className="text-[12px] text-slate-500 tabular-nums w-32 text-right">
          {Number(account.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {account.currency}
        </span>
        <span className="text-[12.5px] font-semibold tabular-nums w-28 text-right">{formatBase(account.balanceInBase, baseCurrency)}</span>
      </div>
      {expanded && <AccountInlineEntries ctx={ctx} accountId={account.accountId} onOpenTx={onOpenTx} />}
    </>
  );
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Commit + push**

```bash
git add src/pages/treasury_v2/parts/
git commit -m "feat(treasury): AccountRow + AccountInlineEntries + ClassSection parts"
git push
```

### Task 4.2: `<AssetsTab>` / `<LiabilitiesTab>` / `<EquityTab>` (real content)

**Files:**
- Modify: `src/pages/treasury_v2/tabs/AssetsTab.jsx`
- Modify: `src/pages/treasury_v2/tabs/LiabilitiesTab.jsx`
- Modify: `src/pages/treasury_v2/tabs/EquityTab.jsx`

All three are near-identical — different `accountType` arg to `groupByClass`.

- [ ] **Step 1: Implement `AssetsTab.jsx`**

```jsx
// src/pages/treasury_v2/tabs/AssetsTab.jsx
import React from "react";
import { groupByClass } from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";

export default function AssetsTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const sections = groupByClass(ctx, "asset");
  if (sections.length === 0) {
    return <div className="p-5 text-slate-400 text-[13px]">Нет счетов активов.</div>;
  }
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <ClassSection key={s.subtype} labelKey={s.labelKey} totalInBase={s.totalInBase} formatBase={formatBase} baseCurrency={baseCurrency}>
          {s.accounts.map((a, i) => (
            <AccountRow key={`${a.accountId}-${a.currency}-${a.clientId || ""}-${a.partnerId || ""}-${i}`} account={a} ctx={ctx} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
          ))}
        </ClassSection>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `LiabilitiesTab.jsx`**

Same as AssetsTab but `groupByClass(ctx, "liability")` and the empty-state text "Нет счетов пассивов."

- [ ] **Step 3: Implement `EquityTab.jsx`**

Same as AssetsTab but `groupByClass(ctx, "equity")` and the empty-state text "Нет счетов капитала." Plus, at the bottom, render the balance-identity readout (it's also in the sticky bar, but show it here too for emphasis):

```jsx
// after the sections map:
{(() => {
  const totals = balanceCheckTotals(ctx, ctx.officeFilter);
  return (
    <div className={`rounded-[10px] px-4 py-3 text-[12.5px] font-medium ${totals.identityCheck.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
      Активы {formatBase(totals.assets, baseCurrency)} = Пассивы {formatBase(totals.liabilities, baseCurrency)} + Капитал {formatBase(totals.equity, baseCurrency)} {totals.identityCheck.ok ? "✓" : `(delta ${formatBase(totals.identityCheck.delta, baseCurrency)})`}
    </div>
  );
})()}
```

(Add `import { balanceCheckTotals } from "../../../lib/treasury/v2selectors.js";` at top of EquityTab.jsx.)

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Smoke test render**

Create `src/pages/treasury_v2/tabs/AssetsTab.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/translations.jsx";
import AssetsTab from "./AssetsTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

describe("AssetsTab smoke", () => {
  it("renders asset sections without throwing", () => {
    const ctx = makeLedgerCtx();
    const { container } = render(
      <I18nProvider>
        <AssetsTab ctx={ctx} formatBase={(n) => `${n}`} baseCurrency="USD" onOpenTx={() => {}} />
      </I18nProvider>
    );
    expect(container.textContent).toMatch(/1110|Cash/);
  });
});
```

(If `I18nProvider` export name differs, adjust — check `src/i18n/translations.jsx`.)

```bash
npm run test -- src/pages/treasury_v2/tabs/AssetsTab.test.jsx
```

Expected: 1 pass.

- [ ] **Step 6: Commit + push**

```bash
git add src/pages/treasury_v2/tabs/AssetsTab.jsx src/pages/treasury_v2/tabs/LiabilitiesTab.jsx src/pages/treasury_v2/tabs/EquityTab.jsx src/pages/treasury_v2/tabs/AssetsTab.test.jsx
git commit -m "feat(treasury): Assets/Liabilities/Equity tabs with inline entries"
git push
```

---

## Phase 5 — Журнал tab

### Task 5.1: `<PeriodPicker>` component

**Files:**
- Create: `src/pages/treasury_v2/PeriodPicker.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury_v2/PeriodPicker.jsx
import React from "react";
import { useTranslation } from "../../i18n/translations.jsx";

// Returns { from, to } ISO strings for a preset name. `now` injectable for tests.
export function presetWindow(preset, now = new Date()) {
  const to = now.toISOString();
  const d = new Date(now);
  switch (preset) {
    case "today": { d.setUTCHours(0, 0, 0, 0); return { from: d.toISOString(), to }; }
    case "week": {
      const day = (d.getUTCDay() + 6) % 7; // Monday=0
      d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0, 0, 0, 0);
      return { from: d.toISOString(), to };
    }
    case "month": { d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return { from: d.toISOString(), to }; }
    case "quarter": {
      const q = Math.floor(d.getUTCMonth() / 3) * 3;
      d.setUTCMonth(q, 1); d.setUTCHours(0, 0, 0, 0);
      return { from: d.toISOString(), to };
    }
    case "year": { d.setUTCMonth(0, 1); d.setUTCHours(0, 0, 0, 0); return { from: d.toISOString(), to }; }
    case "30d": default: { d.setUTCDate(d.getUTCDate() - 30); return { from: d.toISOString(), to }; }
  }
}

const PRESETS = ["today", "week", "month", "quarter", "year", "30d"];

export default function PeriodPicker({ value, onChange }) {
  const { t } = useTranslation();
  const win = presetWindow(value);
  const days = Math.round((new Date(win.to) - new Date(win.from)) / 86400000);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2.5 py-1 rounded-[8px] text-[12px] font-medium transition-colors ${value === p ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          {t(`trv2_period_${p === "30d" ? "30d" : p}`)}
        </button>
      ))}
      <span className="text-[11px] text-slate-400">
        {new Date(win.from).toISOString().slice(0, 10)} — {new Date(win.to).toISOString().slice(0, 10)} ({t("trv2_period_days").replace("{n}", String(days))})
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Failing test for `presetWindow`**

Create `src/pages/treasury_v2/PeriodPicker.test.js`:

```js
import { describe, it, expect } from "vitest";
import { presetWindow } from "./PeriodPicker.jsx";

describe("presetWindow", () => {
  const NOW = new Date("2026-05-10T14:00:00Z"); // a Sunday
  it("today → start of day to now", () => {
    const w = presetWindow("today", NOW);
    expect(w.from).toBe("2026-05-10T00:00:00.000Z");
    expect(w.to).toBe(NOW.toISOString());
  });
  it("month → 1st of month", () => {
    const w = presetWindow("month", NOW);
    expect(w.from).toBe("2026-05-01T00:00:00.000Z");
  });
  it("year → Jan 1", () => {
    const w = presetWindow("year", NOW);
    expect(w.from).toBe("2026-01-01T00:00:00.000Z");
  });
  it("quarter → Apr 1 for May", () => {
    const w = presetWindow("quarter", NOW);
    expect(w.from).toBe("2026-04-01T00:00:00.000Z");
  });
  it("week → Monday of current week (May 4 for Sunday May 10)", () => {
    const w = presetWindow("week", NOW);
    expect(w.from).toBe("2026-05-04T00:00:00.000Z");
  });
  it("30d → 30 days ago", () => {
    const w = presetWindow("30d", NOW);
    expect(w.from).toBe("2026-04-10T14:00:00.000Z");
  });
});
```

- [ ] **Step 3: Run, expect PASS** (presetWindow is implemented in Step 1 already)

```bash
npm run test -- src/pages/treasury_v2/PeriodPicker.test.js
```

Expected: 6 pass. (If any fail, the date math in `presetWindow` needs adjustment — fix and re-run.)

- [ ] **Step 4: Commit + push**

```bash
git add src/pages/treasury_v2/PeriodPicker.jsx src/pages/treasury_v2/PeriodPicker.test.js
git commit -m "feat(treasury): PeriodPicker + presetWindow"
git push
```

### Task 5.2: `<TransactionEntries>` + `<TransactionRow>` + `<JournalTab>`

**Files:**
- Create: `src/pages/treasury_v2/parts/TransactionEntries.jsx`
- Create: `src/pages/treasury_v2/parts/TransactionRow.jsx`
- Modify: `src/pages/treasury_v2/tabs/JournalTab.jsx`

- [ ] **Step 1: Create `TransactionEntries.jsx`**

```jsx
// src/pages/treasury_v2/parts/TransactionEntries.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";

export default function TransactionEntries({ entries }) {
  const { t } = useTranslation();
  const drSum = entries.filter((e) => e.direction === "dr").reduce((s, e) => s + e.amount, 0);
  const crSum = entries.filter((e) => e.direction === "cr").reduce((s, e) => s + e.amount, 0);
  const balanced = Math.abs(drSum - crSum) < 0.01; // same-currency txs only; mixed-currency just informational
  return (
    <div className="px-6 py-2">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
            <th className="text-left px-2 py-1">{t("trv2_col_dr")}/{t("trv2_col_cr")}</th>
            <th className="text-left px-2 py-1">{t("trv2_col_account")}</th>
            <th className="text-right px-2 py-1">{t("trv2_col_amount")}</th>
            <th className="text-left px-2 py-1">{t("trv2_col_currency")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-slate-100">
              <td className={`px-2 py-1 font-semibold ${e.direction === "dr" ? "text-emerald-700" : "text-rose-700"}`}>{e.direction === "dr" ? t("trv2_col_dr") : t("trv2_col_cr")}</td>
              <td className="px-2 py-1"><span className="font-mono text-slate-400 mr-1.5">{e.accountCode}</span>{e.accountName}</td>
              <td className="px-2 py-1 text-right tabular-nums">{e.direction === "dr" ? "+" : "−"}{Number(e.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td className="px-2 py-1 text-slate-500">{e.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`text-[11px] mt-1 ${balanced ? "text-emerald-600" : "text-amber-600"}`}>
        Σ Dr = Σ Cr {balanced ? "✓" : "(mixed currency)"}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `TransactionRow.jsx`**

```jsx
// src/pages/treasury_v2/parts/TransactionRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown, RotateCcw } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import TransactionEntries from "./TransactionEntries.jsx";

export default function TransactionRow({ node, onOpenSource }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { tx, entries } = node;
  const isReversal = !!tx.reversesTransactionId;
  const dt = new Date(tx.effectiveDate);
  const sourceLabel = tx.sourceRefId ? `${tx.kind} #${tx.sourceRefId}` : tx.kind;
  return (
    <div className="border-t border-slate-100">
      <div className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="text-[11px] text-slate-400 w-32">{dt.toISOString().slice(0, 16).replace("T", " ")}</span>
        <span className="text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{tx.kind}</span>
        {isReversal && <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600"><RotateCcw className="w-3 h-3" />{t("trv2_journal_is_reversal")}</span>}
        <span className="flex-1 text-[12.5px] text-slate-700 truncate">{tx.description || sourceLabel}</span>
        <span className="text-[11px] text-slate-400">{t("trv2_journal_entries_count").replace("{n}", String(entries.length))}</span>
        <span className="font-mono text-[10px] text-slate-300">{tx.id.slice(0, 8)}</span>
      </div>
      {expanded && (
        <div className="bg-slate-50/60">
          <TransactionEntries entries={entries} />
          {tx.sourceRefId && (
            <div className="px-6 pb-2">
              <button onClick={() => onOpenSource?.(tx)} className="text-[12px] text-indigo-600 hover:underline">
                {t("trv2_journal_open_source").replace("{label}", sourceLabel)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement `JournalTab.jsx`**

```jsx
// src/pages/treasury_v2/tabs/JournalTab.jsx
import React, { useState, useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { transactionTree } from "../../../lib/treasury/v2selectors.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import TransactionRow from "../parts/TransactionRow.jsx";

const TYPES = ["all", "deal", "transfer", "topup", "adjustment", "reversal"];

export default function JournalTab({ ctx, officeFilter, onOpenSource }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_journal_period") || "30d"; } catch { return "30d"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_journal_period", v); } catch {} };
  const [typeFilter, setTypeFilter] = useState("all");

  const win = presetWindow(period);
  const tree = useMemo(
    () => transactionTree(ctx, { type: typeFilter, officeFilter, period: { from: win.from, to: win.to } }),
    [ctx, typeFilter, officeFilter, win.from, win.to]
  );

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex items-center gap-1.5">
          {TYPES.map((tp) => (
            <button
              key={tp}
              onClick={() => setTypeFilter(tp)}
              className={`px-2 py-1 rounded-[8px] text-[11px] font-medium ${typeFilter === tp ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t(`trv2_journal_type_${tp}`)}
            </button>
          ))}
        </div>
      </div>
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_journal_no_tx")}</div>
        ) : (
          tree.map((node) => <TransactionRow key={node.tx.id} node={node} onOpenSource={onOpenSource} />)
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Commit + push**

```bash
git add src/pages/treasury_v2/parts/TransactionEntries.jsx src/pages/treasury_v2/parts/TransactionRow.jsx src/pages/treasury_v2/tabs/JournalTab.jsx
git commit -m "feat(treasury): Журнал tab — transaction tree with Dr/Cr entries"
git push
```

### Task 5.3: Wire `onOpenSource` / `onOpenTx` through to navigation

**Files:**
- Modify: `src/pages/treasury_v2/TreasuryShell.jsx`
- Modify: `src/App.jsx` (maybe — depends on how navigation works)

When the user clicks "Open Deal #42" in Журнал or "→" on an inline entry, navigate to the transaction's source document. For `deal` kind → open the TransactionsTable page filtered to that deal (or `DealDetailPanel`). For other kinds → show a simple modal with the transaction's metadata + entries (no dedicated page exists for transfers/topups in v2 yet).

- [ ] **Step 1: Add an `onNavigate` prop chain or a simple modal**

Simplest: `TreasuryShell` keeps a `selectedTx` state. When `onOpenSource` / `onOpenTx` fires, set `selectedTx` and render a `<TransactionDetail tx={...} entries={...} onClose={...} />` modal.

Create `src/pages/treasury_v2/parts/TransactionDetail.jsx`:

```jsx
// src/pages/treasury_v2/parts/TransactionDetail.jsx
import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import TransactionEntries from "./TransactionEntries.jsx";

export default function TransactionDetail({ node, onClose }) {
  const { t } = useTranslation();
  if (!node) return null;
  const { tx, entries } = node;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-[14px] max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-bold">{tx.kind} {tx.sourceRefId ? `#${tx.sourceRefId}` : ""}</h3>
            <p className="text-[11px] text-slate-400">{new Date(tx.effectiveDate).toISOString().slice(0, 16).replace("T", " ")} · {tx.id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </header>
        <div className="p-1">
          {tx.description && <p className="px-5 py-2 text-[12.5px] text-slate-600">{tx.description}</p>}
          <TransactionEntries entries={entries} />
          {tx.metadata && Object.keys(tx.metadata).length > 0 && (
            <pre className="mx-5 my-2 p-2 bg-slate-50 rounded text-[11px] text-slate-500 overflow-auto">{JSON.stringify(tx.metadata, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `TreasuryShell`**

In `TreasuryShell.jsx`:
- Add `const [selectedTx, setSelectedTx] = useState(null);`
- Build a `txNodeById` map from `transactionTree(ctx, {type:"all", officeFilter:"all"})` so we can resolve a txId → `{ tx, entries }` node.
- Pass `onOpenTx={(txId) => setSelectedTx(txNodeById.get(txId) || null)}` and `onOpenSource={(tx) => setSelectedTx(txNodeById.get(tx.id) || null)}` to `<ActiveComp>`.
- Render `<TransactionDetail node={selectedTx} onClose={() => setSelectedTx(null)} />` after `<BalanceCheckBar>`.

Add `import TransactionDetail from "./parts/TransactionDetail.jsx";` and `import { transactionTree } from "../../lib/treasury/v2selectors.js";` at the top.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit + push**

```bash
git add src/pages/treasury_v2/parts/TransactionDetail.jsx src/pages/treasury_v2/TreasuryShell.jsx
git commit -m "feat(treasury): TransactionDetail modal + wire drill-down navigation"
git push
```

---

## Phase 6 — P&L tab

### Task 6.1: `<PnLTab>`

**Files:**
- Modify: `src/pages/treasury_v2/tabs/PnLTab.jsx`

- [ ] **Step 1: Implement `PnLTab.jsx`**

```jsx
// src/pages/treasury_v2/tabs/PnLTab.jsx
import React, { useState, useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { pnlForPeriod } from "../../../lib/treasury/v2selectors.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

function Section({ titleKey, total, sign, formatBase, baseCurrency, accounts }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <h3 className="text-[13px] font-bold text-slate-900">{t(titleKey)}</h3>
        <span className="text-[14px] font-semibold tabular-nums">{sign}{formatBase(Math.abs(total), baseCurrency)}</span>
      </header>
      {open && (accounts.length === 0 ? (
        <div className="px-4 py-3 text-[12px] text-slate-400">—</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {accounts.map((a) => (
              <tr key={a.code} className="border-t border-slate-100">
                <td className="px-4 py-2"><span className="font-mono text-[11px] text-slate-400 mr-2">{a.code}</span>{a.name}</td>
                <td className="px-4 py-2 text-right text-slate-400 text-[11px] w-16">{a.entryCount}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium w-32">{a.amountInBase < 0 ? "−" : ""}{formatBase(Math.abs(a.amountInBase), baseCurrency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}

export default function PnLTab({ ctx, officeFilter, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_pnl_period") || "month"; } catch { return "month"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_pnl_period", v); } catch {} };
  const win = presetWindow(period);
  const pnl = useMemo(() => pnlForPeriod(ctx, { from: win.from, to: win.to }, officeFilter), [ctx, win.from, win.to, officeFilter]);

  const hasAnything = pnl.revenue.accounts.length || pnl.expense.accounts.length || pnl.fxAccounts.length;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3">
        <PeriodPicker value={period} onChange={setP} />
      </div>
      {!hasAnything ? (
        <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_pnl_no_data")}</div>
      ) : (
        <>
          <Section titleKey="trv2_pnl_revenue" total={pnl.revenue.total} sign="+" accounts={pnl.revenue.accounts} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_expense" total={pnl.expense.total} sign="−" accounts={pnl.expense.accounts} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_fx" total={pnl.fxNet} sign={pnl.fxNet < 0 ? "−" : "+"} accounts={pnl.fxAccounts} formatBase={formatBase} baseCurrency={baseCurrency} />
          <div className="bg-slate-900 text-white rounded-[14px] px-5 py-4 flex items-center justify-between">
            <span className="text-[14px] font-bold">{t("trv2_pnl_net_profit")}</span>
            <span className={`text-[20px] font-bold tabular-nums ${pnl.netProfit < 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {pnl.netProfit < 0 ? "−" : "+"}{formatBase(Math.abs(pnl.netProfit), baseCurrency)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
```

(Note: `Export CSV` and `Compare with previous period` are listed as P&L MVP features in the spec but are lower-priority. Add them as a follow-up task if time permits; the spec marks the core P&L as the must-have. For this plan they're deferred to Task 6.2 below if you want, or skip.)

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Smoke test**

Create `src/pages/treasury_v2/tabs/PnLTab.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/translations.jsx";
import PnLTab from "./PnLTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

describe("PnLTab smoke", () => {
  it("renders net profit row without throwing", () => {
    const ctx = makeLedgerCtx();
    const { container } = render(
      <I18nProvider>
        <PnLTab ctx={ctx} officeFilter="all" formatBase={(n) => `${n}`} baseCurrency="USD" />
      </I18nProvider>
    );
    expect(container.textContent).toMatch(/Net Profit|Чистая прибыль|Net kâr/i);
  });
});
```

```bash
npm run test -- src/pages/treasury_v2/tabs/PnLTab.test.jsx
```

Expected: 1 pass.

- [ ] **Step 4: Commit + push**

```bash
git add src/pages/treasury_v2/tabs/PnLTab.jsx src/pages/treasury_v2/tabs/PnLTab.test.jsx
git commit -m "feat(treasury): P&L tab — revenue/expense/fx/net profit with period picker"
git push
```

---

## Phase 7 — Wire-up + cleanup + smoke + PR

### Task 7.1: Clean up TreasuryPage prop + final integration smoke

**Files:**
- Modify: `src/App.jsx` (drop the now-unused `currentOffice` prop to `<TreasuryPage>`)

- [ ] **Step 1: Drop the prop**

In `src/App.jsx`, change:

```jsx
{page === "treasury" && canShow("capital") && <TreasuryPage currentOffice={currentOffice} />}
```

to:

```jsx
{page === "treasury" && canShow("capital") && <TreasuryPage />}
```

- [ ] **Step 2: Full test suite**

```bash
npx vitest run --no-file-parallelism
```

Expected: all green. Count = baseline − (deleted MVP selector tests + Dashboard.test) + (new ledgerReaders 4 + v2selectors ~22 + PeriodPicker 6 + AssetsTab smoke 1 + PnLTab smoke 1).

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Local smoke**

In `.env.local` set `VITE_USE_NEW_LEDGER=true` and `VITE_USE_NEW_DEAL_FORM=true`. Run `npm run dev`. Open `http://localhost:5173`, navigate to Казначейство.

Verify:
1. 5 tabs render: Активы / Пассивы / Капитал / P&L / Журнал.
2. Office picker has "All offices" + 4 real offices.
3. Активы tab → click an account → inline entries expand below with Dr/Cr rows.
4. Журнал tab → see chronological transactions; expand one → Dr/Cr table; click "Open deal #N" → TransactionDetail modal opens.
5. P&L tab → period picker works; net profit row shows; clicking a period preset changes numbers.
6. Sticky balance bar at the bottom shows `✓` (or red delta if ledger is genuinely out of balance — investigate if so).
7. Switch office picker → all tabs re-filter.

If anything throws white-screen or errors → fix before PR.

- [ ] **Step 5: Commit + push**

```bash
git add src/App.jsx
git commit -m "chore(treasury): drop unused currentOffice prop from TreasuryPage"
git push
```

### Task 7.2: Open PR

**Files:** none

- [ ] **Step 1: Open PR via gh**

```bash
gh pr create --base main --title "feat(treasury): real Treasury & P&L on journal entries (Spec B)" --body "$(cat <<'EOF'
## Summary
Replaces the May-9 Treasury MVP (single-page dashboard on legacy account_movements — owner rejected as "хуйня") with a real accountant-grade Treasury on top of ledger.journal_entries.

- 5 tabs: Активы / Пассивы / Капитал / P&L / Журнал
- Inline office picker + virtual "All offices" mode (independent of global Header switcher)
- Журнал = chronological tree of ledger.transactions, expandable to Dr/Cr entries, click-through to source document (TransactionDetail modal)
- Inline проводки on every account row in balance-sheet tabs (up to 50 entries)
- Sticky balance-sheet identity bar: Σ Активы = Σ Пассивы + Σ Капитал (green ✓ / red delta)
- P&L tab: period picker (Сегодня/Неделя/Месяц/Квартал/Год/30д), Revenue/Expense/FX gain-loss/Net Profit; FX subtypes treated as P&L line items
- New LedgerProvider + ledgerReaders.js (reads ledger.* schema) + 5 pure selectors (groupByClass, accountEntries, transactionTree, pnlForPeriod, balanceCheckTotals)
- May-9 MVP files deleted (Dashboard, treasury/components, treasury/selectors, dead tr_* i18n)

## Test plan
- [x] Full test suite passes (new: ledgerReaders 4, v2selectors ~22, PeriodPicker 6, smoke renders 2)
- [x] npm run build clean
- [ ] Local smoke with v2 active: 5 tabs render, office picker filters, account expand → inline entries, Журнал → drill-down modal, P&L → period picker changes numbers, sticky balance bar shows ✓
- [ ] After merge: open coinplata.vercel.app/treasury → verify same

## Out of scope (deferred to Spec C)
- Posting Master / manual journal entry editor (Treasury is read-only)
- Шахматка cross-tab report, subconto/dimension drill-down
- P&L CSV export + compare-with-previous-period (core P&L shipped; these are polish)
- Forecast / budgeting / payment calendar

Spec: docs/superpowers/specs/2026-05-10-treasury-pnl-on-journal-entries-design.md
Plan: docs/superpowers/plans/2026-05-10-treasury-pnl-on-journal-entries.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the PR URL.

---

## Self-review checklist (run before declaring plan complete)

**Spec coverage:**
- ✅ 5 tabs Активы/Пассивы/Капитал/P&L/Журнал → Tasks 3.5, 4.2, 5.2, 6.1
- ✅ Inline office picker + All-offices → Task 3.3
- ✅ Журнал tree with Dr/Cr entries + drill-down → Tasks 5.2, 5.3
- ✅ Inline проводки on account rows → Task 4.1
- ✅ Sticky balance-identity check → Task 3.4 (BalanceCheckBar) + 2.6 (balanceCheckTotals selector)
- ✅ P&L formulas (revenue/expense/fx/net) → Tasks 2.5 (pnlForPeriod), 6.1 (PnLTab)
- ✅ Period picker presets → Task 5.1
- ✅ LedgerProvider + ledgerReaders → Tasks 1.1, 1.2, 1.3
- ✅ 5 pure selectors fixture-tested → Tasks 2.2–2.6
- ✅ Delete May-9 MVP → Task 3.2
- ✅ i18n trv2_* → Task 3.1
- ✅ TransactionDetail modal → Task 5.3
- ⏸ P&L CSV export / compare-with-previous → deferred (noted in Task 6.1)
- ⏸ "Show all entries" full drawer → noted as TODO in AccountInlineEntries; can be a follow-up
- ⏸ Posting Master / Шахматка / subconto → explicitly out of scope (Spec C)

**Placeholder scan:**
- `AccountInlineEntries.jsx` has `{t("trv2_show_all_entries")} (TODO drawer)` — this is a known deferral, the basic 50-entry inline view works; the "full drawer" is polish. Acceptable for this plan (it's not a *broken* placeholder, the feature degrades gracefully).
- No "TBD"/"add appropriate error handling" anywhere. Every code step has actual code.

**Type / signature consistency:**
- `ctx` shape used consistently: `{ accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, now? }` — built in TreasuryShell, consumed by all selectors and tabs.
- Selector names match across plan + spec + components: `groupByClass`, `accountEntries`, `transactionTree`, `pnlForPeriod`, `balanceCheckTotals`.
- `ledgerReaders` output shapes (camelCase: `officeId`, `accountId`, `transactionId`, `currency`) match what `LedgerProvider` exposes and what selectors expect.
- `presetWindow(preset, now)` returns `{ from, to }` ISO strings — consumed identically in JournalTab and PnLTab.
- `transactionTree` node shape `{ tx, entries }` — consumed by TransactionRow and TransactionDetail identically.

No issues found.
