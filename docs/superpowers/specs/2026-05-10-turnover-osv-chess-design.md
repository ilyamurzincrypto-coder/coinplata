# Turnover report — Оборотно-сальдовая ведомость + Шахматка (Spec C.2)

**Date:** 2026-05-10
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** Spec B (Treasury on journal entries, `src/pages/treasury_v2/`, on `main`) and Spec C.1 (Posting Master, on `main`). This adds a new read-only tab to the existing `TreasuryShell`.

## Overview

A new **«Обороты»** tab in the Treasury section showing two period reports over `ledger.journal_entries`:

1. **Оборотно-сальдовая ведомость (ОСВ / trial balance)** — per account, for the selected period: opening balance · Σ debit turnover · Σ credit turnover · closing balance. Exact, no heuristics. The accountant's workhorse.
2. **Шахматка (chess sheet / cross-tab)** — an account×account matrix: `cell[Dr account][Cr account]` = the (base-currency) turnover that flowed from that Dr account to that Cr account in the period. This is the "Crassula look" the owner asked for.

Both are pure read-only selectors over the same data the rest of the Treasury already loads (`useLedger()`); both reuse the existing `PeriodPicker`; the tab is gated by the same `capital`-view permission as the rest of the Treasury (no new permission).

### Why a heuristic is needed for the Шахматка

Classic 1С «Шахматка» is exact because each posting (проводка) is a single Dr↔Cr pair. Our `ledger.journal_entries` are **N-leg per transaction** (a cashier deal is e.g. Dr cash / Cr customer_liab / Dr customer_liab / Cr hot / Cr spread — 5 legs), so there's no canonical Dr-leg↔Cr-leg pairing. The Шахматка therefore uses a **proportional allocation**: for each transaction, for every (Dr leg `d`, Cr leg `c`), `cell[d.account][c.account] += baseOf(d.amount) × baseOf(c.amount) / Σ_legs baseOf(cr amount)`. For 2-leg transactions this is exact. For N-leg, it distributes each Dr leg's amount across the Cr legs in proportion to their size. Row sums equal each account's Σ debit turnover and column sums equal each account's Σ credit turnover (these reconcile with the ОСВ), assuming the transaction balances in base — which `ledger.create_deal_v2` / `create_transfer` / `create_topup` / `create_adjustment` / `create_manual_entry` all guarantee. A footnote in the UI explains the allocation for multi-leg transactions.

## Sign convention (verified against prod 2026-05-10)

`ledger.balances.balance` stores the **magnitude on the account's normal side** (always non-negative for a healthy account): asset/expense accounts are Dr-normal (`balance = ΣDr − ΣCr`), liability/equity/revenue accounts are Cr-normal (`balance = ΣCr − ΣDr`). E.g. equity account `3100` (opening_balance) has `balance = +15000` in prod. `groupByClass` / `balanceCheckTotals` already rely on this.

