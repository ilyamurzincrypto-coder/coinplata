# Treasury & P&L on Journal Entries — Design Spec (Spec B)

**Status:** approved-pending-user-review
**Date:** 2026-05-10
**Predecessor spec:** `2026-05-10-v2-ledger-revival-design.md` (Spec A) — Phase 1+2 merged; Phase 3 cutover retry in PR #24 (preview).
**Branch:** to be created off `main` once v2 cutover retry merges (Spec A Phase 3). The Spec B implementation depends on `ledger.transactions` actually populating from real cashier deals — no point shipping Treasury before that.

---

## Goal

Replace the May-9 Treasury MVP (single-page "dashboard" on legacy account_movements — owner explicitly rejected as "хуйня") with a real accountant-grade Treasury sitting on top of `ledger.journal_entries`. Owner explicitly asked for:

1. **3 balance-sheet tabs** (Активы / Пассивы / Капитал) derived from `ledger.accounts.type`.
2. **P&L tab** with period picker, revenue/expense/FX gain-loss breakdown, Net Profit.
3. **Inline office picker** + virtual "All offices" mode (independent of the global Header office switcher).
4. **Журнал tab** — chronological tree of all `ledger.transactions`, expandable to show paired Dr/Cr `journal_entries` per row, click-through to source document.
5. **Inline проводки on every account row** in the balance-sheet tabs (last N entries shown when row is expanded).
6. **Sticky balance-sheet identity check** at the bottom: `Σ Активы = Σ Пассивы + Σ Капитал` — green when balanced, red with delta when not.

## Non-goals

- Treasury edit / posting from UI. All Treasury views are read-only in MVP. Posting happens through the existing cashier flow (DealForm → `dealOperations.createDeal` → `ledger.create_deal_v2`). Manual posting / journal-entry editor / `Posting Master` style is deferred.
- External-platform reconciliation (Kraken / Binance / Clear Junction APIs). Same deferral as before.
- Forecast / budgeting (Cashflow forecasting, payment calendar in 1С terms). Out of scope.
- Multi-tenant. Single-org assumption.
- RLS hardening on `ledger.*`. Security follow-up; doesn't block this feature inside the org.
- Realtime push for *every* tab. Only Журнал tab subscribes to fresh transactions; balance-sheet tabs refresh on data-bump events (existing pattern).

## Hard dependency on Spec A Phase 3

This spec assumes `ledger.transactions` and `ledger.journal_entries` populate from real cashier deals. As of 2026-05-10:

