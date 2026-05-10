# Posting Master — Per-Line Counterparty (Subconto) Picker Implementation Plan (Spec C.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make customer/partner-liability accounts postable in Posting Master by adding a per-line counterparty `<select>` that appears when the line's account requires a subconto dimension; the chosen client/partner is sent as the leg's `client_id`/`partner_id`.

**Architecture:** `loadCounterpartyNames` returns `{ map, clients, partners }` (per-kind lists); `LedgerProvider` exposes `counterpartyOptions(kind)`; `accountsForCurrency` stops filtering dimensioned accounts; `validatePostingDraft` requires a client/partner on lines whose account needs one; `PostingTab` gains a "Counterparty" column. Backend (`create_manual_entry` RPC, `rpcCreateManualEntryV2`, `buildManualEntryPayload`) is already ready. No DB changes.

**Tech Stack:** Vite + React 18 + Tailwind 3; Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-11-posting-master-subconto-design.md`.

---

## Phase 0 — Branch + baseline

### Task 0.1
- [ ] `git branch --show-current` → `feat/posting-subconto`.
- [ ] `npx vitest run --no-file-parallelism` → all green (36 files / 325 tests as of the Info-page merge). Note counts.
- [ ] `npm run build` → succeeds.

---

## Task 1: `loadCounterpartyNames` → `{ map, clients, partners }`; `LedgerProvider` + `TreasuryShell`

**Files:** Modify `src/lib/ledgerReaders.js`, `src/lib/ledgerReaders.counterparty.test.js`, `src/store/ledger.jsx`, `src/pages/treasury_v2/TreasuryShell.jsx`.

- [ ] **Step 1: Update the test** — replace `src/lib/ledgerReaders.counterparty.test.js`'s body assertions with the new shape:

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

  it("returns { map, clients, partners } — clients use nickname||full_name, partners use name, id-prefix fallback", async () => {
    tableResponses.clients = { data: [
      { id: "c1", nickname: "Иван", full_name: "Иван Петров" },
      { id: "c2", nickname: null, full_name: "No Nick" },
      { id: "00000000-0000-4000-8000-000000000001", nickname: null, full_name: null },
    ], error: null };
    tableResponses.partners = { data: [{ id: "p1", name: "OTC Acme" }], error: null };
    const r = await loadCounterpartyNames();
    expect(r.map.get("c1")).toBe("Иван");
    expect(r.map.get("c2")).toBe("No Nick");
    expect(r.map.get("00000000-0000-4000-8000-000000000001")).toBe("00000000");
    expect(r.map.get("p1")).toBe("OTC Acme");
    expect(r.clients).toEqual([
      { id: "c1", name: "Иван" },
      { id: "c2", name: "No Nick" },
      { id: "00000000-0000-4000-8000-000000000001", name: "00000000" },
    ]);
    expect(r.partners).toEqual([{ id: "p1", name: "OTC Acme" }]);
  });

  it("throws on a supabase error", async () => {
    tableResponses.clients = { data: null, error: { message: "boom" } };
    await expect(loadCounterpartyNames()).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/ledgerReaders.counterparty.test.js` → FAIL (`r.map` is undefined — current `loadCounterpartyNames` returns a bare `Map`).

- [ ] **Step 3: Implement** — in `src/lib/ledgerReaders.js`, replace `loadCounterpartyNames` with:

```js
// Resolve client/partner ids → display names. Reads public.clients / public.partners.
// Returns { map: Map<uuid,name> (combined), clients: [{id,name}], partners: [{id,name}] }.
export async function loadCounterpartyNames() {
  const empty = { map: new Map(), clients: [], partners: [] };
  if (!isSupabaseConfigured) return empty;
  const map = new Map();
  const cRes = await supabase.from("clients").select("id, nickname, full_name");
  if (cRes.error) throw new Error(`loadCounterpartyNames clients: ${cRes.error.message}`);
  const clients = (cRes.data || []).map((c) => {
    const name = c.nickname || c.full_name || String(c.id).slice(0, 8);
    map.set(c.id, name);
    return { id: c.id, name };
  });
  const pRes = await supabase.from("partners").select("id, name");
  if (pRes.error) throw new Error(`loadCounterpartyNames partners: ${pRes.error.message}`);
  const partners = (pRes.data || []).map((p) => {
    const name = p.name || String(p.id).slice(0, 8);
    map.set(p.id, name);
    return { id: p.id, name };
  });
  return { map, clients, partners };
}
```

