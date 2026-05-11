# Касса: v2-нативный список сделок (Spec)

**Date:** 2026-05-11
**Status:** approved
**Depends on:** v2 ledger (`ledger.transactions` / `journal_entries`), `LedgerProvider` (already wraps `<Root/>`), `transactionTree` selector, `TransactionRow` component (both shipped). No new RPC.

## Problem

The Cashier's transactions list (`TransactionsTable` in `CashierPage`) reads `public.deals` + `deal_legs` + `deal_*_payments`. Those tables are frozen post-cutover — new deals go to `ledger.transactions` via `create_deal_v2`. So an operator creates a deal, it shows in Treasury → Журнал, but **not** in the Cashier. The list also still shows stale pre-cutover test deals.

## Approach

Replace the legacy `TransactionsTable` in the Cashier with a v2-native deals view that reuses the Журнал machinery (`transactionTree` + `TransactionRow`), plus a one-line "exchange summary" derived from the journal entries. Also wipe the stale test deals from `public.deals*`.

Rejected: re-pointing `TransactionsTable` itself at `ledger.*` — the legacy "deal" shape (per-leg `rate`/`fee`/`profit`, IN/OUT roles) can't be losslessly reconstructed from Dr/Cr entries, and `TransactionsTable` (~1300 LOC, edit/delete logic) is heavily coupled to that shape (and edit/delete are already disabled under v2).

## Components

### 1. `src/lib/treasury/dealSummary.js` (new)
Pure function `dealSummary(node, accountsById) → { in: [{amount, currency, accountName}], out: [...], margin: [{amount, currency}] } | null`.
- Input: a `transactionTree` node (`{ tx, entries:[{accountId, direction, amount, currency, accountCode, accountName}] }`) and a `Map<accountId, account>` (account has `type`, `subtype`).
- Group entries by `accountId`, compute net (Dr − Cr) per account.
- `in` = asset-type accounts with net Dr > 0 (money came in), each `{ amount: net, currency, accountName }`.
- `out` = asset-type accounts with net Cr > 0 (money went out), each `{ amount: |net|, currency, accountName }`.
- `margin` = revenue-type accounts: `{ amount: net Cr, currency }` (the spread/commission).
- Returns `null` if `in` and `out` are both empty (nothing meaningful to summarise) — caller falls back to the generic "{n} проводок" line.
- Only meant to be called for `tx.kind === "deal"` (and harmless for others, just may return null).

Tested in isolation: a 5-entry deal (Dr cash 1000 / Cr cust_liab 1000 / Dr cust_liab 950 / Cr hot 950 / Cr spread 50) → `{ in:[{1000,"USD",...}], out:[{950,"USDT",...}], margin:[{50,"USD"}] }`; a transfer (Dr bank / Cr cash, no revenue) → `in` and `out` both non-empty (both asset) so still returns something — acceptable; an opening adjustment (Dr cash / Cr opening_equity) → `out` empty, `in` non-empty → returns `{ in:[...], out:[], margin:[] }`.

