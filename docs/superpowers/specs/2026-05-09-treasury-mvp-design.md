# Treasury Dashboard MVP — Design Spec

**Status:** approved-pending-user-review
**Date:** 2026-05-09
**Branch target:** new branch off `main` (post-PR-#18 squash `59fdd6e`)
**Related plan:** to be authored by `writing-plans` skill after this spec is approved.

---

## Goal

Replace the three placeholder tabs in `src/pages/treasury/` (Nostro / Loro / Capital) with a single working `Dashboard` screen that gives the casino-cashier-owner an at-a-glance picture of money under management for a chosen office, plus immediate operational signals (overdue obligations, negative balances, stuck pending tx, stale rates).

Inspired by the user's competitor-analysis sketch (alert bar + 4 KPI cards + reconciliation table + currency breakdown + activity timeline) — adapted to current legacy data and to single-office scope.

## Non-goals (explicitly out of MVP)

- Multi-office aggregation. MVP shows one office at a time, switched via the existing global `currentOffice` selector.
- External-platform reconciliation drift (Kraken / Binance / Clear Junction API). No integrations exist; "drift" column omitted entirely.
- v2 ledger consumption. v2 is killed by `VITE_FORCE_V2`-required kill-switch (see `CLAUDE.md` "Feature flags"). MVP reads only legacy stores.
- Drill-down into individual accounts on each grouped row.
- CSV export, charts (pie / line), period comparisons beyond "vs yesterday".
- Realtime push updates. Data refreshes via the same React render cycle as the rest of the app.

## Architecture

Frontend-only feature, no DB migrations, no new RPC, no new providers. Reuses existing context hooks.

### File layout

```
src/pages/treasury/
  TreasuryPage.jsx             # ← edit: drop tab UI, render Dashboard, accept currentOffice prop
  Dashboard.jsx                # ← new: orchestrator (hooks → selectors → subcomponents)
  components/
    AlertBar.jsx               # ← new: collapsed if no alerts; severity-colored chips
    KPICards.jsx               # ← new: 4 cards with delta vs yesterday
    BalancesByTypeTable.jsx    # ← new: rows = account type (cash/bank/crypto/partner)
    CurrencyBreakdownTable.jsx # ← new: rows = currency, sorted by total-in-base desc
    MovementTimeline.jsx       # ← new: last 50 movements involving this office's accounts
    EmptyState.jsx             # ← new: shown when office has no accounts
src/lib/treasury/
  selectors.js                 # ← new: pure functions (computeKPIs, computeAlerts, ...)
  selectors.test.js            # ← new: unit tests with fixtures
src/i18n/translations.jsx      # ← edit: add tr_* keys for new UI strings (en/ru/tr)
src/App.jsx                    # ← edit: pass currentOffice to TreasuryPage
```

### Files to delete

- `src/pages/treasury/NostroTab.jsx`
- `src/pages/treasury/LoroTab.jsx`
- `src/pages/treasury/CapitalTab.jsx`

These are 18-line placeholders, only imported by `TreasuryPage.jsx`. After the edit they become unreachable.

### Data sources (all existing)

| Hook | Used for |
|---|---|
| `useAccounts()` → `accounts`, `balanceOf`, `reservedOf`, `availableOf`, `movements` | Balances, currency breakdown, timeline, "negative balance" alert |
| `useObligations()` → `obligations` | Liabilities KPI, overdue/approaching alerts |
| `useTransactions()` → `transactions` | Activity KPI, stuck-pending alert |
| `useRates()` → `rates`, `lastConfirmedAt`, `modifiedAfterConfirmation` | Stale-rate alert, base-currency conversion |
| `useOffices()` → `findOffice` | Office name in header |
| `useBaseCurrency()` → `toBase`, `formatBase`, `baseCurrency` | All cross-currency aggregations |
| `useCan("capital")` (in App-level guard) | Permission gate (already enforced upstream) |

### Office filtering

`currentOffice` is App-level state in `src/App.jsx:74-87` (localStorage key `coinplata.office`, default `"mark"`). The same value is already passed to Cashier, Header, Balances, etc. — Treasury follows the same pattern.

`Dashboard` accepts `officeId` as a prop. Every selector filters by it:

- `accounts.filter(a => a.officeId === officeId)` — primary scope.
- `obligations.filter(o => o.officeId === officeId)`.
- `transactions.filter(t => t.officeId === officeId)`.
- `movements.filter(m => officeAccountIds.has(m.accountId))`.

Office switcher in `Header.jsx` updates `currentOffice` → re-render → Dashboard recomputes.

## Components

### `Dashboard.jsx`

Top-level orchestrator. Reads hooks, runs selectors via `useMemo`, hands rendered slices to subcomponents. Pseudocode:

```jsx
export default function Dashboard({ officeId }) {
  const { accounts, balanceOf, reservedOf, movements } = useAccounts();
  const { obligations } = useObligations();
  const { transactions } = useTransactions();
  const { rates, lastConfirmedAt, modifiedAfterConfirmation } = useRates();
  const { findOffice } = useOffices();
  const { toBase, formatBase, baseCurrency } = useBaseCurrency();

  const ctx = useMemo(() => ({
    officeId, accounts, movements, obligations, transactions,
    rates, lastConfirmedAt, modifiedAfterConfirmation,
    balanceOf, reservedOf, toBase, baseCurrency,
  }), [officeId, accounts, movements, obligations, transactions,
       rates, lastConfirmedAt, modifiedAfterConfirmation, baseCurrency]);

  const alerts        = useMemo(() => computeAlerts(ctx),       [ctx]);
  const kpis          = useMemo(() => computeKPIs(ctx),         [ctx]);
  const byType        = useMemo(() => groupByAccountType(ctx),  [ctx]);
  const byCurrency    = useMemo(() => groupByCurrency(ctx),     [ctx]);
  const timeline      = useMemo(() => lastNMovements(ctx, 50),  [ctx]);

  const officeAccounts = accounts.filter((a) => a.officeId === officeId);
  if (officeAccounts.length === 0) return <EmptyState officeName={findOffice(officeId)?.name} />;

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <DashboardHeader office={findOffice(officeId)} baseCurrency={baseCurrency} />
      <AlertBar alerts={alerts} />
      <KPICards kpis={kpis} formatBase={formatBase} />
      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <BalancesByTypeTable rows={byType} formatBase={formatBase} />
        <CurrencyBreakdownTable rows={byCurrency} formatBase={formatBase} />
      </div>
      <MovementTimeline items={timeline} />
    </main>
  );
}
```

### `AlertBar.jsx`

Renders 0..N `Alert` chips. If `alerts.length === 0`, renders nothing (no banner takes space).

`Alert` shape:

```ts
{
  id: string,           // 'overdue_obligations' | 'approaching_obligations' | 'negative_balance' | 'stuck_pending' | 'stale_rate'
  severity: 'error' | 'warning' | 'info',
  message: string,      // localised, e.g. "3 obligations overdue (¥124,000 USDT)"
  count?: number,
  link?: { page: string, target?: string },  // optional: navigates via existing handlePageChange
}
```

Severity → color: `error` = rose, `warning` = amber, `info` = sky.

### `KPICards.jsx`

Four cards in a row (responsive: 4-col grid on `lg+`, 2-col on `md`, stack on mobile).

| Card | Value | Delta | Note |
|---|---|---|---|
| **Total balance** | Σ `balanceOf(a)` over office accounts (types: `cash`, `bank`, `crypto`) → `toBase` | `(today − yesterday) / yesterday × 100` | Pure money tracker. Partner accounts excluded (they're scoped per-partner, not per-office). |
| **Liabilities** | Σ open obligations where `direction='we_owe' && status='open' && officeId === currentOffice` → `toBase` | same formula | Only post-completion debts. Reserved-OUT movements deliberately excluded — they already reduce `availableOf` and aren't an extra owed amount yet. |
| **Available funds** | Σ `availableOf(a)` over office accounts (cash/bank/crypto) → `toBase` | same formula | What we can deploy right now. Already accounts for reserved earmarks. |
| **Activity (24h)** | count of `transactions` where `officeId === currentOffice && createdAt > now − 24h` | `(today − prior_24h)` absolute | Volume signal. |

Delta rendering:
- positive → green `+1.2%`
- negative → rose `−0.4%`
- zero or `yesterday===0` → grey `—`

### `BalancesByTypeTable.jsx`

Main table. Rows = account type, columns = available / reserved / total / total in base.

Account types in `public.accounts` (per `store/data.js` seed) are `cash`, `bank`, `crypto`. We map to display labels:

| `account.type` | Label (en) | Label (ru) | Label (tr) |
|---|---|---|---|
| `cash` | Cash | Касса | Kasa |
| `bank` | Bank | Банк | Banka |
| `crypto` | Crypto wallet | Крипто-кошелёк | Kripto cüzdan |
| _(any other)_ | Other | Прочее | Diğer |

Per-row totals are computed in base currency (sum of `toBase(balance, account.currency)`). Account count shown as a small badge. Empty types (no accounts of that type in this office) are hidden.

**Partner accounts** are intentionally excluded from this table — they're a per-partner concept (no `officeId`) and would mix scopes. Partner debt visibility comes via the Liabilities KPI (open obligations).

### `CurrencyBreakdownTable.jsx`

Sidebar table. Rows = currency, sorted by `totalInBase` desc. Columns: currency code, available (native), reserved (native), total (native), total in base.

Currencies present = unique `account.currency` over office's accounts. If `accounts` mixes `currency` and `currency_code` keys (legacy seed quirk), normalize to `currency.toUpperCase()`.

### `MovementTimeline.jsx`

Last 50 movements involving office's accounts. Each row:

- relative time (`5m ago`, `Yesterday 14:30`)
- account name (truncated)
- direction icon (↗ in / ↘ out)
- amount + currency
- source kind chip (`deal` / `topup` / `transfer_in` / `transfer_out` / `exchange_in` / `exchange_out` / `income` / `expense` / `opening`)
- ref id link if present (`#42` opens transaction)

Empty state: "Нет движений за этот период."

### `EmptyState.jsx`

Shown when office has zero accounts. Centered card: icon + "В офисе {name} пока нет счетов" + a CTA ("Создать счёт" → navigates to AccountsPage).

## Selectors

Pure functions in `src/lib/treasury/selectors.js`. No hooks, no side effects, fully unit-testable.

### `computeKPIs(ctx)`

Single pass over filtered `accounts` + `obligations` + `transactions`. Returns:

```ts
{
  totalAssets:    { value: number, valueInBase: number, delta: number | null },
  liabilities:    { value: number, valueInBase: number, delta: number | null },
  netPosition:    { value: number, valueInBase: number, delta: number | null },
  activity24h:    { count: number, delta: number | null },
  baseCurrency:   string,
}
```

Yesterday-snapshots reuse the same code paths but with `movements.filter(m => m.createdAt < startOfToday)`. `delta = null` if yesterday-value is 0 (avoid division-by-zero).

### `computeAlerts(ctx)`

Returns `Alert[]` produced from these checks (in this order so most urgent appears first):

1. **`overdue_obligations`** — `obligations.filter(o => o.status === 'open' && o.plannedAt && o.plannedAt < now())`. Severity: `error`.
2. **`approaching_obligations`** — `obligations.filter(o => o.status === 'open' && o.plannedAt > now && o.plannedAt < now + 24h)`. Severity: `warning`.
3. **`negative_balance`** — `accounts.filter(a => balanceOf(a.id) < 0)`. Severity: `error`.
4. **`stuck_pending`** — `transactions.filter(t => t.status === 'pending' && t.createdAt < now - 24h)`. Severity: `warning`.
5. **`stale_rate`** — fires if `lastConfirmedAt < now - 24h` OR `modifiedAfterConfirmation === true`. Severity: `info`.

Each check folds the matching items into a single Alert with `count` and a localised summary (e.g. "3 obligations overdue · ¥124k USDT eq"). Click → navigation hint via the optional `link` field.

### `groupByAccountType(ctx)`

Filters `accounts` by `officeId`, buckets by `account.type`, computes:

```ts
[
  { type: 'cash', label: 'Cash', count: 3, available: 50000, reserved: 5000,
    total: 50000, totalInBase: 50000, currencies: ['USD','EUR'] },
  ...
]
```

`totalInBase` = `Σ toBase(balanceOf(a.id), a.currency)`.

### `groupByCurrency(ctx)`

Filters `accounts` by `officeId`, buckets by normalized `account.currency`, computes available / reserved / total / totalInBase. Sort by `totalInBase` desc.

### `lastNMovements(ctx, n)`

Filters `movements` to those whose `accountId` is in the office's account set, sorts by `createdAt` desc, slices first `n`. Joins `account.name` for display.

## Layout

Single-column page, max width 1300px (matches existing `TreasuryPage.jsx`). Vertical stack:

```
┌──────────────────────────────────────────────────────────────────┐
│ Treasury · Mark Antalya                base: USD       fresh as 14:32 │  ← Header
├──────────────────────────────────────────────────────────────────┤
│ ⛔ 3 obligations overdue (¥124k USDT)  ⚠ 2 stuck deals      ✕   │  ← AlertBar (hidden if empty)
├──────────────────────────────────────────────────────────────────┤
│ ┌─Total assets─┐ ┌─Liabilities─┐ ┌─Net pos.─┐ ┌─Activity 24h─┐  │  ← KPI row
│ │ 1,240,500 USD│ │ 240,000 USD │ │1,000,500 │ │ 18 deals     │  │
│ │   +1.2% vs yd│ │  −0.4% vs yd│ │ +1.5% vs │ │ +6 vs prior  │  │
│ └──────────────┘ └─────────────┘ └──────────┘ └──────────────┘  │
├──────────────────────────────────────────┬───────────────────────┤
│  Balances by type                        │ By currency           │
│  ┌─Type──────Available─Reserved─Total─┐  │ ┌─Cur──Total──Base─┐  │
│  │ Cash (3)   50k USD   5k    50k USD │  │ │ USD  50000  50k │  │
│  │ Bank (1)   1.2M TRY  0     1.2M    │  │ │ TRY  1.67M  55k │  │
│  │ Crypto (1) 45.3k USDT 200  45.3k   │  │ │ USDT 45300  45k │  │
│  └────────────────────────────────────┘  │ └─────────────────┘  │
├──────────────────────────────────────────┴───────────────────────┤
│  Recent movements (last 50)                                       │
│  5m ago   Mark Antalya Cash USD     ↘  -1000 USD   exchange_out  │
│  12m ago  Hot wallet TRC20 USDT     ↗  +980 USDT   exchange_in   │
│  ...                                                              │
└───────────────────────────────────────────────────────────────────┘
```

Responsive: under `lg` (≤1024 px) the two-column section stacks. Under `md` the KPI row becomes 2-col, then 1-col on mobile.

## Permissions

Treasury is gated upstream in `App.jsx:194` by `canShow("capital")`. This stays. No per-component permission checks needed — if user reaches the page, they have at least `view` on `capital` section.

## Edge cases

| Case | Handling |
|---|---|
| Office has no accounts | render `<EmptyState officeName={...} />`, skip all selectors |
| `baseCurrency` unset / no rate available for some currency | per-account: skip from `valueInBase` totals, keep native total. Add an `info` alert "Курс для X→base не задан" |
| Movements older than yesterday-snapshot cutoff | not reflected in `delta`; treated as steady-state |
| Account with `currency` AND `currency_code` (legacy quirk) | normalize: `(a.currency || a.currency_code).toUpperCase()` |
| Future-dated `tx.createdAt` | clamps to now for the `stuck_pending` check |
| `obligations` with `plannedAt = null` | excluded from overdue/approaching checks |
| Selector throws (defensive) | error boundary in Dashboard renders an inline "Не удалось рассчитать раздел X" tile, other sections still render |
| Transaction timestamp shape unclear (seed uses `time:"14:32"` + `date:"Apr 20"` strings; supabase real rows use ISO `createdAt`) | selectors normalize via a helper `txTimestamp(tx)` that returns `Date` from whichever field is present; missing → fallback to "now" so the row is included in "today" but never in "24h-ago snapshot" |

## Testing

- **Selectors** (`selectors.test.js`) — fixture-driven unit tests. One fixture per scenario:
  - office with cash + crypto + partner, mixed currencies
  - office with one currency only
  - office with overdue obligations
  - office with stuck pending tx
  - office with negative balance
  - empty office
- **Smoke render** (`Dashboard.test.jsx`) — mount Dashboard with mock providers, assert no throw, assert AlertBar renders correct count.

No new e2e or integration tests — covered by selector tests.

## Out of scope (explicit deferrals)

Documented here so future work doesn't duplicate.

- **Phase 2 ideas:** drill-down per account (expand row), CSV export, hourly auto-refresh, period selector (yesterday / week / month), comparison sparklines per KPI.
- **Phase 3 / waiting for v2:** reconciliation against external platforms (Kraken / Binance / Clear Junction APIs), realtime via Supabase channels, switch to `ledger.balances` + `ledger.transactions` once `VITE_FORCE_V2=true` is safe to set.
- **Multi-office aggregation:** an "All offices" virtual mode in `currentOffice`. Owner request, post-MVP.

## Acceptance criteria

A reviewer should be able to confirm:

1. `npm run test` — all selector tests pass; baseline 137+ tests still green.
2. `npm run build` — no errors.
3. Open `/treasury` in dev:
   - With office switcher set to `mark` (default), Dashboard renders with header "Mark Antalya".
   - 4 KPI cards show numbers (or `—` if no data).
   - Alert bar visible iff at least one alert condition is met (verifiable by toggling one obligation overdue).
   - BalancesByType + CurrencyBreakdown tables show non-empty rows.
   - MovementTimeline shows up to 50 most recent movements.
4. Switch office in Header → Dashboard re-renders for new office.
5. Office with no accounts (e.g., temporarily change `currentOffice` to a fresh seed) → EmptyState renders.
6. Three placeholder tab files removed from `src/pages/treasury/`.

## References

- User's competitor analysis (in conversation, 2026-05-09) — provides the visual concept and feature priorities.
- `docs/PRODUCTION_REALITY_CHECK.md` — establishes that Treasury is currently 3 placeholders and depends on real data.
- `CLAUDE.md` "Feature flags" section — explains why MVP can't sit on v2 ledger yet.
- `src/store/accounts.jsx` — movement engine and `balanceOf`/`reservedOf`/`availableOf` semantics.
- `src/store/baseCurrency.js` — `toBase` conversion via `useRates().getRate`.
