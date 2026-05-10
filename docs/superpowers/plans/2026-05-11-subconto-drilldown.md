# Subconto Drill-Down Implementation Plan (Spec C.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Treasury balance-sheet tabs, replace truncated-UUID dimension rows with a proper subconto breakdown — resolve `client_id`/`partner_id` to names, group an account's dimension balances under one collapsible parent row, and let each subconto row drill into its journal entries.

**Architecture:** New `loadCounterpartyNames()` reader (clients+partners → `Map<uuid,name>`) wired into `LedgerProvider` as a `counterpartyName(id)` function in `ctx`; `groupByClass` returns one row per account with a nested `dims` array (or `dims: null` for plain accounts); `accountEntries` gains an optional `dim` filter; UI: `AccountRow` renders subconto child rows for dimensioned accounts (new `AccountSubcontoRow` component), each expandable to dim-filtered `AccountInlineEntries`. No DB changes, no new permission.

**Tech Stack:** Vite + React 18 + Tailwind 3; Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-11-subconto-drilldown-design.md`.

---

## Phase 0 — Branch + baseline

### Task 0.1
- [ ] `git branch --show-current` → `feat/subconto-drilldown`.
- [ ] `npx vitest run --no-file-parallelism` → all green (33 files / 308 tests as of the P&L merge). Note counts.
- [ ] `npm run build` → succeeds (pre-existing chunk warning is fine).

---

## Task 1: `loadCounterpartyNames` + `LedgerProvider` + `TreasuryShell` ctx

**Files:** Modify `src/lib/ledgerReaders.js`, `src/store/ledger.jsx`, `src/pages/treasury_v2/TreasuryShell.jsx`. Test: add to `src/lib/ledgerReaders.test.js`.

`ledgerReaders.js` already `import { supabase, isSupabaseConfigured } from "./supabase.js"` and has readers that `throw new Error(...)` on `error`. `public.clients (id, nickname, full_name, …)` and `public.partners (id, name, …)` are the source tables (verified prod 2026-05-11).

- [ ] **Step 1: Failing test** — append to `src/lib/ledgerReaders.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

// (If the file already mocks ./supabase.js, reuse that mock; otherwise add this near the top of the file
//  ONCE — do NOT duplicate an existing vi.mock for the same module.)
// The pattern below assumes a controllable mock. If the existing file uses a different mock shape,
// adapt: the goal is `supabase.from(table).select(cols)` returning `{ data, error }`.