- [ ] **Step 4: Wire `LedgerProvider`** — in `src/store/ledger.jsx`:
  - `const [cpData, setCpData] = useState(() => ({ map: new Map(), clients: [], partners: [] }));` (replace the existing `const [cpNames, setCpNames] = useState(() => new Map());`).
  - In `reload`'s `Promise.all`, the 5th item becomes `loadCounterpartyNames().catch(() => ({ map: new Map(), clients: [], partners: [] }))`, and `setCpNames(names)` becomes `setCpData(names)`.
  - `counterpartyName` becomes `useCallback((id) => cpData.map.get(id) || (id ? String(id).slice(0, 8) : "—"), [cpData])`.
  - Add `const counterpartyOptions = useCallback((kind) => (kind === "partner" ? cpData.partners : cpData.clients), [cpData]);`.
  - Add both `counterpartyName` (already there) and `counterpartyOptions` to the `value` `useMemo` object + its dep array (`counterpartyOptions` is new in deps).

- [ ] **Step 5: Wire `TreasuryShell`** — in `src/pages/treasury_v2/TreasuryShell.jsx`: add `counterpartyOptions` to the `useLedger()` destructure and to the `ctx` `useMemo` object + dep array.

- [ ] **Step 6: Run + build** — `npx vitest run src/lib/ledgerReaders.counterparty.test.js` → PASS; `npm run build` → succeeds.
- [ ] **Step 7: Commit:**
```bash
git add src/lib/ledgerReaders.js src/lib/ledgerReaders.counterparty.test.js src/store/ledger.jsx src/pages/treasury_v2/TreasuryShell.jsx
git commit -m "feat(treasury): counterpartyOptions(kind) — per-kind client/partner lists in ctx"
git push
```

---

## Task 2: `postingEntry.js` — allow dimensioned accounts; require their counterparty

**Files:** Modify `src/lib/treasury/postingEntry.js`, `src/lib/treasury/postingEntry.test.js`, `src/pages/treasury_v2/parts/AccountPicker.test.jsx`.

- [ ] **Step 1: Update the existing tests** — in `src/lib/treasury/postingEntry.test.js`:
  - In the `accountsForCurrency` test, the assertion `expect(r).toEqual(["1110", "4010", "5010"])` becomes `expect(r).toEqual(["1110", "2110", "4010", "5010"])` (the fixture's `2110` has `clientDimRequired: true` and currency USD — now included; verify the sort order against the fixture's account order — `accountsForCurrency` preserves input order, and the fixture lists `1110, 4010, 5010, 1340, 2110, 1199` — so the USD-active-no-longer-filtered set in input order is `1110, 4010, 5010, 2110`; assert `expect(r).toContain("2110")` and `expect(r).toEqual(expect.arrayContaining(["1110","4010","5010","2110"]))` and `expect(r).not.toContain("1340")` `&& not "1199"` to be order-robust).
  - Replace the `validatePostingDraft` test `"rejects an account that requires a subconto dimension (not postable in v1)"` with: a draft with a `2110` line and no `clientId` → `r.errors.some((e) => e.code === "client_required" && e.lineId === "l2")` is `true`; the same draft with `clientId: "client-1"` added to that line → `r.errors.some((e) => e.code === "client_required")` is `false`.
  - In `src/pages/treasury_v2/parts/AccountPicker.test.jsx`, the assertion `expect(screen.queryByRole("option", { name: /2110/ })).toBeNull(); // requires a client dim` becomes `expect(screen.getByRole("option", { name: /2110/ })).toBeInTheDocument();` and update the comment.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/treasury/postingEntry.test.js src/pages/treasury_v2/parts/AccountPicker.test.jsx` → FAIL (old behaviour: `2110` filtered out; `dim_not_supported` still produced).

- [ ] **Step 3: Implement** — in `src/lib/treasury/postingEntry.js`:
  - `accountsForCurrency`: drop the dim clause →
    ```js
    export function accountsForCurrency(accounts, currency) {
      return (accounts || []).filter((a) => a.active && a.currency === currency);
    }
    ```
  - `validatePostingDraft`: in the per-line account branch, replace the `dim_not_supported` `else if`:
    ```js
        } else if (acc.clientDimRequired && !l.clientId) {
          errors.push({ code: "client_required", lineId: l.id, field: "counterparty", message: "Pick a client" });
        } else if (acc.partnerDimRequired && !l.partnerId) {
          errors.push({ code: "partner_required", lineId: l.id, field: "counterparty", message: "Pick a partner" });
        }
    ```
    (i.e. the chain is now: `if (!acc || !acc.active) account_unknown; else if (acc.currency !== d.currency) currency_mismatch; else if (acc.clientDimRequired && !l.clientId) client_required; else if (acc.partnerDimRequired && !l.partnerId) partner_required;`. `buildManualEntryPayload` is unchanged — it already spreads `clientId`/`partnerId`.)

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/treasury/postingEntry.test.js src/pages/treasury_v2/parts/AccountPicker.test.jsx` → all green.
- [ ] **Step 5: Commit:**
```bash
git add src/lib/treasury/postingEntry.js src/lib/treasury/postingEntry.test.js src/pages/treasury_v2/parts/AccountPicker.test.jsx
git commit -m "feat(treasury): postingEntry — dimensioned accounts postable, require their counterparty"
git push
```

