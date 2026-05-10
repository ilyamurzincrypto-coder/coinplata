# ОСВ — subconto rows (per-client/partner breakdown) (Spec C.6)

**Date:** 2026-05-11
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** Spec C.2 (Turnover/ОСВ — `trialBalance`, `TrialBalanceTable`), C.4 (`accountEntries` `dim` filter, `groupByClass` nested dims, `counterpartyName` in ctx). No DB changes.

## Overview

The Оборотно-сальдовая ведомость (`TurnoverTab` → ОСВ view) currently shows one row per account (opening / Σ debit turnover / Σ credit turnover / closing). For accounts that carry a subconto dimension (customer-liability / partner-liability), add a per-client/partner breakdown: the account row expands to one sub-row per subconto with the same four metrics, and each sub-row expands to that subconto's journal entries for the period. Mirrors what `groupByClass` / `AccountRow` already do in the balance-sheet tabs (C.4), but with the period metrics instead of just the balance.

## Selector — `trialBalance` (`src/lib/treasury/v2selectors.js`)

Add a `dims` field to each account row. For a "dimensioned" account — `acc.clientDimRequired || acc.partnerDimRequired || (any of its `ledger.balances` rows or journal entries in the office has a non-null `clientId`/`partnerId`)` — `dims` is an array:

```
[ { clientId, partnerId, opening, debitTurnover, creditTurnover, closing,
    openingInBase, debitTurnoverInBase, creditTurnoverInBase, closingInBase } ]   // sorted by |closingInBase| desc
```

For a non-dimensioned account, `dims: null` (unchanged behaviour). The account-level metrics are the sum across `dims` (so existing consumers / the class subtotals / the grand-total checks are unchanged).

Implementation: in the entry loop, additionally accumulate a per-(accountId, dimKey) record, where `dimKey = e.clientId || e.partnerId || ""`; track `{ sinceFrom, afterTo, drTurn, crTurn }` per `accountId|dimKey`. Also build a per-(accountId, dimKey) current-balance map from `balances` (`b.clientId || b.partnerId || ""` is the dimKey of a balance row). Then for a dimensioned account, for each dimKey that appears in either its balance rows or its entries, compute `opening = curBalByDim − sinceFrom`, `closing = curBalByDim − afterTo`, `debitTurnover = drTurn`, `creditTurnover = crTurn` (and the `*InBase` via `ctx.toBase(_, acc.currency)`); push `{ clientId: <from a balance/entry row with that dimKey>, partnerId: <ditto>, ...metrics }`. Sort `dims` by `|closingInBase|` desc. A dim with all-zero metrics is **kept** (an accountant wants to see a zeroed-out client too — unlike the account-level omit-if-all-zero, which stays). The account-level `opening/closing/debitTurnover/creditTurnover` for a dimensioned account should equal `Σ dims` (compute them by summing the dim records — or keep the existing account-level accumulation; both must agree, so reuse the dim sums for the account row when `dims` is non-null to guarantee consistency). Period attribution stays by transaction `effectiveDate` (via the existing `txEffMs` map).

