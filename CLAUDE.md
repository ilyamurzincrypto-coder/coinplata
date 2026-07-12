# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager: **npm** (откатились с pnpm 2026-05-14: Vercel в CI-режиме pnpm 10+ падал на ERR_PNPM_IGNORED_BUILDS из-за esbuild build script).

```bash
npm install       # install deps
npm run dev       # Vite dev server on http://localhost:5173
npm run build     # produces dist/ (target ~100 KB gzip)
npm run preview   # serve dist/ locally
npm test          # vitest run
```

There is a `vitest` suite but no linter or type-checker. Verify changes with `npm run build` + manual exercise in the dev server.

## Deploy

`git push` to the main branch → **Vercel** builds automatically (config in `vercel.json`, SPA rewrite to `/index.html`). Netlify is no longer used.

## Feature flags

**Cutover complete 2026-05-10.** Both flags are now resolved in code with hard-coded defaults — they no longer *need* to be set in Vercel env. (The temporary `VITE_FORCE_V2` kill-switch was removed — it served its purpose during the gap between PR #18 and Phase 1 of v2 revival.)

| Flag | Resolved at | Default | What it does |
|---|---|---|---|
| `VITE_USE_NEW_DEAL_FORM` | `src/pages/CashierPage.jsx` — `const USE_NEW_DEAL_FORM = false;` (env ignored) | **false** | when true would render new `DealForm` (legs table + RatesPanel sidebar). Hard-coded `false` by user request — legacy `ExchangeForm` is the deal form. To re-enable v2 form, change to `import.meta.env.VITE_USE_NEW_DEAL_FORM === "true"`. |
| `VITE_USE_NEW_LEDGER` | `src/lib/newLedger.js` — `USE_NEW_LEDGER = _ENV?.VITE_USE_NEW_LEDGER !== "false"` | **true** | routes `createDeal/createTransfer/createTopup/createBalanceAdjustment` through `newLedgerAdapter` → `ledger.create_deal_v2 / create_transfer / create_adjustment` (Dr/Cr `journal_entries` pairs). On by default; the **only** way to disable is an explicit `VITE_USE_NEW_LEDGER=false` in env. |

**Rollback path** if a production incident appears: set `VITE_USE_NEW_LEDGER=false` in Vercel + redeploy (legacy `rpcCreateDeal` etc. come back online) — but the legacy tables remain frozen, so a real rollback also needs the un-freeze/grants step from `docs/CUTOVER_RUNBOOK.md`. (Note: Vite inlines `import.meta.env.VITE_*` at build time — changing it in Vercel only takes effect after a redeploy.)

History: `docs/superpowers/specs/2026-05-10-v2-ledger-revival-design.md` + `docs/superpowers/plans/2026-05-10-v2-ledger-revival.md`. Phase 1 added adapter coverage, validateTx, and 10 v2 wrappers. Phase 2 backfilled 13 opening journal entries. Phase 3 (this) flipped the kill-switch and froze legacy.

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

---

## ⛔ ИНВАРИАНТЫ — нарушение = баг, а не «стиль»

### Деньги
1. **Сделки и движения — только через RPC `create_deal_v2`** (v2-леджер). В проде движения в память не пишутся.
2. **Проводки только парами и атомарно: IN и OUT.** Если IN-нога не может быть записана (счёт не выбран / неактивен) — **вся операция падает**, OUT НЕ пишется. Варнинг не является разрешением продолжать. *(B5)*
3. **Суммы — только через `money.js` (минорные единицы).** Сырая float-арифметика на деньгах запрещена: `inAmt * rate` и подобное — нельзя, только `multiplyAmount`. *(B7)*
4. **Создание сделки идемпотентно.** `idempotencyKey` генерируется **один раз на попытку** на клиенте и передаётся в RPC; **повтор/ретрай использует ТОТ ЖЕ ключ**. Генерация нового ключа на каждый вызов = дубль сделки. `if(submitting) return` — это защита от даблклика, а не от ретрая. *(B1)*

### Курсы
5. **`getRate` возвращает ЧИТАЕМОЕ значение > 1** (напр. TRY→USDT хранится как 46.8, а не 0.021).
6. **Ориентация курса — ТОЛЬКО через общий хелпер `usdtPer` из `src/lib/rates`.** Никаких локальных копий, никаких «STRONG = [USD, EUR]» вайтлистов в компонентах. **Копировать хелпер запрещено — импортировать.** *(B2, B3, D5, D6)*
7. **Один форматтер курса на всё приложение** (один порог точности). *(B6)*
8. **Курс сделки = серверный `effective_rate`.** Фронтовый `getRate` — **только для превью**. Любое место, где фронт отправляет собственный `rate` в RPC, считается расхождением и требует сверки с DDL сервера. *(S1)*

## 🚫 НЕ ТРОГАТЬ (без явной просьбы)

- **Левая колонка редактора курсов** (Нал/Tolunay, USDT·Турция, USDT·Россия) и блок **СПЕЦ-КУРСЫ (СБП/НЕРЕЗ)** — размеры, расположение, стили, логика: **байт в байт**.
- **Не добавлять фильтры и дефолты, о которых не просили** (напр. `active !== false` в редакторе курсов: редактор показывает **ВСЕ** офисы, включая закрытые — это настройки, а не витрина).
- **Не хардкодить** страны/города/валюты/наборы пар — брать из справочников.
- Не «улучшать попутно» файлы вне скоупа задачи.

## ✅ ВОРОТА — без них «готово» не существует

1. `npm test` — **зелёный** (596 тестов; если тест не покрывает изменение — дописать тест).
2. `npm run build` — проходит.
3. **Визуальные изменения: не «готово» без скриншота отрендеренного результата.** «Собралось» ≠ «выглядит правильно».
4. **Перед любой новой математикой/маппингом:** сначала `grep` существующих хелперов (`usdtPer`, `multiplyAmount`, `getRate`) и **открыть источник истины** (страница Tolunay/Rapira, DDL функции), а не додумывать.
5. **Сравнивать можно только однородное:** «текущая цена» и «было» — из одного источника. Смешивать фолбэк-курс с историей другого фида запрещено.
6. **Перед коммитом — проверить ветку** (`git branch`, `git log -1`): не черри-пикать на устаревшую.

## 📋 ШАБЛОН ЗАДАЧИ

```
ЦЕЛЬ:            что должно работать после (в одном предложении)
ФАЙЛЫ В СКОУПЕ:  список; всё остальное — не трогать
НЕ ТРОГАТЬ:      явный список (лейаут/логика/флаги)
ИСТОЧНИК ИСТИНЫ: ссылка/DDL/страница фида — откуда брать правду
КРИТЕРИЙ ГОТОВО: конкретно + команда проверки (npm test / скрин)
```
Если не хватает **источника истины** или **критерия готовности** — **спрашивать, а не догадываться**.

## ⚠️ Известные ловушки этого репозитория

- **Два пути создания сделки:** legacy `create_deal` и v2 `create_deal_v2` (флаг `VITE_USE_NEW_LEDGER`); две формы: legacy `ExchangeForm` и v2 `DealForm` (`USE_NEW_DEAL_FORM` = false). **Уточняй, какая реализация «настоящая», прежде чем править.**
- **Дрейф схемы:** 8 боевых объектов без DDL в репо (`external_rates`, `special_rates`, `rapira_alert_state`, `v_external_rates_latest`, `set_pair_margins`, `replace_special_rates`, `buy_margin`, `coinpoint_office_code`). Схему из репо развернуть нельзя — **сверяйся с живой БД, не с миграциями**.
- **Файлы-монстры** (`ExchangeForm` 3879, `supabaseWrite` 2126, `translations` 4589): правки вслепую по фрагменту = источник половины чинящих коммитов. Читай функцию целиком перед правкой.