---

## Task 3: i18n keys + `PostingTab` counterparty column (+ test)

**Files:** Modify `src/i18n/translations.jsx`, `src/pages/treasury_v2/tabs/PostingTab.jsx`, `src/pages/treasury_v2/tabs/PostingTab.test.jsx`.

- [ ] **Step 1: i18n** — in `src/i18n/translations.jsx`, after the existing `trv2_pm_col_account:` entry (or near the `trv2_pm_*` cluster — `trv2_pm_col_cr` etc.) add in each locale:
  - EN: `trv2_pm_col_counterparty: "Counterparty",` `trv2_pm_pick_counterparty: "— counterparty —",` `trv2_pm_err_counterparty: "Pick a counterparty for this account",`
  - RU: `trv2_pm_col_counterparty: "Контрагент",` `trv2_pm_pick_counterparty: "— контрагент —",` `trv2_pm_err_counterparty: "Выбери контрагента для этого счёта",`
  - TR: `trv2_pm_col_counterparty: "Karşı taraf",` `trv2_pm_pick_counterparty: "— karşı taraf —",` `trv2_pm_err_counterparty: "Bu hesap için karşı taraf seç",`

- [ ] **Step 2: Edit `PostingTab.jsx`** — read the file first. Changes:
  - `newLine()` → `{ id: \`pm${++_lineSeq}\`, accountCode: "", side: "dr", amount: "", clientId: null, partnerId: null }` (the second starter line keeps `side: "cr"`).
  - The account-picker `onChange` → `patchLine(l.id, { accountCode: code, clientId: null, partnerId: null })` (clear the dim ids on any account change).
  - Add a helper near the top of the component body: `const accFor = (code) => accByCode(code);` (already exists as `accByCode`; reuse it).
  - In the lines `<thead>`, insert a header cell `<th className="text-left px-2 py-1">{t("trv2_pm_col_counterparty")}</th>` between the account `<th>` and the Dr `<th>`. In `<tbody>`, for each row insert a `<td>` between the account picker `<td>` and the Dr `<td>`:
    ```jsx
    <td className="px-2 py-1.5">
      {(() => {
        const a = accByCode(l.accountCode);
        if (!a || (!a.clientDimRequired && !a.partnerDimRequired)) return null;
        const isPartner = !!a.partnerDimRequired;
        const opts = ctx.counterpartyOptions ? ctx.counterpartyOptions(isPartner ? "partner" : "client") : [];
        const val = isPartner ? (l.partnerId || "") : (l.clientId || "");
        const onPick = (e) => patchLine(l.id, isPartner ? { partnerId: e.target.value || null } : { clientId: e.target.value || null });
        const cpErr = lineErr(l.id, "counterparty");
        return (
          <>
            <select value={val} onChange={onPick}
              className={`min-w-0 w-full bg-slate-50 border rounded-[8px] px-2 py-1 text-[12px] outline-none ${cpErr ? "border-rose-300" : "border-slate-200"}`}>
              <option value="">{t("trv2_pm_pick_counterparty")}</option>
              {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {cpErr && <div className="text-[10px] text-rose-600 mt-0.5">{t("trv2_pm_err_counterparty")}</div>}
          </>
        );
      })()}
    </td>
    ```
    (The existing `lineErr(id, field)` helper already does `validation.errors.find(e => e.lineId === id && e.field === field)`; the new validator errors use `field: "counterparty"`, so `lineErr(l.id, "counterparty")` picks them up.)
  - The `colSpan` on the "—" empty-section / any full-width row inside the table, and the `<th className="w-8" />` for the remove column, stay; just make sure the table still has consistent column counts (account, counterparty, Dr, Cr, remove = 5).

  (If reading `PostingTab.jsx` shows the table structure differs from the spec's recollection, adapt — the invariant is: a new "Counterparty" column appears between the account and Dr columns, populated only when the line's account requires a dim, wired to `ctx.counterpartyOptions` and `patchLine`, with the `counterparty` field validation error shown beneath.)

