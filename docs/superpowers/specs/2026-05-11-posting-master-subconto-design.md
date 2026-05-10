# Posting Master — per-line counterparty (subconto) picker (Spec C.5)

**Date:** 2026-05-11
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** Spec C.1 (Posting Master) and Spec C.4 (`loadCounterpartyNames` / `counterpartyName`). No DB changes.

## Overview

Posting Master currently refuses accounts that carry a required subconto dimension (customer-liability / partner-liability — `client_dim_required` / `partner_dim_required`): `accountsForCurrency` filters them out and `validatePostingDraft` flags `dim_not_supported`. This spec makes them postable: when such an account is picked on a line, a counterparty (`<select>`) appears on that line, and the chosen client/partner is sent as the leg's `client_id` / `partner_id`.

The backend is already ready: `ledger.create_manual_entry` validates `client_dim_required AND v_client IS NULL → RAISE` (and the symmetric partner check); `rpcCreateManualEntryV2` already maps a line's `clientId`/`partnerId` → `client_id`/`partner_id`; `buildManualEntryPayload` already spreads `clientId`/`partnerId` when present. Only the UI, the name reader, and the client-side validator change.

## Data / readers

- **`loadCounterpartyNames`** (`src/lib/ledgerReaders.js`) — currently returns a merged `Map<uuid, string>` (client+partner names, kind lost). Change the return shape to `{ map: Map<uuid,string>, clients: [{ id, name }], partners: [{ id, name }] }` (clients: `nickname || full_name || id-prefix`; partners: `name || id-prefix`; the merged `map` keeps the existing combined behaviour for `counterpartyName`). Existing-test note: `src/lib/ledgerReaders.counterparty.test.js` asserts on the returned `Map` directly — update it to destructure `{ map, clients, partners }` and assert `map.get(...)` plus the two arrays.
- **`LedgerProvider`** (`src/store/ledger.jsx`) — store the new shape (`const [cpData, setCpData] = useState(() => ({ map: new Map(), clients: [], partners: [] }))`); in `reload`'s `Promise.all`, `loadCounterpartyNames().catch(() => ({ map: new Map(), clients: [], partners: [] }))` → `setCpData(d)`. `counterpartyName(id) = cpData.map.get(id) || (id ? id-prefix : "—")` (unchanged behaviour, now reads `cpData.map`). Add `counterpartyOptions(kind) = kind === "partner" ? cpData.partners : cpData.clients` (returns `[{id,name}]`). Both go in the context `value` (+ deps).
- **`TreasuryShell`** — add `counterpartyOptions` to the `useLedger()` destructure and to the `ctx` `useMemo` (+ deps).

## Selectors / pure logic (`src/lib/treasury/postingEntry.js`)

