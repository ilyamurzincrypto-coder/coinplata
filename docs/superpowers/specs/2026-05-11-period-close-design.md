# Закрытие периода (period close) — Spec

**Date:** 2026-05-11
**Status:** approved
**Depends on:** v2 ledger, `LedgerProvider` (app-wide), `ledger.create_adjustment` RPC (`kind='reconciliation'` → balancing account = per-currency Retained Earnings), `rpcCreateAdjustmentV2` wrapper. No new RPC, no migration.

## Problem
Revenue/expense account balances accumulate forever — there's no period-close step folding them into retained earnings. So the v2 P&L "since the beginning of time" keeps growing and never resets to a fresh period.

## Approach
Close = a series of `ledger.create_adjustment('reconciliation', …)` calls, one per non-zero revenue/expense account:
- revenue account (Cr-normal, balance B): `create_adjustment('reconciliation', code, +B, currency)` → `Dr <revenue> B / Cr Retained Earnings[currency] B` — zeroes the revenue account, RE up by B.
- expense account (Dr-normal, balance B): `create_adjustment('reconciliation', code, −B, currency)` → `Cr <expense> B / Dr Retained Earnings[currency] B` — zeroes the expense account, RE down by B.

Net effect: `Retained Earnings[currency] += Σ revenue[currency] − Σ expense[currency]` = period net profit, per currency.

Rejected: a dedicated atomic `ledger.close_period` RPC — cleaner journal (one tx) and atomic, but new PL/pgSQL handling financial logic = more risk. For a small exchange chart this loop is acceptable; if atomicity is needed later, add the RPC then.

Trade-offs accepted: the close produces N small "reconciliation" transactions (one per revenue/expense account) instead of one; not atomic (a mid-loop failure leaves some accounts closed) — the modal surfaces how many succeeded and the operator re-runs (already-zeroed accounts get skipped by `periodCloseLines` on the next computation, so a re-run is safe). Balances are "current" (`ledger.balances`), not historical — closing always uses the current snapshot ("close everything accumulated up to now"); the close transactions are dated `now()` (`create_adjustment` doesn't take an effective_date param).

## Components

### 1. `src/lib/treasury/periodClose.js` (new, pure)
`periodCloseLines(ctx) → { lines: Line[], netByCurrency: Record<cur, number> }`
- `Line = { accountCode, accountName, currency, kind: "revenue"|"expense", balance: number, amount: number }` where `amount = kind === "revenue" ? balance : -balance` (the delta to pass to `create_adjustment('reconciliation', …)`).
- For each `ctx.accounts` row with `type ∈ {revenue, expense}`: balance = Σ `ctx.balances` rows for that `account_id` (no dim). Skip if `|balance| < 1e-9`.
- `netByCurrency[cur] = Σ revenue.balance − Σ expense.balance` over lines of that currency.
- Returns empty `lines` (and `netByCurrency` `{}`) when there's nothing to close.

Tested: a ctx with a USD spread (rev, bal 50), a USD network_fee (exp, bal 4), a EUR commission (rev, bal 10) → `lines` = those 3 (amounts +50, −4, +10), `netByCurrency` = `{ USD: 46, EUR: 10 }`; a ctx with all-zero revenue/expense → `lines: []`.

### 2. `src/pages/treasury_v2/parts/PeriodCloseModal.jsx` (new)
- Props: `open`, `onClose`. Uses `useLedger()` (ctx), `useCan()`, `useTranslation()`.
- `const { lines, netByCurrency } = periodCloseLines(ctx)`.
- Renders: title "Закрыть период"; a date line (today, read-only — "транзакции будут датированы сегодня"); a table of `lines` (счёт · валюта · сальдо · → Retained Earnings); a "чистая прибыль за период" line per currency (`netByCurrency`); a confirm-step warning ("создаст N проводок 'reconciliation'; revenue/expense обнулятся, RE += прибыль; на даты обнуления назад не влияет"); buttons «Отмена» / «Закрыть период» (2-step confirm like BalanceAdjustmentModal).
- On confirm: loop `lines`, `await rpcCreateAdjustmentV2({ accountCode, amount, currencyCode: currency, reason: "Закрытие периода <date>", adjustmentKind: "reconciliation", metadata: { period_close: true, as_of: <iso date>, kind } })`. Count successes; on error, stop, toast the error, keep the modal open (the operator sees "закрыто X из N", fixes, re-runs). On full success → success toast «Период закрыт: N проводок» + `onClose()`.
- Empty state: `lines.length === 0` → message "Закрывать нечего — все доходы/расходы по нулям", confirm button disabled.

Tested: mock `useLedger`/`useCan`/`useTranslation` + `rpcCreateAdjustmentV2`; ctx with 3 lines → modal shows them + net; confirm twice → 3 RPC calls with the right `{accountCode, amount, currencyCode, adjustmentKind:"reconciliation"}`; empty ctx → disabled confirm + the "nothing to close" message; no `accounting:edit` → modal still renders but… actually the gate is on the button in PnLTab; the modal itself doesn't re-check (the RPC's `_require_role` also enforces).

### 3. `src/pages/treasury_v2/tabs/PnLTab.jsx` (modify)
- `useCan()`; if `can("accounting", "edit")`, render a «Закрыть период» button in the header (next to the existing «Экспорт CSV» / «Сравнить с прошлым» controls) that opens `<PeriodCloseModal>`. Wire `open`/`onClose` state.

### 4. i18n (en/ru/tr)
`trv2_pc_button` ("Close period" / "Закрыть период"), `trv2_pc_title`, `trv2_pc_date_note` ("Transactions dated today" / "Транзакции датируются сегодня"), `trv2_pc_col_account`/`trv2_pc_col_balance`/`trv2_pc_to_re` ("→ Retained Earnings" / "→ Нераспределённая прибыль"), `trv2_pc_net` ("Net profit for the period" / "Чистая прибыль за период"), `trv2_pc_nothing` ("Nothing to close — revenue/expense are all zero" / "Закрывать нечего — доходы/расходы по нулям"), `trv2_pc_confirm_warn`, `trv2_pc_confirm` ("Close period"), `trv2_pc_done` ("Period closed: {n} entries" — caller does the {n} replace), `trv2_pc_partial` ("Closed {n} of {m}; fix and re-run"). ~11 keys. Reuse `trv2_pm_reverse_cancel` for cancel / generic err keys where sensible.

### 5. Справка
`treasury` → `pnl` sub: add a `how` bullet about «Закрыть период» (что делает, кто видит) + a worked example (revenue spread $50 + expense network $4 → close → `Дт спред 50 / Кт RE 50`, `Кт сетевая 4 / Дт RE 4`, RE +$46).

## Testing
- `periodClose.test.js` — `periodCloseLines` on a mixed ctx; empty ctx; signs.
- `PeriodCloseModal.test.jsx` — renders lines + net; confirm → N RPC calls with right shape; empty → disabled + message.
- Full suite + `npm run build` green.

## Out of scope
- A dedicated atomic `ledger.close_period` RPC; back-dated close (historical balances); auto-scheduled close; "re-open period" (un-close).