describe("loadCounterpartyNames", () => {
  it("merges clients (nickname||full_name) and partners (name) into one Map; falls back to short uuid", async () => {
    // Arrange a supabase mock where from("clients").select(...) and from("partners").select(...) resolve.
    // If the test file already has a configurable supabase mock, set its responses; otherwise see NOTE below.
    const { loadCounterpartyNames } = await import("./ledgerReaders.js");
    // ...assert: map.get("c1") === "Иван", map.get("c2") === "No Nick" (full_name fallback),
    //            map.get("c3") === "00000000" (id-prefix fallback when both null), map.get("p1") === "OTC Acme".
  });
});
```

  NOTE: `ledgerReaders.test.js` may or may not already have a `vi.mock("./supabase.js", ...)`. Inspect it first. If it has a configurable mock (e.g. a `fromMock` you can set per-table), use it. If not, write a self-contained test file `src/lib/ledgerReaders.counterparty.test.js` instead:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const tableResponses = {};
vi.mock("./supabase.js", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (t) => ({ select: () => Promise.resolve(tableResponses[t] || { data: [], error: null }) }) },
}));

import { loadCounterpartyNames } from "./ledgerReaders.js";

describe("loadCounterpartyNames", () => {
  beforeEach(() => { Object.keys(tableResponses).forEach((k) => delete tableResponses[k]); });
  it("merges clients (nickname||full_name) and partners (name); id-prefix fallback", async () => {
    tableResponses.clients = { data: [
      { id: "c1", nickname: "Иван", full_name: "Иван Петров" },
      { id: "c2", nickname: null, full_name: "No Nick" },
      { id: "00000000-0000-4000-8000-000000000001", nickname: null, full_name: null },
    ], error: null };
    tableResponses.partners = { data: [{ id: "p1", name: "OTC Acme" }], error: null };
    const m = await loadCounterpartyNames();
    expect(m.get("c1")).toBe("Иван");
    expect(m.get("c2")).toBe("No Nick");
    expect(m.get("00000000-0000-4000-8000-000000000001")).toBe("00000000");
    expect(m.get("p1")).toBe("OTC Acme");
  });
  it("throws on a supabase error", async () => {
    tableResponses.clients = { data: null, error: { message: "boom" } };
    await expect(loadCounterpartyNames()).rejects.toThrow(/boom/);
  });
});
```

  (Prefer the self-contained file unless the existing `ledgerReaders.test.js` already has a clean reusable supabase mock.)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run <that test file>` → FAIL (`loadCounterpartyNames` not exported).

- [ ] **Step 3: Implement `loadCounterpartyNames`** — in `src/lib/ledgerReaders.js`, add (anywhere among the exported readers):

```js
// Resolve client/partner ids → display names. Reads public.clients / public.partners
// (different uuid spaces, so a single combined Map is unambiguous).
export async function loadCounterpartyNames() {
  if (!isSupabaseConfigured) return new Map();
  const m = new Map();
  const cRes = await supabase.from("clients").select("id, nickname, full_name");
  if (cRes.error) throw new Error(`loadCounterpartyNames clients: ${cRes.error.message}`);
  for (const c of cRes.data || []) m.set(c.id, c.nickname || c.full_name || String(c.id).slice(0, 8));
  const pRes = await supabase.from("partners").select("id, name");
  if (pRes.error) throw new Error(`loadCounterpartyNames partners: ${pRes.error.message}`);
  for (const p of pRes.data || []) m.set(p.id, p.name || String(p.id).slice(0, 8));
  return m;
}
```

- [ ] **Step 4: Wire `LedgerProvider`** — in `src/store/ledger.jsx`: import `loadCounterpartyNames`; add `const [cpNames, setCpNames] = useState(() => new Map());`; in `reload`'s `Promise.all`, add `loadCounterpartyNames().catch(() => new Map())` as a 5th item and `setCpNames(names)`; add a `counterpartyName` callback and put it (plus, harmlessly, the raw map) in the `value`:

```js
  // inside reload(): const [accs, bals, txs, jes, names] = await Promise.all([ ... , loadCounterpartyNames().catch(() => new Map()) ]);  then  setCpNames(names);
  const counterpartyName = useCallback((id) => cpNames.get(id) || (id ? String(id).slice(0, 8) : "—"), [cpNames]);
  const value = useMemo(
    () => ({ accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso, counterpartyName }),
    [accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso, counterpartyName]
  );