### 2. `src/components/cashier/CashierLedgerDeals.jsx` (new)
- `useLedger()` for `{ accounts, transactions, entries, sinceIso, extendWindow }`.
- Local state: `period` (PeriodPicker, default `"30d"`, persisted to localStorage `coinplata.cashier_deals_period`); `typeFilter` (default `"deal"`, with an "all"/"deal"/"transfer"/"topup"/"adjustment"/"manual"/"reversal" chip row — reuse the same `TYPES` array as `JournalTab`).
- Props: `officeFilter` (the operator's current office; passed from `CashierPage`).
- `presetWindow(period)` → if `from < sinceIso` call `ctx.extendWindow(from)`; show `trv2_window_partial` notice when truncated (same pattern as `JournalTab`).
- `tree = transactionTree(ctx, { type: typeFilter, officeFilter, period: {from, to} })`.
- `accountsById = new Map(accounts.map(a => [a.id, a]))`, memoised.
- Render: a header card with `PeriodPicker` + type chips; then a card with the rows. Empty state: `trv2_journal_no_tx`.
- Each row: `<TransactionRow node={node} summaryLine={node.tx.kind === "deal" ? dealSummary(node, accountsById) : null} />` — **no** `onOpenSource` passed (the Cashier has no transaction-detail modal; `TransactionRow` hides the "open source" link when the prop is absent — see below).

### 3. `src/pages/treasury_v2/parts/TransactionRow.jsx` (modify)
- Add an optional `summaryLine` prop. When truthy and the row is **collapsed**, render a small muted line under the title: `пришло {in joined} → ушло {out joined}{ · спред {margin joined} if margin}`. Format amounts with the existing number formatter; e.g. `пришло 1 000 USD (Касса USD) → ушло 950 USDT (Hot USDT) · спред 50 USD`. If `summaryLine` is null, render nothing extra (current behaviour).
- Make `onOpenSource` optional: if not provided, don't render the "открыть источник" link (so the Cashier instance doesn't show a dead link). Treasury keeps passing it.
- No other behavioural change — reverse action, type chip, expand→`TransactionEntries`, reversed/reversal chips all unchanged.

### 4. `src/pages/CashierPage.jsx` (modify)
- Remove `import TransactionsTable` and the `<TransactionsTable .../>` render in the dashboard section; replace with `<CashierLedgerDeals officeFilter={currentOffice} />`.
- Leave `<PendingTransfersBar />` as-is (out of scope).
- `TransactionsTable.jsx` itself stays in the repo (may be referenced by tests / other pages); only its mount in the Cashier is removed.

### 5. DB migration `clean_legacy_test_deals`
`DELETE FROM public.deal_leg_payments;` → `deal_in_payments;` → `deal_legs;` → `deals;` (FK order). Removes stale pre-cutover test deals so any remaining legacy view doesn't show junk. Applied via `apply_migration`. (`public.deals` etc. are frozen for `authenticated` but the migration role can DELETE.)

## i18n
Reuse existing `trv2_journal_*` keys for the type chips, empty state, period picker, truncated notice. New keys (en/ru/tr): `cashier_deals_title` ("Сделки" / "Deals" / "İşlemler"), and the summary prefixes can be inline literals or `cashier_deal_in` / `cashier_deal_out` / `cashier_deal_margin` ("пришло"/"ушло"/"спред"). Minimal — 4 keys.

## Testing
- `dealSummary.test.js` — 5-entry deal → expected `{in, out, margin}`; opening adjustment → `out:[]`; transfer → both asset sides; empty/garbage → null.
- `CashierLedgerDeals.test.jsx` — mock `useLedger` with a fixture (2 transactions, one deal one transfer) + `useTranslation`; stub `TransactionRow` to expose what it renders (or render real and assert on text); assert: rows render, default filter shows only the deal, switching to "all" shows both, deal row shows the summary line.
- `TransactionRow.test.jsx` (extend if it exists, else add) — `summaryLine` prop renders the line when collapsed; `onOpenSource` undefined → no "open source" link.
- Full suite + `npm run build` green.

## Out of scope (future specs)
- Account-history drill-down (Счета/Balances) → `ledger.journal_entries` (still reads frozen `account_movements`).
- Edit / Delete / Complete deals from the Cashier on v2 RPCs (`update_deal_v2`, `reverse_transaction`, `complete_deal_leg`) — currently disabled under v2.
- Retiring `TransactionsTable.jsx` entirely; `PendingTransfersBar` on v2.
- A transaction-detail modal in the Cashier (Treasury has one).

## References
- `src/pages/treasury_v2/tabs/JournalTab.jsx` — the pattern this mirrors (PeriodPicker + type chips + `transactionTree` + `TransactionRow` + truncated notice).
- `src/lib/treasury/v2selectors.js` `transactionTree` — the data selector.
- `src/store/ledger.jsx` `useLedger` — the context (already app-wide).
- `src/pages/treasury_v2/parts/TransactionRow.jsx` / `TransactionEntries.jsx` — the row + Дт/Кт tree.
