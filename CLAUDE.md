# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server on http://localhost:5173
npm run build     # produces dist/ (target ~100 KB gzip)
npm run preview   # serve dist/ locally
```

No test runner, linter, or type-checker is configured. Verify changes by running `npm run build` and exercising the feature in the dev server.

## Deploy

`git push` to the main branch → Netlify builds automatically (config in `netlify.toml`, SPA rewrite to `/index.html`). A `vercel.json` is kept for parity but Netlify is the live target.

## Architecture

### Stack and shape
Vite 5 + React 18 + Tailwind 3. No router, no state management library, no backend. All state lives in React Context providers in `src/store/`; seed data in `src/store/data.js`. Page switching is a `useState` in `App.jsx` gated by `useCan(section)` from the permissions matrix.

### Provider composition (App.jsx)
Order matters because later providers consume earlier ones:

```
I18n → Auth → Offices → Currencies → Permissions → Audit → Rates → Accounts → IncomeExpense → Transactions → Root
```

`Permissions` depends on `Auth.users`. `BaseCurrency` hook (`store/baseCurrency.js`) composes `Auth.settings.baseCurrency` with `Rates.getRate` — it's a hook, not a provider.

### Balance engine (critical)
Balances are **computed from `movements[]`**, never stored. Any operation that moves money (exchange, topup, transfer, income/expense) writes movements through `useAccounts()`. A single movement is:

```
{ accountId, amount (always positive), direction: "in" | "out",
  currency, reserved?: boolean,
  source: { kind, refId?, note? }, createdBy }
```

Three derived metrics per account:
- `balanceOf(id)` = Σ signed amounts where `reserved=false` (actual money on hand)
- `reservedOf(id)` = Σ of OUT movements where `reserved=true` (pending obligations)
- `availableOf(id)` = balanceOf − reservedOf

Source `kind` values: `opening | topup | transfer_in | transfer_out | exchange_in | exchange_out | income | expense`. Never compute balance from `account.balance` — that field is only a seed used to emit opening movements.

### Pending transactions and the reserved flag
Creating a transaction with `status: "pending"` still writes movements, but every movement gets `reserved: true`. These are excluded from `balanceOf` (so nothing has moved yet) and counted in `reservedOf` on the OUT side. When the deal completes, call `unreserveMovementsByRefId(tx.id)` — the same movements flip to `reserved: false` and now contribute to `balanceOf` normally.

`utils/reserved.js` has a separate visual layer that computes reserved totals directly from pending `transactions[]` without reading movements — used in Balances-style UIs.

### Edit transaction pattern
On edit, call `removeMovementsByRefId(tx.id)` then rebuild movements via `buildMovementsFromTransaction(tx, accounts, userId)` and re-add each. This is a simple rewrite strategy (no compensating entries); it's sufficient because movements are keyed by `source.refId`.

### Rates model: Currency → Channel → Pair
`store/rates.jsx` is three layers, not a flat `{from_to: rate}` map:

- **Channel** — a way to transfer a currency. Fiat channels are `cash|bank|sepa|swift`; crypto channels are always `kind: "network"` with `network` (TRC20/ERC20/BEP20) and a `gasFee`. Each currency has one channel flagged `isDefaultForCurrency`.
- **Pair** — `{ fromChannelId, toChannelId, rate, isDefault, priority }`. Exactly one pair per (fromCurrency, toCurrency) is `isDefault: true`; that's the one `getRate(from, to)` returns.
- Non-default pairs exist for alternate channels (e.g. USDT→TRY via ERC20 is a separate pair from the default TRC20 one).

Back-compat APIs `getRate / setRate / deleteRate / ratesFromBase` all operate on default pairs only. Creating alternate pairs requires `addPair({ fromChannelId, toChannelId, rate })` with explicit channels. `setRate` will NOT auto-create a default pair if none exists — it warns and no-ops.

Rates also track a confirmation lifecycle: `draft → confirmed` with `confirmedAt / confirmedBy` and `modifiedAfterConfirmation` flag. `RatesConfirmationBanner` surfaces this.

### Money math
Use `utils/money.js` — never raw `*` on currency amounts:
- `toMinor / fromMinor / minorToNumber` — integer-minor-unit arithmetic to avoid float drift
- `multiplyAmount(amount, rate, outputPrecision)` — precise amount × rate
- `computeRemaining({ amtIn, curIn, outputs, fee, feeType, getRate })` — single source of truth for remaining = amtIn − Σ(outputs back-in-curIn) − feeInCurIn. Note: for `feeType: "%"`, fee is NOT subtracted (it's already in the margin-adjusted output rates).
- `computeProfitFromRates({ amtIn, curIn, outputs, getRate })` — margin in USD from (actualRate vs marketRate). Used to auto-compute fee = `max(profitFromRates, minFeeUsd)`.
- `utils/convert.js` → `convert(amount, from, to, getRate)` with USD triangulation fallback.

### Base currency
`settings.baseCurrency` drives aggregated metrics (Capital dashboards, Balances totals, referrals, LTV). Source data stays in its native currency; display-time conversion goes through `useBaseCurrency().toBase(amount, fromCur)` / `formatBase(amount, fromCur)`.

### Permissions
`store/permissions.jsx` resolves effective permissions as `ROLE_DEFAULTS[user.role] ⊕ overrides[userId]`. Sections: `transactions, capital, accounts, referrals, income_expense, settings, audit`. Levels: `disabled < view < edit`. `useCan()` returns a predicate: `can(section)` = ≥view, `can(section, "edit")` = edit.

Menu filtering in `Header.jsx` and page guards in `App.jsx` both use `useCan`. Page→section mapping lives in `App.jsx:PAGE_SECTION`.

### Money flow cheat sheet
- **Exchange create**: `addTransaction(tx)` → `removeMovementsByRefId(tx.id)` (dedup) → `buildMovementsFromTransaction(tx, accounts, userId)` → `movements.forEach(addMovement)` → `logAudit(...)`. Pattern lives in `CashierPage.jsx`.
- **Exchange edit**: same, in `EditTransactionModal.jsx`.
- **Top up / Transfer / Income-Expense**: go directly through `useAccounts().topUp / transfer / addMovement`. Each writes movements; `transfer` also writes a `transfers[]` record.
- **Account missing**: `buildMovementsFromTransaction` returns `warnings[]` instead of failing. The IN or OUT movement is simply skipped. This is intentional — a non-blocking warning surfaces in UI; nothing auto-picks an account.

### i18n
`src/i18n/translations.jsx` is a single `DICT` object with `en / ru / tr` keys. All UI strings go through `const { t } = useTranslation()`. When adding UI text, add keys to all three languages.

### Seed data and identity
`store/data.js` is the only seed source. `SEED_ACCOUNTS[].balance` is used by `accounts.jsx` to emit opening movements — do not read it directly at runtime. `BALANCES_BY_OFFICE` in the same file is deprecated (still exported for safety) and must not be used; balances come from movements.

Current user is hardcoded to `u_adm` (E. Kara, admin) via `useState("u_adm")` in `AuthProvider`; `switchUser(id)` changes it for demo purposes.

## Conventions

- Provider files use `.jsx` when they render JSX (most do); pure hooks/utils use `.js`.
- New store mutations should be wrapped in `useCallback` and exposed through the `useMemo`-ed context value (existing pattern across all providers).
- When adding a money-moving operation, write movements rather than mutating an account total.
- Keep comments in the existing mixed English/Russian style when editing a file — don't translate en-masse.
