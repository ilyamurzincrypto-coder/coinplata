# Subconto drill-down in Treasury balance tabs (Spec C.4)

**Date:** 2026-05-11
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** Spec B (Treasury, `src/pages/treasury_v2/`). Modifies `groupByClass`, `accountEntries`, `AccountRow`, `AccountInlineEntries`, `LedgerProvider`, `ledgerReaders.js`, `TreasuryShell`.

## Overview

The Treasury balance-sheet tabs (Активы / Пассивы / Капитал) currently show, for an account that carries a subconto dimension (customer-liability / partner-liability accounts have `client_dim_required` / `partner_dim_required`), one flat row per `ledger.balances` dimension row, labelled with a truncated UUID (`· client a1b2c3d4`). This spec turns that into a proper subconto breakdown:

1. **Resolve `client_id` / `partner_id` to names** (from `public.clients.nickname || full_name` and `public.partners.name`).
2. **Group an account's dimension rows under one collapsible parent row** — the account row shows the total, expands to one row per subconto (name + base balance), and each subconto row expands to that subconto's journal entries for the account.

Plain accounts (no dimensions) are unchanged. Read-only — no editing of subconto. The ОСВ / Шахматка subconto breakdown is deferred (Spec C.5+).

## Data / readers

- New `loadCounterpartyNames()` in `src/lib/ledgerReaders.js` — `SELECT id, nickname, full_name FROM public.clients` and `SELECT id, name FROM public.partners`, merge into a `Map<uuid, string>` keyed by id: clients → `nickname || full_name || id`, partners → `name || id`. Returns the `Map` (empty `Map` if `!isSupabaseConfigured`). UUID spaces don't overlap, so one combined map is fine.
- `LedgerProvider` (`src/store/ledger.jsx`): load `loadCounterpartyNames()` in the existing `Promise.all` in `reload()`; store the map in state; expose in the context value a function `counterpartyName(id) => map.get(id) || (id ? String(id).slice(0, 8) : "—")`. (Also keep the raw map available if useful, but `counterpartyName` is the consumed API.)
- `TreasuryShell` (`src/pages/treasury_v2/TreasuryShell.jsx`): it builds its own `ctx` object from selected `useLedger()` fields — add `counterpartyName` to that set so it's in the `ctx` passed to every tab.

## Selectors

### `groupByClass` (`src/lib/treasury/v2selectors.js`) — nested dims

Currently returns sections `{ subtype, labelKey, totalInBase, accounts: [<one flat row per balance dim>] }`, each flat row `{ accountId, code, name, currency, clientId, partnerId, balance, balanceInBase }`.

New: `accounts` becomes one row per account (an account has a single currency, so per-account = per-(account,currency)):

```
{ accountId, code, name, currency,
  balance,            // native: Σ over the account's balance rows
  balanceInBase,      // base:   Σ over the account's balance rows (via ctx.toBase)
  dims: null | [ { clientId, partnerId, balance, balanceInBase } ]   // sorted by |balanceInBase| desc
}
```

`dims` is non-null when the account has a subconto dimension: `acc.clientDimRequired || acc.partnerDimRequired`, **or** any of its balance rows has a non-null `clientId`/`partnerId`. Otherwise `dims: null` (a plain account — the dim row, if any, has `clientId/partnerId === null`, and its single balance is the account balance). `totalInBase` per subtype section is the sum of the accounts' `balanceInBase` (unchanged in meaning). Office filter via the existing `passesOfficeFilter` (unchanged). An account with no balance rows still emits a row with `balance: 0, balanceInBase: 0, dims: null` (matching today's fallback `[{ accountId: acc.id, currency: acc.currency, clientId: null, partnerId: null, balance: 0 }]`).

### `accountEntries` (`src/lib/treasury/v2selectors.js`) — optional dim filter

Currently `accountEntries(ctx, accountId, limit = 50, period = null)`. Add a 5th param `dim = null`; when given (`{ clientId?, partnerId? }`), also keep only entries where (`dim.clientId == null || e.clientId === dim.clientId`) **and** (`dim.partnerId == null || e.partnerId === dim.partnerId`). Default `null` → no extra filter → existing callers unchanged.

## UI