Note on `clientId` vs `partnerId` per dimKey: a customer-liability account uses `clientId` (its `partnerId` is null on every row), a partner-liability account uses `partnerId`. So a dim record's `clientId` is the dimKey if the account is client-dimensioned, else null; symmetric for `partnerId`. Simplest: when building a dim record, set `clientId = (the source row's clientId) || null`, `partnerId = (the source row's partnerId) || null` — read them straight off whichever balance/entry row first established that dimKey.

## UI — `TrialBalanceTable` (`src/pages/treasury_v2/parts/TrialBalanceTable.jsx`)

`TrialBalanceTable` has an internal `AccountRow` sub-component: a `<tr>` with the account's code/name/currency + 4 metric cells and a chevron; expanded → `<AccountInlineEntries ctx accountId period={win} onOpenTx>`.

Change: when `row.dims` is non-null, expanding renders one `<TrialBalanceSubcontoRow>` per dim (with `ctx`, the `accountId`, the `dim`, `window`/`win`, `formatBase`, `onOpenTx`) **instead of** `AccountInlineEntries`. When `row.dims` is null, behave exactly as today.

New `src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.jsx`: a `<tr>` (rendered inside the table — so it's a `<tr>` with `<td>`s matching the column count, indented via `pl-9` on the first cell) showing: a small chevron, a `kind` label (`client`/`partner`), `ctx.counterpartyName(dim.clientId || dim.partnerId)`, then the same 4 metric cells (`opening / debitTurnover / creditTurnover / closing`, native amounts via `toLocaleString`); expanded → a `<tr><td colSpan>{<AccountInlineEntries ctx accountId period={win} dim={{ clientId, partnerId }} onOpenTx>}</td></tr>` (dim-filtered entries for the period). It's its own React component (own `useState` for expanded) so multiple subconto rows expand independently.

`TrialBalanceTable`'s `AccountRow` already has the right column structure (`[chevron | code | name | currency | opening | Dr | Cr | closing]` — 8 cells). The subconto sub-row uses the same 8-cell layout with the name spanning the code+name area (or: chevron / `kind` / name(merged across code+name) / currency / 4 metrics — keep it close to the account row visually, just indented and lighter). The CSV export (already in `TrialBalanceTable`) stays account-level for v1 (don't add subconto rows to the CSV — out of scope).

## i18n

No new keys. The subconto name is a plain string from `counterpartyName`; the metric column headers are the existing `trv2_to_col_*`; empty entries use the existing `trv2_no_entries`. (If a "client"/"partner" kind label needs i18n later, that's a follow-up — render it as small uppercase mono text for now, consistent with `txKind` rendering elsewhere.)

## Testing

- `trialBalance` (`src/lib/treasury/v2selectors.test.js`, using `makeLedgerCtx` — `ac_cust_liab_usd` has `clientDimRequired: true`, a balance row `clientId: "client-1" balance: -500`, and entries je4 (cr 100, client-1) / je5 (dr 95, client-1)):
  - the `ac_cust_liab_usd` row has `dims` — an array; the `client-1` dim has the right `opening`/`debitTurnover`/`creditTurnover`/`closing` (compute by hand from the fixture for whatever period the test uses, e.g. a wide period: opening = currentBalance(−500) − Σ normalSign over all client-1 entries; Dr turnover = 95 (je5); Cr turnover = 100 (je4)); the account-level metrics equal `Σ dims`.
  - a non-dimensioned account (e.g. `ac_cash_usd_mark`) row has `dims: null`.
  - with a second client (`overrides` adding a `client-2` balance row), `dims` has two entries, sorted by `|closingInBase|` desc, and account metrics sum them.
- `TrialBalanceSubcontoRow` (`src/pages/treasury_v2/parts/TrialBalanceSubcontoRow.test.jsx`, new): renders the resolved name + 4 metric cells; expanding shows the dim-filtered `AccountInlineEntries` (mock i18n, pass a small `ctx` with `counterpartyName` returning a fixed name + `entries`/`transactions` for the drill).
- `TrialBalanceTable.test.jsx` (extend): a dimensioned account in the data → expanding it shows the subconto sub-rows (with names from `ctx.counterpartyName`) rather than the entry table; a plain account → entry table on expand as today. (Adapt the test's `ctx` to include `counterpartyName` and a balance row + entries for a dimensioned account.)

## Out of scope (Spec C.7+)

- Subconto in the Шахматка (it would be an (account+subconto)×(account+subconto) matrix — large; defer).
- Subconto rows in the ОСВ CSV export (export stays account-level).
- "Show only non-zero subconto" toggle (v1 shows all subconto of a dimensioned account).
- Resolving any other dimension/id elsewhere.

## References

- `trialBalance` / `accountEntries` / `passesOfficeFilter` / `normalSign`: `src/lib/treasury/v2selectors.js`.
- `TrialBalanceTable` (incl. its internal `AccountRow`): `src/pages/treasury_v2/parts/TrialBalanceTable.jsx`.
- Prior art for the nested-dims pattern: `groupByClass`'s `dims` + `AccountRow` + `AccountSubcontoRow` (C.4, `src/pages/treasury_v2/parts/`).
- `AccountInlineEntries` already takes `period` (C.2) and `dim` (C.4) props.
- `counterpartyName(id)` in `ctx` (C.4, via `LedgerProvider` + `TreasuryShell`).