- [ ] **Step 3: Build** — `npm run build` → succeeds.

- [ ] **Step 4: Update `PostingTab.test.jsx`** — read the file first. It mocks `ctx` (`{ accounts: ACCOUNTS }`). Add a `2110` customer-liability account to `ACCOUNTS` and `counterpartyOptions` to `ctx`:
  ```js
  // add to ACCOUNTS:
  { id: "a3", code: "2110", name: "Customer Liab USD", subtype: "customer_liab", currency: "USD", clientDimRequired: true, partnerDimRequired: false, active: true },
  // ctx becomes:
  const ctx = { accounts: ACCOUNTS, counterpartyOptions: (k) => (k === "partner" ? [{ id: "p1", name: "OTC Acme" }] : [{ id: "client-1", name: "Иван Петров" }]) };
  ```
  Then add a test:
  ```js
  it("picking a dimensioned account shows a counterparty select; the chosen client goes into the payload", async () => {
    rpcMock.mockResolvedValue("tx-1");
    render(<PostingTab ctx={ctx} />);
    const accountSelects = screen.getAllByRole("combobox").filter((el) => [...el.options].some((o) => /2110|4010/.test(o.value)));
    fireEvent.change(accountSelects[0], { target: { value: "2110" } }); // line 1 → customer_liab
    fireEvent.change(accountSelects[1], { target: { value: "4010" } }); // line 2 → spread
    const numericInputs = screen.getAllByRole("textbox").filter((el) => el.getAttribute("inputmode") === "decimal");
    fireEvent.change(numericInputs[0], { target: { value: "100" } }); // line 1 Dr
    fireEvent.change(numericInputs[3], { target: { value: "100" } }); // line 2 Cr
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "reclass" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    // not yet — line 1 needs a client
    expect(post).toBeDisabled();
    // the counterparty select for line 1 is present (its option "Иван Петров" exists)
    expect(screen.getByRole("option", { name: "Иван Петров" })).toBeInTheDocument();
    // pick the client (find the select that has the client option)
    const cpSelect = screen.getAllByRole("combobox").find((el) => [...el.options].some((o) => o.value === "client-1"));
    fireEvent.change(cpSelect, { target: { value: "client-1" } });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const payload = rpcMock.mock.calls[0][0];
    expect(payload.lines.find((l) => l.accountCode === "2110")).toMatchObject({ direction: "dr", amount: 100, clientId: "client-1" });
  });
  ```
  (`waitFor` may already be imported in this test file; if not, add it to the `@testing-library/react` import. The pre-existing PostingTab tests still pass — for non-dimensioned accounts the counterparty cell renders `null`, and the `numericInputs[0]/[3]` indexing is unchanged since the counterparty `<td>` has no `inputmode="decimal"` input. The `accountSelects` filter uses `/2110|4010/` so it still finds the two account `<select>`s in line order.)

- [ ] **Step 5: Run, expect PASS** — `npx vitest run src/pages/treasury_v2/tabs/PostingTab.test.jsx` → all green (existing + 1 new).
- [ ] **Step 6: Commit:**
```bash
git add src/i18n/translations.jsx src/pages/treasury_v2/tabs/PostingTab.jsx src/pages/treasury_v2/tabs/PostingTab.test.jsx
git commit -m "feat(treasury): Posting Master — per-line counterparty picker for dimensioned accounts"
git push
```

---

## Phase 7 — Final + PR

