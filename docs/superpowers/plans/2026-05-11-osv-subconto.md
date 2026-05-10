# ОСВ Subconto Rows Implementation Plan (Spec C.6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** In the ОСВ (Treasury → Обороты → ОСВ), add a per-client/partner subconto breakdown under dimensioned accounts — each subconto sub-row shows opening / Σ Dr / Σ Cr / closing and expands to that subconto's journal entries for the period.

**Architecture:** `trialBalance` gains a `dims` field per account row (per-(account, clientId/partnerId) metrics; `dims: null` for plain accounts; account metrics = Σ dims for dimensioned ones). `TrialBalanceTable`'s internal `AccountRow` expands dimensioned accounts into `TrialBalanceSubcontoRow`s (new) instead of the entry table. No DB changes, no new i18n.

**Tech Stack:** Vite + React 18 + Tailwind; Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-11-osv-subconto-design.md`.

---

## Phase 0
- [ ] `git branch --show-current` → `feat/osv-subconto`. `npx vitest run --no-file-parallelism` → green (37 files / 326 tests). `npm run build` → ok.

---

## Task 1: `trialBalance` — `dims` per account (TDD)

**Files:** Modify `src/lib/treasury/v2selectors.js` (`trialBalance`). Test: extend `src/lib/treasury/v2selectors.test.js`.

- [ ] **Step 1: Failing test** — append to `src/lib/treasury/v2selectors.test.js` (inside the existing `describe("trialBalance")` or a new one):

```js
describe("trialBalance — subconto dims", () => {
  it("a dimensioned account carries a dims array; account metrics = Σ dims; a plain account has dims: null", () => {
    const ctx = makeLedgerCtx();
    const tb = trialBalance(ctx, { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }, "all");
    const all = tb.classes.flatMap((c) => c.accounts);
    const cl = all.find((a) => a.accountId === "ac_cust_liab_usd");
    expect(Array.isArray(cl.dims)).toBe(true);
    expect(cl.dims.length).toBe(1);
    const d = cl.dims[0];
    expect(d.clientId).toBe("client-1");
    // fixture: balance −500; client-1 entries je4 (cr 100, eff 2026-05-10) + je5 (dr 95, eff 2026-05-10).
    // normalSign for a Cr-normal liability: cr → +amount, dr → −amount. sinceFrom (eff ≥ 2026-01-01) = +100 − 95 = +5.
    // opening = −500 − (+5) = −505; afterTo (eff > 2026-12-31) = 0 → closing = −500.
    // Dr turnover (eff in period) = 95 (je5); Cr turnover = 100 (je4).
    expect(d).toMatchObject({ opening: -505, debitTurnover: 95, creditTurnover: 100, closing: -500 });
    // account-level = Σ dims (one dim here)
    expect(cl).toMatchObject({ opening: -505, debitTurnover: 95, creditTurnover: 100, closing: -500 });
    const cash = all.find((a) => a.accountId === "ac_cash_usd_mark");
    expect(cash.dims).toBe(null);
  });
  it("multiple subconto: dims sorted by |closingInBase| desc, account metrics sum them", () => {
    const ctx = makeLedgerCtx({
      balances: [
        { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-1", partnerId: null, balance: -300 },
        { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-2", partnerId: null, balance: -1200 },
      ],
    });
    const cl = trialBalance(ctx, { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }, "all").classes.flatMap((c) => c.accounts).find((a) => a.accountId === "ac_cust_liab_usd");
    expect(cl.dims.map((x) => x.clientId)).toEqual(["client-2", "client-1"]); // |closing| 1200 > closing for client-1 (which also has je4/je5 turnover; |its closing| < 1200)
    // account closing = Σ dim closings
    expect(cl.closing).toBeCloseTo(cl.dims.reduce((s, x) => s + x.closing, 0), 6);
  });
});
```

  (Compute the expected numbers by hand from `makeLedgerCtx`. If a number is off, fix the *expectation* to match the fixture math — but the test must still assert the *structure* (dims array, account = Σ dims, plain = null). Note: `client-1`'s closing in the 2nd test = `−300 − (sinceFrom for client-1 = +100 −95 = +5)`? No — wait, in the override, the balance for client-1 is `−300`, and its entries je4/je5 still apply → its `closing` = `−300 − afterTo`; `afterTo` (eff > 2026-12-31) = 0 → closing = `−300`. `client-2` has balance `−1200`, no entries → closing = `−1200`. `|−1200| > |−300|` → client-2 first. ✓. Account closing = `−300 + −1200 = −1500`. ✓ Use these.)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/treasury/v2selectors.test.js -t "subconto dims"` → FAIL (`cl.dims` is undefined).

- [ ] **Step 3: Implement** — in `trialBalance`, alongside the existing per-account `agg` and `curBal`, add per-(accountId, dimKey) tracking and emit `dims`. Replace the body from `const agg = new Map();` through the row push with:

```js
  const agg = new Map();        // accId -> { sinceFrom, afterTo, drTurn, crTurn }
  const aggDim = new Map();      // `${accId}|${dimKey}` -> { sinceFrom, afterTo, drTurn, crTurn }
  const dimMeta = new Map();     // `${accId}|${dimKey}` -> { clientId, partnerId }
  for (const e of entries) {
    const acc = accById.get(e.accountId);
    if (!acc || !passesOfficeFilter(acc, officeFilter)) continue;
    const ts = txEffMs.get(e.transactionId);
    if (ts == null) continue;
    const s = normalSign(acc, e);
    const rec = agg.get(e.accountId) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
    const dimKey = e.clientId || e.partnerId || "";
    const dk = `${e.accountId}|${dimKey}`;
    const drec = aggDim.get(dk) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
    if (!dimMeta.has(dk)) dimMeta.set(dk, { clientId: e.clientId || null, partnerId: e.partnerId || null });
    if (ts >= fromMs) { rec.sinceFrom += s; drec.sinceFrom += s; }
    if (ts > toMs) { rec.afterTo += s; drec.afterTo += s; }
    if (ts >= fromMs && ts <= toMs) {
      if (e.direction === "dr") { rec.drTurn += Number(e.amount); drec.drTurn += Number(e.amount); }
      else { rec.crTurn += Number(e.amount); drec.crTurn += Number(e.amount); }
    }
    agg.set(e.accountId, rec);
    aggDim.set(dk, drec);
  }
  // per-(accId,dimKey) current balance
  const curBalDim = new Map();
  for (const b of balances) {
    const dimKey = b.clientId || b.partnerId || "";
    const dk = `${b.accountId}|${dimKey}`;
    curBalDim.set(dk, (curBalDim.get(dk) || 0) + Number(b.balance));
    if (!dimMeta.has(dk)) dimMeta.set(dk, { clientId: b.clientId || null, partnerId: b.partnerId || null });
  }

  const byClass = new Map();
  const candidates = new Set([...curBal.keys(), ...agg.keys()]);
  for (const accId of candidates) {
    const acc = accById.get(accId);
    if (!acc || !passesOfficeFilter(acc, officeFilter)) continue;
    const ccy = acc.currency;
    const isDimensioned = acc.clientDimRequired || acc.partnerDimRequired
      || [...curBalDim.keys(), ...aggDim.keys()].some((k) => k.startsWith(`${accId}|`) && !k.endsWith("|"));
    let dims = null;
    if (isDimensioned) {
      const dimKeys = new Set();
      for (const k of curBalDim.keys()) if (k.startsWith(`${accId}|`)) dimKeys.add(k.slice(accId.length + 1));
      for (const k of aggDim.keys()) if (k.startsWith(`${accId}|`)) dimKeys.add(k.slice(accId.length + 1));
      dimKeys.delete(""); // the "no-dim" bucket isn't a subconto row
      dims = [...dimKeys].map((dimKey) => {
        const dk = `${accId}|${dimKey}`;
        const cb = curBalDim.get(dk) || 0;
        const dr = aggDim.get(dk) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
        const opening = cb - dr.sinceFrom, closing = cb - dr.afterTo;
        const meta = dimMeta.get(dk) || { clientId: null, partnerId: null };
        return {
          clientId: meta.clientId, partnerId: meta.partnerId,
          opening, debitTurnover: dr.drTurn, creditTurnover: dr.crTurn, closing,
          openingInBase: toBase(opening, ccy) || 0,
          debitTurnoverInBase: toBase(dr.drTurn, ccy) || 0,
          creditTurnoverInBase: toBase(dr.crTurn, ccy) || 0,
          closingInBase: toBase(closing, ccy) || 0,
        };
      }).sort((a, b) => Math.abs(b.closingInBase) - Math.abs(a.closingInBase));
    }
    // account-level metrics: Σ dims when dimensioned (guarantees consistency), else from `agg`/`curBal`
    let opening, closing, debitTurnover, creditTurnover;
    if (dims) {
      opening = dims.reduce((s, d) => s + d.opening, 0);
      closing = dims.reduce((s, d) => s + d.closing, 0);
      debitTurnover = dims.reduce((s, d) => s + d.debitTurnover, 0);
      creditTurnover = dims.reduce((s, d) => s + d.creditTurnover, 0);
    } else {
      const cur = curBal.get(accId) || 0;
      const rec = agg.get(accId) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
      opening = cur - rec.sinceFrom; closing = cur - rec.afterTo;
      debitTurnover = rec.drTurn; creditTurnover = rec.crTurn;
    }
    if (Math.abs(opening) < 1e-9 && Math.abs(closing) < 1e-9 && debitTurnover === 0 && creditTurnover === 0 && (!dims || dims.length === 0)) continue;
    const row = {
      accountId: accId, code: acc.code, name: acc.name, type: acc.type, subtype: acc.subtype || null, currency: ccy,
      opening, debitTurnover, creditTurnover, closing,
      openingInBase: toBase(opening, ccy) || 0,
      debitTurnoverInBase: toBase(debitTurnover, ccy) || 0,
      creditTurnoverInBase: toBase(creditTurnover, ccy) || 0,
      closingInBase: toBase(closing, ccy) || 0,
      dims,
    };
    const cls = byClass.get(acc.type) || {
      type: acc.type, labelKey: TB_CLASS_LABEL_KEYS[acc.type] || "trv2_to_class_other", accounts: [],
      subtotalInBase: { opening: 0, debitTurnover: 0, creditTurnover: 0, closing: 0 },
    };
    cls.accounts.push(row);
    cls.subtotalInBase.opening += row.openingInBase;
    cls.subtotalInBase.debitTurnover += row.debitTurnoverInBase;
    cls.subtotalInBase.creditTurnover += row.creditTurnoverInBase;
    cls.subtotalInBase.closing += row.closingInBase;
    byClass.set(acc.type, cls);
  }
```

  (Leave the rest of `trialBalance` — the `for (const cls of byClass.values()) cls.accounts.sort(...)`, the `classes` array, the grand-total/`check` computation, the `return` — unchanged. The `dims: null` rows are unchanged from before. NOTE: a dimensioned account with no dim rows at all and no entries would now have `dims: []` and be skipped by the all-zero check — fine.)

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/treasury/v2selectors.test.js` → all green (including the existing trialBalance tests — the `dims` addition doesn't change their assertions; the `groupByClass — nested dims` test from C.4 is unrelated).
- [ ] **Step 5: Commit:**
```bash
git add src/lib/treasury/v2selectors.js src/lib/treasury/v2selectors.test.js
git commit -m "feat(treasury): trialBalance — per-subconto dims on dimensioned account rows"
git push
```

---

## Task 2: `TrialBalanceSubcontoRow` + wire into `TrialBalanceTable` (+ test)

**Files:** Create `src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.jsx`. Modify `src/pages/treasury_v2/parts/TrialBalanceTable.jsx`. Test: `src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.test.jsx` (new); extend `src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx`.

- [ ] **Step 1: Create `TrialBalanceSubcontoRow.jsx`:**

```jsx
// src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.jsx
// One subconto sub-row under a dimensioned account in the ОСВ: resolved name + the
// account's 4 period metrics for this client/partner; expandable to its dim-filtered entries.
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";

const num = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function TrialBalanceSubcontoRow({ ctx, accountId, dim, window: win, onOpenTx }) {
  const [open, setOpen] = useState(false);
  const id = dim.clientId || dim.partnerId || null;
  const kind = dim.clientId ? "client" : dim.partnerId ? "partner" : "—";
  const name = ctx && ctx.counterpartyName ? ctx.counterpartyName(id) : (id ? String(id).slice(0, 8) : "—");
  const filter = dim.clientId ? { clientId: dim.clientId } : dim.partnerId ? { partnerId: dim.partnerId } : null;
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-100/60 cursor-pointer bg-slate-50/50" onClick={() => setOpen((v) => !v)}>
        <td className="px-2 py-1.5 w-6 text-slate-400 pl-6">{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</td>
        <td className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 w-14">{kind}</td>
        <td className="px-2 py-1.5 text-[12px] text-slate-700">{name}</td>
        <td className="px-2 py-1.5 text-slate-400 w-12" />
        <td className="px-2 py-1.5 text-right tabular-nums w-28">{num(dim.opening)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-emerald-700">{num(dim.debitTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-rose-700">{num(dim.creditTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 font-medium">{num(dim.closing)}</td>
      </tr>
      {open && (
        <tr><td colSpan={8} className="p-0"><AccountInlineEntries ctx={ctx} accountId={accountId} period={win} dim={filter} onOpenTx={onOpenTx} /></td></tr>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire into `TrialBalanceTable.jsx`** — read the file; in its internal `AccountRow` sub-component, change the expanded block so that `row.dims` non-null → render `<TrialBalanceSubcontoRow>` per dim instead of `<AccountInlineEntries>`. The expanded `<tr>` currently is:

```jsx
      {open && (
        <tr><td colSpan={8} className="p-0"><AccountInlineEntries ctx={ctx} accountId={row.accountId} period={win} onOpenTx={onOpenTx} /></td></tr>
      )}
```

Change to (and add `import TrialBalanceSubcontoRow from "./TrialBalanceSubcontoRow.jsx";` at the top of `TrialBalanceTable.jsx`):

```jsx
      {open && (row.dims
        ? (row.dims.length === 0
            ? <tr><td colSpan={8} className="px-6 py-2 text-[11px] text-slate-400">—</td></tr>
            : row.dims.map((d, i) => (
                <TrialBalanceSubcontoRow key={`${d.clientId || ""}-${d.partnerId || ""}-${i}`} ctx={ctx} accountId={row.accountId} dim={d} window={win} onOpenTx={onOpenTx} />
              )))
        : <tr><td colSpan={8} className="p-0"><AccountInlineEntries ctx={ctx} accountId={row.accountId} period={win} onOpenTx={onOpenTx} /></td></tr>)}
```

(`AccountRow` in `TrialBalanceTable` already receives `ctx`, `window: win`, `row`, `onOpenTx`. If `row` doesn't have `dims` because the data came from somewhere that didn't set it — `row.dims` is `undefined`, falsy → falls to the entry-table branch → unchanged behaviour. Good.)

- [ ] **Step 3: Build** — `npm run build` → ok.

- [ ] **Step 4: Tests** — create `src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import TrialBalanceSubcontoRow from "./TrialBalanceSubcontoRow.jsx";

const ctx = {
  counterpartyName: (id) => ({ "client-1": "Иван Петров" }[id] || String(id).slice(0, 8)),
  entries: [{ id: "e1", accountId: "ac_cl", transactionId: "tx1", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null, createdAt: "2026-05-10T00:00:00Z" }],
  transactions: [{ id: "tx1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "deal", sourceRefId: "D1" }],
};
const win = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
const dim = { clientId: "client-1", partnerId: null, opening: -500, debitTurnover: 95, creditTurnover: 100, closing: -505, openingInBase: -500, debitTurnoverInBase: 95, creditTurnoverInBase: 100, closingInBase: -505 };

function wrap(ui) { return render(<table><tbody>{ui}</tbody></table>); }

describe("TrialBalanceSubcontoRow", () => {
  it("renders the resolved name and the 4 metric cells", () => {
    wrap(<TrialBalanceSubcontoRow ctx={ctx} accountId="ac_cl" dim={dim} window={win} onOpenTx={() => {}} />);
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("client")).toBeInTheDocument();
  });
  it("expands to the dim-filtered entries", () => {
    const { container } = wrap(<TrialBalanceSubcontoRow ctx={ctx} accountId="ac_cl" dim={dim} window={win} onOpenTx={() => {}} />);
    expect(container.textContent).not.toContain("D1");
    fireEvent.click(screen.getByText("Иван Петров"));
    expect(container.textContent).toContain("D1");
  });
});
```

And extend `src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx` — add a dimensioned account to its `ctx` (a `2110` customer-liability account, a `ledger.balances` row with `clientId`, and an entry with `clientId`), add `counterpartyName` to `ctx`, and add a test: rendering and expanding the `2110` row shows the subconto sub-row with the resolved name (not the raw entry table). Adapt to whatever `ctx` shape the existing `TrialBalanceTable.test.jsx` uses (it currently builds a small `ctx` with `accounts`/`transactions`/`entries`/`balances`/`toBase`/`baseCurrency`/`officeFilter` — add `counterpartyName` and a dimensioned account + matching balance/entry rows).

- [ ] **Step 5: Run, expect PASS** — `npx vitest run src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.test.jsx src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx` → green.
- [ ] **Step 6: Commit:**
```bash
git add src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.jsx src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.test.jsx src/pages/treasury_v2/parts/TrialBalanceTable.jsx src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx
git commit -m "feat(treasury): ОСВ — subconto sub-rows under dimensioned accounts"
git push
```

---

## Phase 7 — Final + PR
- [ ] `npx vitest run --no-file-parallelism` → green; `npm run build` → clean.
- [ ] Local smoke (manual): Treasury → Обороты → ОСВ → expand a customer-liability account → subconto rows with client names + their opening/Dr/Cr/closing → expand a subconto → its entries for the period.
- [ ] PR: `gh pr create --base main --head feat/osv-subconto --title "feat(treasury): ОСВ subconto rows (Spec C.6)" --body "Per-client/partner breakdown under dimensioned accounts in the Оборотно-сальдовая ведомость: a dimensioned account expands to subconto sub-rows (resolved name + opening/Σ Dr/Σ Cr/closing), each expandable to its dim-filtered journal entries for the period. \`trialBalance\` now emits \`dims\` per account row (account metrics = Σ dims); \`TrialBalanceSubcontoRow\` is the new sub-row; \`TrialBalanceTable\` renders it for \`row.dims\`. No DB changes, no new i18n. Out of scope: subconto in the Шахматка; subconto rows in the ОСВ CSV. \n\n- [x] Full suite green; \`npm run build\` clean\n\nSpec: docs/superpowers/specs/2026-05-11-osv-subconto-design.md / Plan: docs/superpowers/plans/2026-05-11-osv-subconto.md\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"`

---

## Self-review
**Spec coverage:** `dims` per account in `trialBalance` (per-dim opening/Dr/Cr/closing, account = Σ dims, plain = null, sorted) → Task 1. `TrialBalanceSubcontoRow` + `TrialBalanceTable` wiring (dimensioned → sub-rows, plain → entries) → Task 2. Tests → Tasks 1, 2. CSV stays account-level / Шахматка subconto deferred → noted. **Type consistency:** `dims` item `{ clientId, partnerId, opening, debitTurnover, creditTurnover, closing, *InBase }` (Task 1 ↔ `TrialBalanceSubcontoRow`); `AccountInlineEntries` props `{ ctx, accountId, period, dim, onOpenTx }` (existing). **Placeholders:** the test "compute the expected numbers by hand" is a real instruction with the math worked out inline; no TODOs.