```

- [ ] **Step 5: Wire `TreasuryShell`** — in `src/pages/treasury_v2/TreasuryShell.jsx`: add `counterpartyName` to the `const { ... } = useLedger();` destructure, and add it to the `ctx` `useMemo` object + its dep array (the `ctx` object that's passed to every tab as `ctx={...}`).

- [ ] **Step 6: Run + build** — `npx vitest run <the counterparty test file>` → PASS; `npm run build` → succeeds.
- [ ] **Step 7: Commit:**
```bash
git add src/lib/ledgerReaders.js src/lib/ledgerReaders.counterparty.test.js src/store/ledger.jsx src/pages/treasury_v2/TreasuryShell.jsx
git commit -m "feat(treasury): loadCounterpartyNames + counterpartyName in ledger ctx"
git push
```

---

## Task 2: `groupByClass` nested `dims` + `accountEntries` dim filter

**Files:** Modify `src/lib/treasury/v2selectors.js`. Test: update `src/lib/treasury/v2selectors.test.js` (the existing `groupByClass` tests assert the OLD flat-row shape — update them).

- [ ] **Step 1: Rewrite `groupByClass`** — replace it with:

```js
export function groupByClass(ctx, accountType) {
  const { accounts, balances, toBase, officeFilter } = ctx;
  const bySubtype = new Map();
  for (const acc of accounts) {
    if (acc.type !== accountType) continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const rowsForAccount = balances.filter((b) => b.accountId === acc.id);
    const isDimensioned = acc.clientDimRequired || acc.partnerDimRequired || rowsForAccount.some((b) => b.clientId || b.partnerId);
    let balance = 0, balanceInBase = 0;
    const dimList = [];
    for (const b of rowsForAccount) {
      const inBase = toBase(b.balance, b.currency) || 0;
      balance += Number(b.balance) || 0;
      balanceInBase += inBase;
      dimList.push({ clientId: b.clientId || null, partnerId: b.partnerId || null, balance: Number(b.balance) || 0, balanceInBase: inBase });
    }
    const dims = isDimensioned ? dimList.slice().sort((x, y) => Math.abs(y.balanceInBase) - Math.abs(x.balanceInBase)) : null;
    const subtype = acc.subtype || "other";
    const sect = bySubtype.get(subtype) || { subtype, labelKey: SUBTYPE_LABEL_KEYS[subtype] || "trv2_subtype_other", accounts: [], totalInBase: 0 };
    sect.accounts.push({ accountId: acc.id, code: acc.code, name: acc.name, currency: acc.currency, balance, balanceInBase, dims });
    sect.totalInBase += balanceInBase;
    bySubtype.set(subtype, sect);
  }
  return [...bySubtype.values()].sort((a, b) => b.totalInBase - a.totalInBase);
}
```

(This removes the old `balByKey` dead code and the per-dim flat rows. `dims` is `null` for a plain account; an array — possibly empty if the account has no balance rows yet — for a dimensioned one.)

- [ ] **Step 2: Add the `dim` param to `accountEntries`** — change the signature to `accountEntries(ctx, accountId, limit = 50, period = null, dim = null)` and add a filter `.filter((e) => !dim || ((dim.clientId == null || e.clientId === dim.clientId) && (dim.partnerId == null || e.partnerId === dim.partnerId)))` right after the `.filter((e) => e.accountId === accountId)` line (before the period filter). Everything else unchanged.

- [ ] **Step 3: Update + extend `v2selectors.test.js` `groupByClass` tests** — find the existing `describe("groupByClass" …)` block and replace its assertions to match the new shape. Add/keep at least:

```js
describe("groupByClass — nested dims", () => {
  it("a plain account emits one row with dims: null", () => {
    const ctx = makeLedgerCtx();
    const assets = groupByClass(ctx, "asset");
    const cash = assets.flatMap((s) => s.accounts).find((a) => a.accountId === "ac_cash_usd_mark");
    expect(cash).toMatchObject({ code: "1110", balance: 11000, dims: null });
  });
  it("a dimensioned account emits one row with a dims array (one per balance dim row)", () => {
    const ctx = makeLedgerCtx();
    const liab = groupByClass(ctx, "liability");
    const cl = liab.flatMap((s) => s.accounts).find((a) => a.accountId === "ac_cust_liab_usd");
    expect(cl.balance).toBe(-500);
    expect(cl.dims).toEqual([{ clientId: "client-1", partnerId: null, balance: -500, balanceInBase: -500 }]);
  });
  it("dims sum into the account total and are sorted by |balanceInBase| desc", () => {
    const ctx = makeLedgerCtx({
      balances: [
        { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-1", partnerId: null, balance: -500 },
        { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-2", partnerId: null, balance: -1200 },
      ],
    });
    const cl = groupByClass(ctx, "liability").flatMap((s) => s.accounts).find((a) => a.accountId === "ac_cust_liab_usd");
    expect(cl.balance).toBe(-1700);
    expect(cl.dims.map((d) => d.clientId)).toEqual(["client-2", "client-1"]); // |−1200| > |−500|
  });
});

describe("accountEntries — dim filter", () => {
  it("filters entries by clientId/partnerId", () => {
    const ctx = makeLedgerCtx();
    const all = accountEntries(ctx, "ac_cust_liab_usd"); // je4 (cr 100, client-1) + je5 (dr 95, client-1)
    expect(all.length).toBe(2);
    expect(accountEntries(ctx, "ac_cust_liab_usd", 50, null, { clientId: "client-1" }).length).toBe(2);
    expect(accountEntries(ctx, "ac_cust_liab_usd", 50, null, { clientId: "client-2" }).length).toBe(0);
  });
});
```

(If the old `groupByClass` test block had assertions like `expect(row.clientId).toBe(...)` on flat rows, delete those — the flat shape is gone. If `makeLedgerCtx` is imported in this file via `import { makeLedgerCtx } from "./v2selectors.test.js"` — no, it's *defined* in this file; just use it. `groupByClass` and `accountEntries` are already imported in this file or import them.)

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/treasury/v2selectors.test.js` → all green (after updating the old assertions).
- [ ] **Step 5: Commit:**
```bash
git add src/lib/treasury/v2selectors.js src/lib/treasury/v2selectors.test.js
git commit -m "feat(treasury): groupByClass nested dims + accountEntries dim filter"
git push
```

---

## Task 3: UI — `AccountSubcontoRow` + `AccountRow` + `AccountInlineEntries` dim prop + tabs key

**Files:** Create `src/pages/treasury_v2/parts/AccountSubcontoRow.jsx`. Modify `src/pages/treasury_v2/parts/AccountRow.jsx`, `src/pages/treasury_v2/parts/AccountInlineEntries.jsx`, `src/pages/treasury_v2/tabs/AssetsTab.jsx`, `LiabilitiesTab.jsx`, `EquityTab.jsx`. Test: `src/pages/treasury_v2/parts/AccountRow.test.jsx` (new).

- [ ] **Step 1: `AccountInlineEntries` — add `dim` prop** — change `export default function AccountInlineEntries({ ctx, accountId, period, onOpenTx })` to `({ ctx, accountId, period, dim, onOpenTx })` and `const rows = accountEntries(ctx, accountId, 50, period);` to `const rows = accountEntries(ctx, accountId, 50, period, dim);`. Nothing else changes.

- [ ] **Step 2: Create `AccountSubcontoRow.jsx`:**

```jsx
// src/pages/treasury_v2/parts/AccountSubcontoRow.jsx
// One subconto (client/partner) row under a dimensioned account in the balance tabs:
// name + native balance + base balance, expandable to the dim-filtered journal entries.
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";

export default function AccountSubcontoRow({ ctx, accountId, dim, formatBase, baseCurrency, onOpenTx }) {
  const [expanded, setExpanded] = useState(false);
  const id = dim.clientId || dim.partnerId || null;
  const kind = dim.clientId ? "client" : dim.partnerId ? "partner" : "—";
  const name = ctx && ctx.counterpartyName ? ctx.counterpartyName(id) : (id ? String(id).slice(0, 8) : "—");
  const filter = dim.clientId ? { clientId: dim.clientId } : dim.partnerId ? { partnerId: dim.partnerId } : null;
  return (
    <>
      <div className="pl-9 pr-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-slate-100 border-t border-slate-100 bg-slate-50/50" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
        <span className="text-[10px] uppercase tracking-wider text-slate-400 w-12">{kind}</span>
        <span className="flex-1 text-[12px] text-slate-700 truncate">{name}</span>
        <span className="text-[11.5px] text-slate-500 tabular-nums w-32 text-right">{Number(dim.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <span className="text-[12px] font-medium tabular-nums w-28 text-right">{formatBase(dim.balanceInBase, baseCurrency)}</span>
      </div>
      {expanded && <AccountInlineEntries ctx={ctx} accountId={accountId} dim={filter} onOpenTx={onOpenTx} />}
    </>
  );
}
```

- [ ] **Step 3: Rewrite `AccountRow.jsx`:**

```jsx
// src/pages/treasury_v2/parts/AccountRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";
import AccountSubcontoRow from "./AccountSubcontoRow.jsx";

export default function AccountRow({ account, ctx, formatBase, baseCurrency, onOpenTx }) {
  const [expanded, setExpanded] = useState(false);
  const dims = account.dims; // null for a plain account; array for a dimensioned one
  return (
    <>
      <div className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50 border-t border-slate-100" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="font-mono text-[11px] text-slate-400 w-12">{account.code}</span>
        <span className="flex-1 text-[12.5px] font-medium text-slate-900 truncate">{account.name}</span>
        <span className="text-[12px] text-slate-500 tabular-nums w-32 text-right">{Number(account.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {account.currency}</span>
        <span className="text-[12.5px] font-semibold tabular-nums w-28 text-right">{formatBase(account.balanceInBase, baseCurrency)}</span>
      </div>
      {expanded && (dims
        ? (dims.length === 0
            ? <div className="pl-9 pr-4 py-2 text-[11px] text-slate-400">—</div>
            : dims.map((d, i) => (
                <AccountSubcontoRow key={`${d.clientId || ""}-${d.partnerId || ""}-${i}`} ctx={ctx} accountId={account.accountId} dim={d} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
              )))
        : <AccountInlineEntries ctx={ctx} accountId={account.accountId} onOpenTx={onOpenTx} />)}
    </>
  );
}
```

- [ ] **Step 4: Tabs — simplify the `AccountRow` key** — in `src/pages/treasury_v2/tabs/AssetsTab.jsx`, `LiabilitiesTab.jsx`, `EquityTab.jsx`, change `key={`${a.accountId}-${a.currency}-${a.clientId || ""}-${a.partnerId || ""}`}` to `key={`${a.accountId}-${a.currency}`}`. Nothing else changes in those files.

- [ ] **Step 5: Build** — `npm run build` → succeeds.

- [ ] **Step 6: Render test** — create `src/pages/treasury_v2/parts/AccountRow.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import AccountRow from "./AccountRow.jsx";

const ctx = {
  counterpartyName: (id) => ({ "client-1": "Иван Петров", "client-2": "ООО Ромашка" }[id] || String(id).slice(0, 8)),
  entries: [
    { id: "e1", accountId: "ac_cl", transactionId: "tx1", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null, createdAt: "2026-05-10T00:00:00Z" },
    { id: "e2", accountId: "ac_cl", transactionId: "tx1", direction: "dr", amount: 30, currency: "USD", clientId: "client-2", partnerId: null, createdAt: "2026-05-10T00:00:00Z" },
    { id: "e3", accountId: "ac_cash", transactionId: "tx1", direction: "dr", amount: 500, currency: "USD", clientId: null, partnerId: null, createdAt: "2026-05-10T00:00:00Z" },
  ],
  transactions: [{ id: "tx1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "deal", sourceRefId: "D1" }],
};
const fmt = (n) => `$${n}`;

describe("AccountRow — subconto drill-down", () => {
  it("a dimensioned account expands to subconto rows with resolved names", () => {
    const account = { accountId: "ac_cl", code: "2110", name: "Customer Liab USD", currency: "USD", balance: -130, balanceInBase: -130, dims: [
      { clientId: "client-1", partnerId: null, balance: -100, balanceInBase: -100 },
      { clientId: "client-2", partnerId: null, balance: -30, balanceInBase: -30 },
    ] };
    render(<AccountRow account={account} ctx={ctx} formatBase={fmt} baseCurrency="USD" onOpenTx={() => {}} />);
    fireEvent.click(screen.getByText("Customer Liab USD"));
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("ООО Ромашка")).toBeInTheDocument();
    // expanding a subconto row shows that subconto's entries (e1 only — clientId client-1)
    fireEvent.click(screen.getByText("Иван Петров"));
    expect(screen.getByText("D1 →")).toBeInTheDocument();
  });
  it("a plain account expands straight to its entries", () => {
    const account = { accountId: "ac_cash", code: "1110", name: "Cash USD", currency: "USD", balance: 500, balanceInBase: 500, dims: null };
    render(<AccountRow account={account} ctx={ctx} formatBase={fmt} baseCurrency="USD" onOpenTx={() => {}} />);
    fireEvent.click(screen.getByText("Cash USD"));
    expect(screen.getByText("D1 →")).toBeInTheDocument();
    expect(screen.queryByText("Иван Петров")).toBeNull();
  });
});
```

  (NOTE: `AccountInlineEntries` renders the source-ref button as `{e.sourceRefId || e.txId.slice(0,8)} →` → `"D1 →"`. If that exact text assertion is brittle, use `screen.getByText(/D1/)` instead — but `getByText` with a substring regex can match multiple elements; if so, narrow to `screen.getByRole("button", { name: "D1 →" })`.)

- [ ] **Step 7: Run, expect PASS** — `npx vitest run src/pages/treasury_v2/parts/AccountRow.test.jsx` → green.
- [ ] **Step 8: Commit:**
```bash
git add src/pages/treasury_v2/parts/AccountSubcontoRow.jsx src/pages/treasury_v2/parts/AccountRow.jsx src/pages/treasury_v2/parts/AccountRow.test.jsx src/pages/treasury_v2/parts/AccountInlineEntries.jsx src/pages/treasury_v2/tabs/AssetsTab.jsx src/pages/treasury_v2/tabs/LiabilitiesTab.jsx src/pages/treasury_v2/tabs/EquityTab.jsx
git commit -m "feat(treasury): subconto drill-down in balance tabs (AccountRow + AccountSubcontoRow)"
git push
```

---

## Phase 7 — Final + PR

### Task 7.1
- [ ] `npx vitest run --no-file-parallelism` → all green. New since baseline: loadCounterpartyNames 2, groupByClass-nested ~3, accountEntries-dim 1, AccountRow 2.
- [ ] `npm run build` → clean.
- [ ] **Local smoke (manual — note in PR if skipped):** `/treasury` → Пассивы tab → a customer-liability account row; expand → subconto rows with client names + balances; expand a subconto row → its journal entries; a plain account (e.g. cash) still expands straight to its entries.
- [ ] **Open PR:**
```bash
gh pr create --base main --head feat/subconto-drilldown --title "feat(treasury): subconto drill-down in balance tabs (Spec C.4)" --body "$(cat <<'EOF'
## Summary
Treasury balance tabs (Активы / Пассивы / Капитал) now show a proper subconto breakdown instead of flat truncated-UUID dim rows (Spec C.4):
- New `loadCounterpartyNames()` reader (public.clients nickname/full_name + public.partners name) → `counterpartyName(id)` in the ledger ctx.
- `groupByClass` returns one row per account with a nested `dims` array (`dims: null` for plain accounts).
- `accountEntries` gained an optional `dim` (clientId/partnerId) filter.
- UI: a dimensioned account expands to subconto child rows (resolved name + balance); each subconto row expands to its dim-filtered journal entries (new `AccountSubcontoRow`); plain accounts unchanged. No DB changes, no new permission.

## Test plan
- [x] Full suite green (new: loadCounterpartyNames 2, groupByClass-nested ~3, accountEntries-dim 1, AccountRow 2; updated the old flat-shape groupByClass assertions)
- [x] `npm run build` clean
- [ ] Local smoke: customer-liability account → subconto rows with names → entries; plain account unchanged

## Out of scope (Spec C.5+)
Subconto breakdown in ОСВ / Шахматка; per-line subconto picker in Posting Master; editing clients/partners from Treasury.

Spec: `docs/superpowers/specs/2026-05-11-subconto-drilldown-design.md`
Plan: `docs/superpowers/plans/2026-05-11-subconto-drilldown.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist

**Spec coverage:**
- ✅ `loadCounterpartyNames` (clients nickname/full_name + partners name → Map; short-uuid fallback) → Task 1
- ✅ `LedgerProvider` exposes `counterpartyName(id)`; `TreasuryShell` puts it in `ctx` → Task 1
- ✅ `groupByClass` nested `dims` (null for plain, array sorted by |balanceInBase| for dimensioned, sums into account total) → Task 2
- ✅ `accountEntries` optional `dim` filter → Task 2
- ✅ `AccountInlineEntries` `dim` prop → Task 3
- ✅ `AccountSubcontoRow` (name + balances, expand → dim-filtered entries) → Task 3
- ✅ `AccountRow` renders subconto rows for `dims`, entries for plain → Task 3
- ✅ tabs `key` simplification → Task 3
- ✅ tests (loadCounterpartyNames, groupByClass nested, accountEntries dim, AccountRow render — and updating the old flat-shape assertions) → Tasks 1, 2, 3
- ⏸ ОСВ/Шахматка subconto, Posting Master picker — deferred (Out of scope & PR body)

**Type/name consistency:** `counterpartyName(id) → string` (Task 1 ↔ `AccountSubcontoRow`). `groupByClass` rows `{ accountId, code, name, currency, balance, balanceInBase, dims }`; `dims` items `{ clientId, partnerId, balance, balanceInBase }` (Task 2 ↔ `AccountRow`/`AccountSubcontoRow`). `accountEntries(ctx, accountId, limit=50, period=null, dim=null)` where `dim={clientId?,partnerId?}` (Task 2 ↔ `AccountInlineEntries` ↔ `AccountSubcontoRow`). `AccountInlineEntries` props `{ ctx, accountId, period, dim, onOpenTx }`.

**Placeholder scan:** Task 1 Step 1 offers two test-file shapes (reuse existing supabase mock vs. a self-contained file) with a clear "prefer the self-contained file unless…" — that's a justified branch, not a placeholder; the self-contained version is fully written. Otherwise every code step is complete and every command has expected output.

## Execution Handoff

(See the skill's handoff prompt — choose subagent-driven or inline before starting Phase 0.)