- Phase 1 (frontend coverage) — merged to main (PR #20).
- Phase 2 (backfill 13 opening journal entries) — merged to main (PR #21).
- Phase 3 (cutover) — first attempt (PR #22) caused a white screen; rolled back via PR #23. Retry pending in PR #24 via preview deployment.

Implementation of Spec B starts after PR #24 merges and at least 24 hours of clean v2 production traffic confirms no regressions.

## Architecture

Frontend-only feature, no DB migrations, no new RPC. Reuses the existing 174-account chart of accounts and the v2 transaction/entry tables.

### File layout

```
DELETE (May-9 Treasury MVP):
  src/pages/treasury/Dashboard.jsx
  src/pages/treasury/components/AlertBar.jsx
  src/pages/treasury/components/KPICards.jsx
  src/pages/treasury/components/BalancesByTypeTable.jsx
  src/pages/treasury/components/CurrencyBreakdownTable.jsx
  src/pages/treasury/components/MovementTimeline.jsx
  src/pages/treasury/components/EmptyState.jsx
  src/lib/treasury/selectors.js
  src/lib/treasury/selectors.test.js
  src/i18n/translations.jsx — старые tr_* ключи группы Treasury MVP

CREATE (Spec B):
  src/pages/TreasuryPage.jsx                          ← rewrite from scratch
  src/pages/treasury_v2/
    TreasuryShell.jsx              header + office picker + tabs + sticky balance bar
    OfficePicker.jsx               5 опций с All-offices, localStorage state
    BalanceCheckBar.jsx            sticky bottom indicator
    PeriodPicker.jsx               для P&L и Журнала, 5+ presets + custom range
    tabs/
      AssetsTab.jsx                группы по subtype, AccountRow, inline entries
      LiabilitiesTab.jsx           same shape
      EquityTab.jsx                same shape, balance identity readout
      PnLTab.jsx                   period picker, 4 sections (rev / exp / fx / net)
      JournalTab.jsx               древо транзакций, фильтры, transaction tree
    parts/
      AccountRow.jsx               одна строка счёта (collapsed/expanded)
      AccountInlineEntries.jsx     до 50 последних проводок под раскрытой строкой
      TransactionRow.jsx           одна строка в Журнале
      TransactionEntries.jsx       Dr/Cr таблица внутри транзакции
      TransactionDetail.jsx        панель с full контекстом + ссылкой на документ
      EntryRow.jsx                 одна Dr/Cr строка
      ClassSection.jsx             группирующая секция в balance-sheet tabs
  src/store/ledger.jsx                              ← новый provider, ledger.* store
  src/lib/ledgerReaders.js                          ← supabase queries для ledger.*
  src/lib/treasury/v2selectors.js                   ← pure-fn selectors
  src/lib/treasury/v2selectors.test.js              ← unit tests
  src/i18n/translations.jsx — добавить ~80 trv2_* ключей (en/ru/tr)
  src/App.jsx                                       ← LedgerProvider в provider chain
```

### Provider chain in App.jsx

Insert `LedgerProvider` between `Permissions` and `Audit`:

```
I18n → Auth → Offices → Currencies → Permissions
  → Audit → Rates → Accounts → IncomeExpense → Transactions
  → Ledger ★new★    ← reads ledger.* schema only, isolated from legacy stores
  → Root
```

### Data sources

| Hook | Provides | Source |
|---|---|---|
| `useLedger()` (NEW) | `accounts`, `balances`, `transactions`, `entries`, `setOfficeFilter`, `setPeriod` | `ledger.accounts`, `ledger.balances`, `ledger.transactions`, `ledger.journal_entries` via new `ledgerReaders.js` |
| `useBaseCurrency()` (existing) | `toBase(amount, currency)`, `formatBase(amount, currency)`, `baseCurrency` | composes Auth.settings + Rates |
| `useOffices()` (existing) | `findOffice(id)`, `activeOffices` | for office picker labels |
| `useCan("capital")` (existing) | permission gate | upstream guard in App.jsx routing |

`LedgerProvider` loads `accounts` once on mount (174 rows; cache for session). It loads `balances` snapshot on mount + on `onDataBump` events. `transactions` and `entries` are loaded with a window — initial 90 days. The Журнал tab can extend the window via period picker; lazy-load older slices on demand.

### Selectors (pure functions, fixture-tested)

```js
// src/lib/treasury/v2selectors.js

groupByClass(ctx, accountType)
  // Returns sections per subtype:
  //   { subtype: 'cash', label: 'Касса', accounts: [{ code, name, currency, balance, balanceInBase }], totalInBase }
  //   { subtype: 'bank', ... }
  // Filtered by ctx.officeFilter; "all" includes office_id IS NULL accounts.

accountEntries(ctx, accountId, limit = 50)
  // Returns last N journal entries for an account, joined with transaction header:
  //   [{ id, date, direction, amount, currencyCode, txId, txKind, sourceLabel, sourceLink }]

transactionTree(ctx, opts = { type, period, officeFilter })
  // Returns chronologically-sorted transactions matching filter:
  //   [{ tx: { id, date, kind, sourceLabel }, entries: [{ Dr/Cr rows }] }]
  // Filter by type ∈ {'all','deal','transfer','topup','adjustment','reversal'}.

pnlForPeriod(ctx, period, officeFilter)
  // Returns:
  //   { revenue: { total, accounts[] }, expense: { ... }, fxGain: ..., fxLoss: ..., netProfit }
  // accounts[] = subtype-grouped: [{ code, name, currency, amountInBase, entryCount }]

balanceCheckTotals(ctx, officeFilter)
  // Returns:
  //   { assets, liabilities, equity, identityCheck: { ok: boolean, delta: number } }
  // Used by sticky BalanceCheckBar at the bottom.
```

All selectors are pure — they take a `ctx` produced from the LedgerProvider state plus the active filters. Easy to unit-test with fixtures (matches the May-9 selector pattern).

## Components

### `<TreasuryShell>` (orchestrator)

```jsx
<TreasuryShell>
  <header>
    <h1>Казначейство</h1>
    <OfficePicker value={officeFilter} onChange={setOfficeFilter} />
    <span className="data-freshness">обновлено {time}</span>
  </header>
  <Tabs active={activeTab} onChange={setActiveTab}>
    <Tab id="assets"      label="Активы"    component={AssetsTab} />
    <Tab id="liabilities" label="Пассивы"   component={LiabilitiesTab} />
    <Tab id="equity"      label="Капитал"   component={EquityTab} />
    <Tab id="pnl"         label="P&L"       component={PnLTab} />
    <Tab id="journal"     label="Журнал"    component={JournalTab} />
  </Tabs>
  <BalanceCheckBar />
</TreasuryShell>
```

### `<OfficePicker>`

Dropdown with 5 options: 4 real offices + "All offices". Stores selection in `localStorage.coinplata.treasury_office` (default `"all"`). Independent from global Header office picker (different localStorage key, doesn't sync).

### `<AssetsTab>` / `<LiabilitiesTab>` / `<EquityTab>` (same shape)

```jsx
<Tab>
  {sections.map(({ subtype, label, accounts, totalInBase }) => (
    <ClassSection key={subtype} label={label} totalInBase={totalInBase}>
      {accounts.map(a => (
        <AccountRow account={a} expanded={expanded === a.id}>
          {expanded === a.id && <AccountInlineEntries accountId={a.id} />}
        </AccountRow>
      ))}
    </ClassSection>
  ))}
</Tab>
```

`<AccountRow>` is collapsed by default. Click → expand to show last 50 entries inline (more via "Показать все" → opens drawer with paginated full ledger).

### `<JournalTab>`

```jsx
<Tab>
  <JournalFilters>
    <PeriodPicker value={period} onChange={setPeriod} />
    <TypeFilter   value={typeFilter} onChange={setTypeFilter} />
  </JournalFilters>
  <TransactionList>
    {transactions.map(t => (
      <TransactionRow tx={t} expanded={expanded === t.id}>
        {expanded === t.id && (
          <>
            <TransactionEntries entries={t.entries} />
            <a onClick={openSourceDoc}>Open {t.sourceLabel}</a>
          </>
        )}
      </TransactionRow>
    ))}
  </TransactionList>
</Tab>
```

### `<PnLTab>`

```jsx
<Tab>
  <PeriodPicker value={pnlPeriod} onChange={setPnlPeriod} />
  <PnLSection label="Доходы (Revenue)" total={pnl.revenue.total}>
    {pnl.revenue.accounts.map(a => <PnLAccountRow account={a} />)}
  </PnLSection>
  <PnLSection label="Расходы (Expense)" total={pnl.expense.total} sign="−" />
  <PnLSection label="FX gain / loss" total={pnl.fxNet} sign="±" />
  <PnLNetProfit value={pnl.netProfit} />
  <PnLActions>[Export CSV] [Compare with previous period]</PnLActions>
</Tab>
```

### `<BalanceCheckBar>` (sticky bottom)

Always visible regardless of active tab:

```
─── Balance check: Активы 32100 = Пассивы 27500 + Капитал 4600 ✓ ───
```

If `Math.abs(delta) > 0.01` → `❌ Ledger out of balance: delta = +X.YZ USD eq`. Both states clickable → open a drawer with the per-currency identity check + which currency contributed to the delta.

## P&L formulas

Per `account.type`:

| Class | P&L sign | Aggregate over period |
|---|---|---|
| `revenue` | `+ Σ(Cr) − Σ(Dr)` (revenue normally credited) | per account, then per subtype, then total |
| `expense` | `+ Σ(Dr) − Σ(Cr)` (expense normally debited) | same |
| `equity, subtype IN ('fx_gain','fx_loss')` | gain: `+(Cr−Dr)`; loss: `−(Dr−Cr)`; net: `Σfx_gain − Σfx_loss` | special handling — fx subtypes are technically equity rows but live in P&L |

```
Net Profit = Revenue − Expense + FX_net
```

All sums in **base currency**. Native amounts shown in drill-down.

## Period picker behavior

Storage: `localStorage.coinplata.treasury_pnl_period` (default `"month"`). Same picker in Журнал tab uses `coinplata.treasury_journal_period` (default `"30d"`).

| Preset | Window |
|---|---|
| Сегодня | `[startOfDay UTC, now]` |
| Неделя | `[startOfWeek (Monday 00:00 UTC), now]` |
| Месяц (default for P&L) | `[1-st of current month 00:00 UTC, now]` |
| Квартал | `[start of current quarter (Jan 1, Apr 1, Jul 1, Oct 1), now]` |
| Год | `[Jan 1 of current year, now]` |
| 30 дней (default for Журнал) | `[now − 30 days, now]` |
| Custom | datepicker `from / to` |

## Office filter behavior

`useLedger().officeFilter` is `"all"` or a UUID. Selectors filter as follows:

- For `accounts`: `account.office_id === officeFilter` (or no filter when `"all"`).
- For `balances`: same per `account.office_id` lookup.
- For `entries` and `transactions`: fall through to the underlying account's `office_id`. Entry's account is found via `entries[i].account_id` → `accounts[].id`.
- Accounts with `office_id IS NULL` (Treasury wallets, inter-office, equity-class) are **included in `"all"`** but **excluded when a specific office is selected** (owner decision: they're not attributable to a single office).

## Edge cases

| Case | Handling |
|---|---|
| `journal_entries` empty (e.g., immediately after Phase 3 cutover before any deal) | All 4 balance-sheet tabs show only opening balances (13 entries from Phase 2 backfill). P&L shows zeros. Журнал shows the opening transaction. No spinner-of-doom. |
| Period with 0 entries | Empty state in P&L: "Нет операций за выбранный период". Журнал: "Транзакций нет". |
| Balance identity check fails | Sticky bar turns red; clicking opens drawer with per-currency breakdown showing which currency mismatches. Likely cron alert fired too — surface a link to `audit_alerts`. |
| User has no rate for currency X (`toBase` returns 0 / undefined) | Skip from base aggregation; show native amount + "💱 курс не задан" badge. Add an info alert in BalanceCheckBar drawer. |
| Account with `client_dim_required` or `partner_dim_required` shows multiple rows per dimension | Group by `(account_id, currency_code, client_id, partner_id)` matching `ledger.balances` PK shape. Display the dimension as sub-row label ("Клиент: Иван Петров"). |
| Reversed transaction (`reverses_transaction_id IS NOT NULL`) | Marked in Журнал with a ↺ badge; the original transaction also gets a "reversed" badge. Both rows visible. |
| Office "Москва Вася" has accounts but no `office_id` mapping consistency | Confirmed in Spec A: there are 4 real office_ids in `ledger.accounts`, including Москва Вася (`12b68624-…`). Office picker reads them via `useOffices()` (existing source) — make sure it includes all 4 or add a fallback list from `DISTINCT ledger.accounts.office_id`. |
| Transaction with 0 entries (shouldn't exist but defensive) | Filter out from Журнал. Log to audit. |

## Permissions

Same `capital` permission as the May-9 MVP. All Treasury views are read-only — no need for a separate `accounting:edit` level in this spec. A future spec for "Posting Master" / manual journal entries would introduce that.

## Performance budget

| Operation | Budget |
|---|---|
| First paint of Treasury (any tab) | < 1 s after `LedgerProvider` mount |
| Tab switch | < 100 ms (everything in memory) |
| Account expand → 50 entries inline | < 50 ms (in-memory filter) |
| Period picker change → reload P&L | < 500 ms (selector recompute, no refetch unless period extends past loaded window) |
| Балансовое тождество check | recomputed on every state change via `useMemo`, < 10 ms |

`LedgerProvider` data load on mount: 174 accounts (cached), `balances` snapshot (< 200 rows expected), `transactions` last 90 days, `entries` last 90 days. Total payload ≤ 500 KB JSON expected.

For older periods (Журнал year+, P&L year): trigger a background fetch with a UI loading indicator. If `entries` count grows past 10 000 in a window, paginate or use server-side aggregation for P&L (defer to Spec C if needed).

## Testing

- **Unit tests** for all 5 selectors with fixture-driven cases (matches the May-9 pattern). Specifically:
  - `groupByClass` for each of asset / liability / equity, with office filter active and "all".
  - `accountEntries` with limit applied, sort order, dimension grouping.
  - `transactionTree` with type / period / office filters.
  - `pnlForPeriod` covering revenue / expense / fx_net / net_profit, with edge cases (0 entries, missing rates).
  - `balanceCheckTotals` — both balanced and unbalanced fixtures.
- **Smoke render** for each of 5 tabs with mocked `useLedger()` and `useBaseCurrency()` providers. Assert no throw, headers present, account rows render.
- **No e2e**. Manual smoke after merge: open `/treasury` in dev with v2 active → verify each tab loads, identity bar reads `✓`, account expand works, Журнал shows recent transactions, P&L shows non-zero net profit if test deals exist.

## Acceptance criteria

A reviewer should confirm at the end:

1. `npm run test` — all selector tests pass; baseline + new ~30-40 tests stay green.
2. `npm run build` — clean (chunk size warning is pre-existing).
3. Open `/treasury` in dev with v2 active in `.env.local`:
   - 5 tabs render: Активы / Пассивы / Капитал / P&L / Журнал.
   - Office picker has 5 options; switching changes the data.
   - Click an account → inline entries expand below.
   - Switch to Журнал → see chronological transactions; expand one → see Dr/Cr table balanced; click "Open Deal #N" → navigates to existing TransactionsTable / DealDetailPanel.
   - Switch to P&L → period picker works; numbers change; click revenue account → entries expand.
   - Sticky balance bar shows `✓` (post-Phase-2 backfill makes opening balance Σ Активы = Σ Капитал; once new deals exist, Σ Активы = Σ Пассивы + Σ Капитал should still hold).
4. The May-9 MVP files (`Dashboard.jsx`, `selectors.js`, etc.) are deleted.
5. `useLedger()` correctly subscribes to `onDataBump` so creating a new deal in Cashier within an open Treasury session refreshes balances + transaction count within ~2 s.

## Out of scope (deferred)

- **Posting Master / manual journal entry editor** — a future Spec C. Owner-direction: "Treasury MVP is read-only; bookkeeper sees but doesn't edit; edits happen through cashier flow or via reversal."
- **Шахматка-style cross-tab report** (account × account matrix). 1С classic; nice-to-have. Defer.
- **Subconto / dimension analysis** (drill into per-client / per-partner balances). The data is there (entries have `client_id` / `partner_id`); UI surface is deferred to Spec C.
- **Forecast / budgeting / payment calendar**. Out.
- **External BI export** (CSV is in MVP for P&L only; full Power-BI / Postgres replication is deferred).

## References

- `docs/superpowers/specs/2026-05-10-v2-ledger-revival-design.md` — Spec A, prereq.
- `docs/superpowers/specs/2026-05-09-treasury-mvp-design.md` — May-9 MVP, **superseded** by this spec.
- `docs/PRODUCTION_REALITY_CHECK.md` — diagnostic, partly outdated post-Phase-2.
- `docs/CUTOVER_RUNBOOK.md` — cutover playbook.
- Memory: `project_v2_direction.md` — owner alignment that the product is real bookkeeping.
- Owner's competitor analysis (1С/Crassula screens) — UX reference for tree-of-deals + chart-of-accounts navigation.