### Task 7.1
- [ ] `npx vitest run --no-file-parallelism` → all green.
- [ ] `npm run build` → clean.
- [ ] **Local smoke (manual — note in PR if skipped):** `/treasury` → Ручная проводка → pick a `2110…`-style customer-liability account on a line → a «Контрагент» select appears; Post stays disabled until a client is chosen; after choosing + balancing, Post works and the entry shows in Журнал with the client on that leg.
- [ ] **Open PR:**
```bash
gh pr create --base main --head feat/posting-subconto --title "feat(treasury): Posting Master — per-line counterparty (subconto) picker (Spec C.5)" --body "$(cat <<'EOF'
## Summary
Posting Master can now post to customer/partner-liability accounts: when a line's account requires a subconto dimension, a «Контрагент» `<select>` appears on that line; the chosen client/partner is sent as the leg's `client_id`/`partner_id` (the RPC + wrapper + payload builder already supported this).

- `loadCounterpartyNames` now returns `{ map, clients, partners }`; `LedgerProvider` exposes `counterpartyOptions(kind)`; `TreasuryShell` threads it into `ctx`.
- `accountsForCurrency` no longer filters out dimensioned accounts; `validatePostingDraft` requires a client/partner on lines whose account needs one (`client_required` / `partner_required`).
- `PostingTab` gains a "Counterparty" column (empty unless the line's account requires a dim).
- New i18n: `trv2_pm_col_counterparty` / `trv2_pm_pick_counterparty` / `trv2_pm_err_counterparty` (en/ru/tr). No DB changes.

## Test plan
- [x] Full suite green (new: loadCounterpartyNames new-shape, validatePostingDraft client_required, PostingTab counterparty-picker; updated AccountPicker + accountsForCurrency assertions)
- [x] `npm run build` clean
- [ ] Local smoke: customer-liability account → counterparty select → Post gated on it → entry in Журнал with the client on the leg

## Out of scope (Spec C.6+)
Searchable counterparty combobox; creating a client/partner from Posting Master; optional (non-required) subconto; subconto in other editors.

Spec: `docs/superpowers/specs/2026-05-11-posting-master-subconto-design.md`
Plan: `docs/superpowers/plans/2026-05-11-posting-master-subconto.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist

**Spec coverage:**
- ✅ `loadCounterpartyNames` → `{ map, clients, partners }`; `LedgerProvider.counterpartyOptions(kind)`; `TreasuryShell` ctx → Task 1
- ✅ `accountsForCurrency` no dim filter → Task 2
- ✅ `validatePostingDraft` `client_required` / `partner_required` (replacing `dim_not_supported`) → Task 2
- ✅ `PostingTab` line state `clientId`/`partnerId`; clear on account change; "Counterparty" column wired to `counterpartyOptions` + `patchLine`; error display → Task 3
- ✅ i18n `trv2_pm_col_counterparty` / `_pick_counterparty` / `_err_counterparty` (en/ru/tr) → Task 3
- ✅ Tests: loadCounterpartyNames new shape, postingEntry (accountsForCurrency includes 2110, client_required), AccountPicker (2110 is an option), PostingTab (counterparty picker + payload) → Tasks 1, 2, 3
- ⏸ searchable combobox, create-from-modal, optional subconto — deferred (Out of scope & PR body)

**Type/name consistency:** `loadCounterpartyNames() → { map: Map, clients: [{id,name}], partners: [{id,name}] }` (Task 1 ↔ test ↔ LedgerProvider). `counterpartyOptions(kind: "client"|"partner") → [{id,name}]` (LedgerProvider ↔ TreasuryShell ctx ↔ PostingTab). Validator error codes `client_required` / `partner_required`, `field: "counterparty"` (Task 2 ↔ PostingTab's `lineErr(id,"counterparty")`). Line state `{ id, accountCode, side, amount, clientId, partnerId }` (Task 3). `buildManualEntryPayload` unchanged (already spreads `clientId`/`partnerId`).

**Placeholder scan:** Task 3 Step 2's "(if reading PostingTab.jsx shows the table structure differs, adapt …)" is a real "read-the-file-and-match-it" instruction with the invariant spelled out — not a placeholder. Otherwise every step is complete with code and expected output.

## Execution Handoff

(See the skill's handoff prompt.)