- **`accountsForCurrency(accounts, currency)`** — drop the `&& !a.clientDimRequired && !a.partnerDimRequired` clause, so it returns all `active` accounts with the matching currency, including dimensioned ones. (`SYSTEM_DRIVEN_SUBTYPES` already covers `customer_liab` / `partner_liab`, so `AccountPicker` will show the "usually maintained automatically" chip on them — informative, fine.) Existing-test note: `postingEntry.test.js` asserts `accountsForCurrency(ACCOUNTS, "USD")` excludes `"2110"` (clientDimRequired) — update that assertion to expect `"2110"` is now included.
- **`validatePostingDraft(draft, resolveAccount)`** — replace the `dim_not_supported` branch with: for a line whose resolved account is active and currency-matching, if `acc.clientDimRequired && !line.clientId` → push `{ code: "client_required", lineId: l.id, field: "counterparty", message: "Pick a client" }`; if `acc.partnerDimRequired && !line.partnerId` → push `{ code: "partner_required", lineId: l.id, field: "counterparty", message: "Pick a partner" }`. (A line can't require both — `customer_liab` has only `client_dim_required`, `partner_liab` only `partner_dim_required` — but if some account ever set both, both checks run; harmless.) `buildManualEntryPayload` is unchanged (it already spreads `clientId`/`partnerId`).

## UI (`src/pages/treasury_v2/tabs/PostingTab.jsx`)

- **Line state** — each line gains `clientId: null, partnerId: null` (alongside `id, accountCode, side, amount`). `newLine()` includes them.
- **On account change** — `patchLine(id, { accountCode })` becomes: also clear the dim ids if the new account doesn't require them — i.e. `patchLine(id, { accountCode: code, clientId: null, partnerId: null })` (always clear; the user re-picks the counterparty for the new account). Simpler than conditional clearing and avoids stale ids.
- **New "Counterparty" column** — between the account picker column and the Dr column. For a line whose selected account has `clientDimRequired` → render a `<select>` over `ctx.counterpartyOptions("client")` bound to `line.clientId` (`onChange` → `patchLine(id, { clientId: e.target.value || null })`); if `partnerDimRequired` → same over `counterpartyOptions("partner")` bound to `line.partnerId`. If the account requires neither (or no account picked) → an empty cell. The `<select>` has a placeholder option `t("trv2_pm_pick_counterparty")` ("— контрагент —"). It's a small native `<select>` styled like `AccountPicker` (the chart of accounts there is ~170 options; counterparties may be a few hundred — acceptable for v1; a searchable combobox is a future upgrade). A per-line counterparty validation error (`client_required` / `partner_required`) renders as small rose text under the select (like the existing account error). Columns become `[account | counterparty | Dr | Cr | ×]`.
- **Submit** — already gated by `validation.ok`; with the new validator branch, a missing required counterparty blocks submit.

## i18n

New keys (en / ru / tr): `trv2_pm_col_counterparty` ("Counterparty" / "Контрагент" / "Karşı taraf"), `trv2_pm_pick_counterparty` ("— counterparty —" / "— контрагент —" / "— karşı taraf —"), `trv2_pm_err_counterparty` ("Pick a counterparty for this account" / "Выбери контрагента для этого счёта" / "Bu hesap için karşı taraf seç"). 3 new keys × 3 locales. (The `dim_not_supported` i18n had no key — it used the validator's inline `message` string — so nothing to remove from `translations.jsx`.)

## Testing

- `loadCounterpartyNames` (`ledgerReaders.counterparty.test.js`): update to the new `{ map, clients, partners }` shape — `map.get("c1")` etc. as before, plus `clients` is `[{id:"c1",name:"Иван"}, {id:"c2",name:"No Nick"}, {id:"00000000-…",name:"00000000"}]` and `partners` is `[{id:"p1",name:"OTC Acme"}]`; the error-case test stays.
- `accountsForCurrency` (`postingEntry.test.js`): the existing assertion `expect(r).toEqual(["1110","4010","5010"])` becomes `expect(r).toEqual(["1110","2110","4010","5010"])` (or whatever sorted order — `2110` is now included; assert it `toContain("2110")` to be order-robust).
- `validatePostingDraft` (`postingEntry.test.js`): replace the `dim_not_supported` test — a draft with a `2110` line and no `clientId` → an error `{ code: "client_required", lineId }`; the same draft with `clientId: "client-1"` set on that line → no `client_required` error (still needs to balance / have a reason for `ok`, so test the specific error's presence/absence, not `ok`).
- `AccountPicker.test.jsx`: the assertion `expect(screen.queryByRole("option", { name: /2110/ })).toBeNull()` becomes `expect(screen.getByRole("option", { name: /2110/ })).toBeInTheDocument()`.
- `PostingTab.test.jsx`: add a test — pass a `ctx` (mocked) with a `2110` customer-liability account (`clientDimRequired: true`) and `counterpartyOptions: (k) => k === "client" ? [{id:"client-1",name:"Иван"}] : []`; pick `2110` on a line → a counterparty `<select>` appears; without a client chosen, the Post button stays disabled; choosing `client-1` (and filling the other side + reason so the entry balances) → Post enabled and `rpcCreateManualEntryV2` is called with `payload.lines` containing `{ accountCode: "2110", direction: ..., amount: ..., clientId: "client-1" }`. (Adapt the existing `PostingTab.test.jsx` mock `ctx` to include `counterpartyOptions`; non-dimensioned-account tests still pass since the column is empty for them.)

## Out of scope (Spec C.6+)

- Searchable / combobox counterparty picker (v1 = native `<select>`).
- Creating a new client/partner from inside Posting Master.
- Optional (non-required) subconto on accounts that don't set `*_dim_required`.
- Subconto on non-`manual` operations from the UI; subconto in any other editor.

## References

- Posting Master: `src/pages/treasury_v2/tabs/PostingTab.jsx`, `src/lib/treasury/postingEntry.js`, `src/pages/treasury_v2/parts/AccountPicker.jsx`, `src/lib/newLedger.js` (`rpcCreateManualEntryV2` — already maps the dim ids), `supabase/migrations/posting_master_1_create_manual_entry.sql` (RPC — already validates the dim requirement).
- Counterparty names: `src/lib/ledgerReaders.js` (`loadCounterpartyNames` — added in C.4), `src/store/ledger.jsx` (`counterpartyName`), `src/lib/ledgerReaders.counterparty.test.js`.
- `TreasuryShell` ctx assembly: `src/pages/treasury_v2/TreasuryShell.jsx`.