Derived quantities the ОСВ needs:
- `normalSign(account, entry)` = `entry.amount × (drNormal(account) ? (entry.direction === 'dr' ? +1 : -1) : (entry.direction === 'cr' ? +1 : -1))` where `drNormal` is true for `asset`/`expense`, false for `liability`/`equity`/`revenue`.
- `closing@to(account) = current_balance(account) − Σ normalSign(account, e)` over entries `e` of that account with `e.createdAt > period.to`.
- `opening@from(account) = current_balance(account) − Σ normalSign(account, e)` over entries `e` with `e.createdAt ≥ period.from`.
- `debitTurnover(account) = Σ e.amount` over Dr entries of the account in `[from, to]`; `creditTurnover` the symmetric Cr sum. (Always the raw absolute amounts, regardless of normal side — that's what an ОСВ shows.)

This needs all of the account's entries from `period.from` up to now to be loaded; the tab calls `ctx.extendWindow(period.from)` (same pattern as `JournalTab`/`PnLTab`) and shows the existing "showing the most recent data only" notice while a wider window loads.

## Selectors (added to `src/lib/treasury/v2selectors.js`)

`v2selectors.js` already holds `groupByClass`, `accountEntries`, `transactionTree`, `pnlForPeriod`, `balanceCheckTotals` plus the `passesOfficeFilter` helper and `SUBTYPE_LABEL_KEYS`. Two new exports go there for cohesion.

### `trialBalance(ctx, period, officeFilter) → ОСВ`

Returns:
```
{
  classes: [
    { type, labelKey, accounts: [
        { accountId, code, name, type, subtype, currency,
          opening, debitTurnover, creditTurnover, closing,            // native currency
          openingInBase, debitTurnoverInBase, creditTurnoverInBase, closingInBase }
      ], subtotalInBase: { opening, debitTurnover, creditTurnover, closing } }   // signed-by-side as below
  ],
  totalInBase: {
    openingDr, openingCr, debitTurnover, creditTurnover, closingDr, closingCr   // Dr-side vs Cr-side aggregates
  },
  check: {
    openingOk: |openingDr − openingCr| < 0.01,
    turnoverOk: |debitTurnover − creditTurnover| < 0.01,
    closingOk: |closingDr − closingCr| < 0.01,
    openingDelta, turnoverDelta, closingDelta
  }
}
```
- Office filter via the existing `passesOfficeFilter(account, officeFilter)`.
- An account with zero opening, zero turnover, and zero closing in the period is **omitted** (don't list 170 mostly-empty rows).
- Class ordering: asset, liability, equity, revenue, expense (matching the chart-of-accounts conventional order). `labelKey` per class — reuse the existing `trv2_tab_assets` / `trv2_tab_liabilities` / `trv2_tab_equity` keys, and add `trv2_to_class_revenue` / `trv2_to_class_expense`.
- `openingDr` / `closingDr` aggregate the (base) openings/closings of Dr-normal accounts; `openingCr` / `closingCr` aggregate Cr-normal accounts. `debitTurnover` / `creditTurnover` aggregate the raw Dr/Cr base turnovers across all accounts.

### `chessTurnover(ctx, period, officeFilter) → Шахматка matrix`

Returns:
```
{
  accounts: [ { accountId, code, name, type, subtype } ],   // only accounts with non-zero turnover in the period, sorted by code
  rows: Map<drAccountId, Map<crAccountId, baseAmount>>,      // baseAmount > 0
  rowTotals: Map<drAccountId, baseAmount>,                    // = Σ debit turnover of that account (base)
  colTotals: Map<crAccountId, baseAmount>,                   // = Σ credit turnover of that account (base)
  grandTotal: baseAmount
}
```
- For each transaction whose `effectiveDate` is in `[from, to]` and that passes the office filter (any leg touches an account in the office — reuse the same logic `transactionTree` uses): split its entries into Dr legs and Cr legs (each `{ accountId, base }` where `base = ctx.toBase(amount, currency)`); `totalCr = Σ cr base`; if `totalCr === 0` skip the tx; for each Dr leg `d` and Cr leg `c`: `rows[d.accountId][c.accountId] += d.base × c.base / totalCr`.
- Accounts with no non-zero cell on either axis are excluded from `accounts`.
- Reuses `passesOfficeFilter` for the leg-touches check via the account map.

## UI

### New Treasury tab

In `TreasuryShell`'s `BASE_TABS`, insert `{ id: "turnover", labelKey: "trv2_tab_turnover", component: TurnoverTab }` **between `pnl` and `journal`** (balance sheet → P&L → turnover → journal). No permission gating beyond the Treasury page's existing `capital` view — it's read-only.

### `src/pages/treasury_v2/tabs/TurnoverTab.jsx`

- A `PeriodPicker` (default `"month"`, persisted to `localStorage` key `coinplata.treasury_turnover_period` — same pattern as `JournalTab`/`PnLTab`), `extendWindow` wiring in a `useEffect` when the chosen window reaches past `ctx.sinceIso`, and the amber `trv2_window_partial` notice while truncated.
- A sub-view toggle: two buttons `[ ОСВ ] [ Шахматка ]`, default ОСВ, persisted to `localStorage` key `coinplata.treasury_turnover_view`.
- Renders `<TrialBalanceTable …>` or `<ChessSheetTable …>` based on the toggle, passing `ctx`, the resolved `{ from, to }` window, `officeFilter`, `formatBase`, `baseCurrency`.

### `src/pages/treasury_v2/parts/TrialBalanceTable.jsx`

- Calls `trialBalance(ctx, window, officeFilter)`.
- Table grouped by class: a class header row (`t(labelKey)` + the class base subtotals), then one row per account: `[ ⌃/⌄ | code (mono) | name | currency | opening (native) | Σ Dr (native) | Σ Cr (native) | closing (native) ]`. Native amounts via `toLocaleString` + currency code; the per-class subtotal and the grand-total row show base amounts via `formatBase`.
- Each account row is expandable → renders `<AccountInlineEntries ctx={ctx} accountId={…} onOpenTx={onOpenTx} />` (the existing component) filtered to the period — pass an optional `period` prop through to `accountEntries` (extend `accountEntries(ctx, accountId, limit, period?)` to optionally filter by `createdAt ∈ [from, to]`; default unchanged → no behaviour change for the existing balance tabs).
- Footer: a balance-check strip — `Σ Dr оборот = Σ Cr оборот {turnoverOk ? ✓ : (Δ …)}`, `Σ остаток на начало (Дт) = … (Кт) {openingOk ? ✓ : Δ}`, `Σ остаток на конец (Дт) = … (Кт) {closingOk ? ✓ : Δ}`. Green/rose like `BalanceCheckBar`.
- An **«Экспорт CSV»** button: builds a CSV of the visible rows (class, code, name, currency, opening, debit, credit, closing) client-side and triggers a download. If the repo already has a CSV-download helper (check `src/utils/` and the existing P&L/cashflow export buttons referenced in `supabaseWrite.js`/elsewhere), reuse it; otherwise a tiny inline `Blob` + `<a download>` helper. Filename `osv_{from}_{to}.csv`.
- Empty state if no account has any turnover/balance in the period.

### `src/pages/treasury_v2/parts/ChessSheetTable.jsx`

- Calls `chessTurnover(ctx, window, officeFilter)`.
- Renders a grid inside a horizontally-scrollable container: a sticky top-left corner cell; the top header row is the Cr account codes (`<th title={name}>`); each body row starts with its Dr account code (`<th title={name}>`) then one cell per Cr account showing `formatBase(rows[dr][cr])` or blank when 0; a final right column "Итого по Дт" (`formatBase(rowTotals[dr])`) and a final bottom row "Итого по Кт" (`formatBase(colTotals[cr])`) with the grand total in the bottom-right corner.
- A small footnote: `t("trv2_to_chess_note")` — explains the proportional allocation of multi-leg transactions and that amounts are in `{baseCurrency}`.
- Empty state if `accounts` is empty (no transactions in the period).

### Drill-through

`TurnoverTab` builds the `txNodeById` map and an `onOpenTx` handler the same way `TreasuryShell` already does for the other tabs — actually `TreasuryShell` already passes `onOpenTx`/`onOpenSource` down to every tab component, so `TurnoverTab` just forwards `onOpenTx` to `TrialBalanceTable` → `AccountInlineEntries`. The Шахматка cells are **not** drillable in v1 (the ОСВ row-expand covers per-account drill).

## i18n

New `trv2_to_*` keys (en/ru/tr): `trv2_tab_turnover`, `trv2_to_view_osv`, `trv2_to_view_chess`, `trv2_to_col_opening`, `trv2_to_col_debit`, `trv2_to_col_credit`, `trv2_to_col_closing`, `trv2_to_col_account`, `trv2_to_col_currency`, `trv2_to_subtotal`, `trv2_to_total`, `trv2_to_class_revenue`, `trv2_to_class_expense`, `trv2_to_check_turnover`, `trv2_to_check_opening`, `trv2_to_check_closing`, `trv2_to_export_csv`, `trv2_to_chess_note`, `trv2_to_chess_row_total`, `trv2_to_chess_col_total`, `trv2_to_empty_osv`, `trv2_to_empty_chess`. (~22 keys.)

## Testing

JS tests against the existing `makeLedgerCtx` fixture in `src/lib/treasury/v2selectors.test.js` (extend it with one **balanced** multi-leg transaction so the chess allocation has a clean case — the current `tx_deal_1` fixture entries don't balance in base, which is a fixture artifact; add a `tx_deal_2` that does, or fix `tx_deal_1`):
- `trialBalance`: opening = current_balance − period rollback for a couple of accounts; debit/credit turnover; an account with zero activity in the period is omitted; class grouping; the three grand-total checks pass for a balanced fixture; office filter narrows the rows.
- `chessTurnover`: for a 2-leg tx (the opening tx: Dr cash / Cr opening-equity) the matrix cell is exact (= the amount); for a balanced multi-leg tx the proportional allocation; `rowTotals` equals each account's Dr turnover, `colTotals` equals each account's Cr turnover; accounts with no turnover are excluded.
- `TurnoverTab` render smoke + sub-view toggle (mock `useLedger`/`useBaseCurrency`/`useTranslation`/`useOffices` like the existing `TreasuryShell.test.jsx`).
- `TrialBalanceTable` and `ChessSheetTable` render tests against `makeLedgerCtx`-derived data.
- Extend `TreasuryShell.test.jsx`: the «Обороты» tab renders and opening it shows the ОСВ view.

## Out of scope (Spec C.3+)

- **Native-currency Шахматка matrices** (one matrix per currency). v1 chess matrix is base-currency only; the ОСВ shows native per-row.
- **Subconto-level ОСВ / Шахматка** (per-client / per-partner breakdown). Separate Spec C subconto item.
- **Drill from a Шахматка cell** to the underlying transactions. (The ОСВ row-expand covers per-account drill.)
- **Saved report configurations / scheduled CSV exports.**
- **A combined «оборотка» that mixes balance-sheet and P&L closing logic** (e.g. auto-closing revenue/expense into retained earnings at period end). v1 ОСВ just reports raw openings/turnovers/closings per account.

## References

- Spec B: `docs/superpowers/specs/2026-05-10-treasury-pnl-on-journal-entries-design.md` (lists Шахматка + subconto as deferred Spec C items).
- Spec C.1 (Posting Master): `docs/superpowers/specs/2026-05-10-posting-master-design.md`.
- Existing period-aggregation selector to mirror: `pnlForPeriod` / `aggregateClass` in `src/lib/treasury/v2selectors.js`.
- Existing components to reuse: `PeriodPicker`, `AccountInlineEntries`, `BalanceCheckBar` (style reference), `ClassSection` (style reference).
- Sign convention: `ledger.balances` (verified prod 2026-05-10 — magnitude on normal side), `balanceCheckTotals` / `groupByClass` in `v2selectors.js`.