- `src/pages/treasury_v2/parts/AccountRow.jsx` — if `account.dims` is non-null: render the row (code · name · native total · base total) with a chevron; expanded → a list of `<AccountSubcontoRow>` (one per dim, resolving the name via `ctx.counterpartyName(dim.clientId || dim.partnerId)`). If `account.dims` is null: behave exactly as today (chevron → `<AccountInlineEntries ctx accountId onOpenTx>`). The `dimLabel` logic (the `· client a1b2c3d4` suffix) is removed from `AccountRow` — that information now lives in the expanded subconto rows.
- `src/pages/treasury_v2/parts/AccountSubcontoRow.jsx` (new) — renders one subconto: a small chevron, `t`-free name (`ctx.counterpartyName(clientId || partnerId)` — already a string), the kind hint (`client` / `partner`), the native balance + the base balance; expanded → `<AccountInlineEntries ctx accountId dim={{ clientId, partnerId }} onOpenTx>`.
- `src/pages/treasury_v2/parts/AccountInlineEntries.jsx` — add an optional `dim` prop; forward it as the 5th arg to `accountEntries(ctx, accountId, 50, period, dim)`. (It already has `period` from Spec C.2.) Existing callers pass no `dim` → unchanged.
- `src/pages/treasury_v2/tabs/AssetsTab.jsx` / `LiabilitiesTab.jsx` / `EquityTab.jsx` — the `AccountRow` `key` simplifies from `${a.accountId}-${a.currency}-${a.clientId||""}-${a.partnerId||""}-${i}` to `${a.accountId}-${a.currency}` (now one row per account). Otherwise no change (they still `groupByClass(ctx, type).map(section => <ClassSection>{section.accounts.map(a => <AccountRow account={a} ...>)}</ClassSection>)`).

## i18n

No new keys required. The subconto name is already a plain string (or short UUID). The "client" / "partner" kind hint can use a literal mono label or, if a key is desired for translation, reuse... actually just render `client` / `partner` as small uppercase mono text (consistent with how `txKind` is rendered elsewhere) — no i18n key. Empty subconto entries → existing `trv2_no_entries`.

## Testing

JS tests:
- `groupByClass` (`src/lib/treasury/v2selectors.test.js`): the **existing `groupByClass` tests assert on the old flat-row shape and must be updated to the new nested shape** (one row per account, `dims` field). Using `makeLedgerCtx` — the fixture's `ac_cust_liab_usd` has `clientDimRequired: true` and a balance row with `clientId: "client-1"`, `balance: -500` — assert: the customer-liability account emits one row with `dims: [{ clientId: "client-1", partnerId: null, balance: -500, balanceInBase: -500 }]` and `balance: -500`; a plain account (e.g. `ac_cash_usd_mark`) emits a row with `dims: null`; section `totalInBase` unchanged. Optionally pass `overrides` to add a second `client-2` balance row on the liability account and assert the `dims` are sorted by `|balanceInBase|` desc and `balance`/`balanceInBase` sum across dims.
- `accountEntries` dim filter: with `dim = { clientId: "client-1" }` on `ac_cust_liab_usd`, only entries with `clientId === "client-1"` come back; `dim = { clientId: "other" }` → empty; no `dim` → all (unchanged).
- `loadCounterpartyNames` (new test file or in `ledgerReaders.test.js`): mock `supabase` so `.from("clients").select(...)` returns `[{ id: "c1", nickname: "Иван", full_name: "Иван Петров" }, { id: "c2", nickname: null, full_name: "No Nick" }]` and `.from("partners").select(...)` returns `[{ id: "p1", name: "OTC Acme" }]`; assert the map: `c1 → "Иван"`, `c2 → "No Nick"`, `p1 → "OTC Acme"`. With `isSupabaseConfigured` false → empty map.
- `AccountSubcontoRow` render test: renders the resolved name + balance; clicking expands and `<AccountInlineEntries>` shows the dim-filtered entries (mock i18n, pass a small `ctx` with `counterpartyName` returning a fixed name).
- `AccountRow` test: a dimensioned account (`dims` non-null) renders the chevron and, when expanded, shows the subconto rows with names from `ctx.counterpartyName` (not the entry table); a plain account (`dims: null`) renders the entry table on expand as today.

## Out of scope (Spec C.5+)

- Subconto breakdown in the ОСВ and Шахматка (`trialBalance` / `chessTurnover`) — those still aggregate at the account level.
- Per-line subconto / counterparty picker in Posting Master (so manual entries can post to customer/partner-liability accounts) — separate Spec C item; it can reuse this spec's `loadCounterpartyNames` + `counterpartyName`.
- Editing / creating clients or partners from inside the Treasury.
- A flat "all subconto for all accounts" report.
- Resolving `office_id`, `deal_id`, or other ids to names elsewhere (this spec only covers `client_id` / `partner_id` in the balance tabs).

## References

- Current `groupByClass` / `accountEntries` / `passesOfficeFilter`: `src/lib/treasury/v2selectors.js`.
- Current `AccountRow` / `AccountInlineEntries` / `ClassSection`: `src/pages/treasury_v2/parts/`.
- `LedgerProvider` context shape: `src/store/ledger.jsx`; reader patterns: `src/lib/ledgerReaders.js` (and `src/lib/supabaseReaders.js` `loadClients` / `loadPartners` for the table/column names — `public.clients (id, nickname, full_name, …)`, `public.partners (id, name, …)`, verified prod 2026-05-11).
- `TreasuryShell` builds its `ctx` from selected `useLedger()` fields: `src/pages/treasury_v2/TreasuryShell.jsx`.
- The Spec C.2 `accountEntries` period-filter extension is the closest prior art for adding an optional filter param.
