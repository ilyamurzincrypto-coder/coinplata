# cashier/ — новая форма создания сделки (DealForm v2)

Параллельная переработка формы «Создать сделку».
**Legacy `src/components/ExchangeForm.jsx` остаётся за feature-flag'ом**
как safety net до 2 недель после cutover. Не удаляется в этапе 5.

## Feature-flags

`.env.local` (НЕ коммитить):

```bash
VITE_USE_NEW_DEAL_FORM=true   # → DealForm v2 (новая форма)
VITE_USE_NEW_LEDGER=true      # → ledger.create_deal_v2 RPC через camelCase
```

После изменения `.env.local` перезапустите `npm run dev`.

| `USE_NEW_DEAL_FORM` | `USE_NEW_LEDGER` | Behavior |
|:---:|:---:|---|
| `false` | `false` | **Production legacy** (default) — ExchangeForm + rpcCreateDeal |
| `true`  | `false` | New form ↔ legacy ledger (UI verify) |
| `false` | `true`  | Legacy form ↔ new ledger (integration test) |
| `true`  | `true`  | **Production-ready** после cutover |

## Этапы

- **Этап 1** ✓ tokens + StickyTitle + CounterpartyBar + feature-flag
- **Этап 2** ✓ DealLegsTable + унифицированный `legs[]` state + buildTx
- **Этап 2.5** ✓ rate↔amount sync + balance display + cross-leg validation
  + spread indicator + undo/redo + auto-save draft
- **Этап 3** ✓ ConditionsBar (3 группы chips) + OnDemandPanel
- **Этап 4** ✓ FooterBar + LivePreview + SubmitCTA + RatesPanel + handleSubmit
- **Этап 5** ✓ docs consolidation + i18n cleanup (legacy ExchangeForm
  retained как safety net до 2 weeks после cutover)
- Этап 5+ — OpenObligationsWidget (после operations layer от ledger track)

## Архитектура (final, после этапа 5)

```
DealForm.jsx                    — root + useDealForm hook + handleSubmit
│
├─ StickyTitle.jsx              — sticky title 56px (этап 1)
├─ CounterpartyBar.jsx          — client/partner input (этап 1)
│
├─ <onFocusCapture wrapper>     — tracks last focused OUT leg → activeOutLegId
│  └─ DealLegsTable.jsx         — table + Tab-flow + + Add IN/OUT (этап 2)
│     └─ LegRow.jsx             — 52px row, data-leg-id/data-leg-side (этап 2/2.5)
│        ├─ LegSidePill         — IN/OUT toggle pill
│        ├─ CurrencyPicker      — currency dropdown
│        ├─ CurrencyTextInput   — amount с decimals masking
│        ├─ RateCell + SpreadIndicator (этап 2.5) — для OUT
│        ├─ AccountInlineSelect — accounts с legacy_only/no-mapping disable
│        ├─ AddressInline       — crypto wallet expand
│        └─ BalanceBadge        — client/account balance под cell (этап 2.5)
│
├─ ConditionsBar.jsx            — 3 chip groups + OnDemandPanel (этап 3)
│  ├─ ChipPill                  — reusable {default/active/disabled}
│  └─ OnDemandPanel             — backdate/scheduled/comment/tx_hash
│
├─ FooterBar.jsx                — sticky bottom 64px (этап 4)
│  ├─ Undo/Redo buttons
│  ├─ LivePreview               — direction + margin USD/% + warnings
│  └─ SubmitCTA                 — split-button с loading + dropdown
│
└─ RatesPanel.jsx               — right sidebar, hidden xl: (этап 4)
   └─ click cell → handlePickRate → fills active OUT leg

State: src/store/dealForm.js
  • useReducer dealFormReducer wrapped historyReducer (undo/redo)
  • Selectors: legs, inLegs, outLegs, totalIn, totalOut, conditions
  • Persistence: localStorage drafts с TTL 24h

Helpers:
  • src/lib/dealForm/buildTx.js     — pure mapping legs[] → v2 payload
  • src/lib/dealForm/submitFlow.js  — runSubmitFlow pure helper
  • src/lib/dealForm/errorMapper.js — PG codes → i18n toast keys
  • src/lib/dealOperations.js       — switcher createDeal etc. (STUB)
  • src/store/clientBalances.js     — useClientBalances hook
```

## State (этап 2)

`src/store/dealForm.js` — `useReducer` + `useDealForm()` hook.

```js
// Unified leg shape (side discriminator)
{
  id, side: 'in'|'out',
  currency, amount,                       // string (raw input)
  accountId,                              // public.accounts.id или null
  rate, rateManual,                       // OUT only
  deferred,                               // OUT: ours_later/partner_later
  source: 'fresh'|'from_balance',         // IN
  destination: 'physical'|'to_balance',   // OUT
  address, network,                       // crypto OUT
  note,
}
```

**Actions:** `ADD_LEG`, `REMOVE_LEG`, `UPDATE_LEG`, `REORDER_LEGS`,
`SET_COMMISSION`, `RESET`, `HYDRATE`.

**Selectors (через `useDealForm()`):** `inLegs`, `outLegs`, `totalIn` (per cur),
`totalOut` (per cur), `commissionByCurrency`.

**Initial state:** один auto-IN row, пустой OUT collection.
**Invariant:** `REMOVE_LEG` гарантирует ≥1 IN leg всегда.

## Этап 2.5 фичи

### Bidirectional rate↔amount sync (`applyAutoCalc` в reducer)
- OUT.rate edited → OUT.amount = first_IN.amount × rate
- OUT.amount edited (rate not in same patch) → OUT.rate = amount / IN
- IN.amount edited → all OUT legs с rate>0: amount = IN × rate
- Bypass: `dispatch({ ..., _skipAutoCalc: true })`

### Balance display + cross-leg validation
- `BalanceBadge` под Amount cell для IN.from_balance: client balance per cur
- `BalanceBadge` под Account cell для OUT.physical: account balance
- Red border + warning при overdraft (clientBalance < amount) или нехватке кассы (accountBalance < amount)
- `useClientBalances(clientId)` — sum we_owe minus they_owe per currency

### Spread indicator (`SpreadIndicator`)
- Сравнивает `leg.rate` с market rate (`getRate`)
- 🟢 above mid (profitable), 🟡 below mid, 🔴 |spread| > 5%
- Tooltip: "current X, market Y, spread +Z%"

### Undo/Redo
- `historyReducer` wraps `dealFormReducer` с {past, present, future} stacks
- HISTORY_MAX = 20 entries
- UPDATE_LEG throttle: continuous edits в same leg+keys = single undo step
- Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z (или Ctrl+Y) = redo
- Footer buttons + keyboard shortcuts глобально

## Этап 3 фичи

### ConditionsBar (3 группы chips)

```
┌─────────────────────────────────────────────────────┐
│ Расчёт:   [Pro-rata ✓] [На одну ногу] [Вручную]    │ ← single-select
│ Тип:      [Реферал] [VIP ✓] [Партнёр] [OTC]         │ ← multi-select
│ Комиссии: [Network fee ✓] [Network fee клиент]      │ ← multi (mutex pair)
│           [Bank fee] [Без комиссии]                  │
│ + Backdate · + Запланир · + Коммент · + TX hash    │ ← OnDemand
└─────────────────────────────────────────────────────┘
```

`state.conditions` shape:
```js
{
  margin_strategy: 'pro_rata' | 'single_leg' | 'manual',
  flags: ['referral','vip','partner','otc'],
  fees:  ['network_fee_exchange','network_fee_client','bank_fee','no_commission'],
  on_demand: { backdate, scheduled_at, comment, tx_hash }
}
```

**Behaviour rules:**
- `manual` margin disabled (Q3 2026 placeholder)
- `bank_fee` disabled (Q3 placeholder)
- `network_fee_exchange` ↔ `network_fee_client` — mutex pair
- `no_commission` toggle → confirm modal "Сделка без маржи?"
- TX hash auto-expand если IN-leg has currency ∈ {USDT, USDC, BTC, ETH} + source='fresh'
- All chip clicks → `setCondition(field, value)` через reducer (UNDOABLE)

### buildTx → metadata mapping (этап 3)

| Conditions | → Payload |
|---|---|
| `margin_strategy='single_leg'` | commission объединена в `outLegs[0].currency` |
| `flags.includes('referral')` | `metadata.referral=true` |
| `flags.includes('vip')` | `metadata.vip=true` |
| `flags.includes('otc')` | `metadata.is_otc=true` |
| `flags.includes('partner')` | `metadata.is_partner=true` |
| `fees.includes('network_fee_client')` | `metadata.fee_paid_by='client'` |
| `fees.includes('no_commission')` | `metadata.no_commission=true` + sentinel commission |
| `on_demand.backdate` | top-level `effective_date` (RPC parameter) |
| `on_demand.scheduled_at` | `metadata.scheduled_at` |
| `on_demand.comment` | `metadata.comment` |
| `on_demand.tx_hash` | `metadata.tx_hash` |

`commission[]` логика:
- `pro_rata` (default) — массив entries по currency
- `single_leg` — все суммы объединяются в одну entry в `outLegs[0].currency`
- `no_commission` — sentinel `[{currency: outLegs[0].currency, amount: 0.01}]` + flag в metadata

### Auto-save draft
- `useDealForm` пишет в `localStorage[dealForm.draft.v1]` на каждое изменение
- TTL 24h
- При mount (create mode только) — prompt "Восстановить черновик?"
- `clearDraft()` после Submit или dismiss

## Tab-flow (этап 2)

Cell-based refs[][] в `DealLegsTable.jsx`:

```
[Side]  [Currency]  [Amount]  [Rate]   [Source/Dest]  [Account]  [⌫]
  0        1          2         3            4            5        —
```

- **Tab** → следующая колонка в той же строке. Если 5 — переходим на col 1
  следующей строки.
- **Shift+Tab** → предыдущая колонка / предыдущая строка с col 5.
- **Enter** → next row col 1. Если строки нет — добавляется новая OUT row,
  фокус через 50ms setTimeout (после mount).
- Side cell (col 0) и Trash (col 6) пропускаются — toggle/delete по клику.

## buildTx mapping (этап 2)

`src/lib/dealForm/buildTx.js` — pure-функция, конвертирует unified
`legs[]` → v2 RPC payload (`rpcCreateDealV2` shape):

```js
buildTx({
  state: dealFormState,
  clientId, officeId,
  accountCodeByLegacyId,  // { 'acc-uuid': '1110', ... }
  description, metadata,
})
→ {
  client_id, office_id,
  in_legs:  [{currency, amount, source, account_code?, rate?, rate_source?}],
  out_legs: [{currency, amount, destination, account_code?, rate?, rate_source?, deferred}],
  commission: [{currency, amount, kind}],  // subset of OUT cur, dedup
  description, metadata: { ui_form: 'deal_v2', ... },
}
```

`accountCodeByLegacyId` map собирается на UI стороне через `useAccounts()`
+ `account.ledger_account_code` (резолвится в Direction 2 backend).

**Snapshot tests:** `buildTx.test.js` — 8 fixtures (5a-5b, 6a-6b, 7a-7b, 8a-8b)
покрывают все source/destination комбинации single/multi-leg + 5 edge cases.

## Feature-flag combos

| `VITE_USE_NEW_DEAL_FORM` | `VITE_USE_NEW_LEDGER` | Use case |
|:---:|:---:|---|
| `false` | `false` | **Production legacy** (default) |
| `true`  | `false` | Test new form через legacy ledger (UI verify) |
| `false` | `true`  | Legacy form через новый ledger (integration test) |
| `true`  | `true`  | **Production-ready** после cutover |

`.env.local`:
```
VITE_USE_NEW_DEAL_FORM=true
VITE_USE_NEW_LEDGER=false
```

## Дизайн-токены

`src/styles/tokens.css` импортирован в `src/index.css`
**ДО** `@tailwind`-директив (требуется для работы
`theme()` директивы в значениях CSS variables).

Семантические текстовые классы: `.text-heading`,
`.text-value`, `.text-number`, `.text-label`, `.text-hint`.
Tailwind utility-классы продолжают работать параллельно.

JS-mirror: `src/styles/tokens.js` (для inline styles).

## i18n

Все ключи в `src/i18n/translations.jsx` для en / ru / tr.

**Этап 1** — sticky title + close confirm:
- `cashier_title_new`, `cashier_title_edit`
- `cashier_counterparty_placeholder`
- `cashier_close_confirm`
- `close`, `loading`

**Этап 3** — ConditionsBar (26 keys):
- `conditions_label_calculation` / `_type` / `_fees`
- `conditions_chip_*` (pro_rata, single_leg, manual, manual_tooltip, referral,
  vip, partner, otc, network_fee_exchange, network_fee_client, bank_fee,
  no_commission)
- `conditions_no_commission_confirm_title` / `_body`
- `conditions_ondemand_*` (add, backdate, scheduled, comment, tx_hash)
- `conditions_confirm` / `_cancel`

**Этап 4** — Submit + errors + RatesPanel:
- `submit_create_deal` / `_save_draft` / `_create_and_notify` / `_disabled_tooltip`
- `error_*` (insufficient_balance, idempotency_conflict, not_found, validation,
  required_field, forbidden, forbidden_hint, unknown)
- `deal_created_success` / `deal_loading`
- `confirm_overdraft_title` / `_body`
- `rates_*` (title, filter_local, filter_global, refresh, updated_ago,
  click_to_fill, no_active_leg, empty)

## Этап 4 — Submit + Footer + Rates

### Architecture

```
DealForm.jsx  (root, useReducer state + accountsMap + handleSubmit)
├─ StickyTitle.jsx              — 56px sticky bar
├─ CounterpartyBar.jsx          — client/partner picker
├─ DealLegsTable.jsx            — таблица legs (с onFocusCapture
│                                  → activeOutLegId tracker)
│  └─ LegRow.jsx (data-leg-id, data-leg-side)
├─ ConditionsBar.jsx            — 3 группы chips + OnDemandPanel
├─ FooterBar.jsx                — sticky bottom 64px
│  ├─ Undo/Redo buttons
│  ├─ LivePreview.jsx           — direction summary + margin USD/%
│  └─ SubmitCTA.jsx             — split-button: Create / Draft / Notify
└─ RatesPanel.jsx               — right sidebar (hidden on <xl screens)
   └─ click cell → onPickRate(from, to, rate) → fills active OUT leg
```

### Click-to-fill mechanism

```
LegRow renders data-leg-id={leg.id} data-leg-side={leg.side}
  ↓
DealForm wraps DealLegsTable в onFocusCapture handler:
  e.target.closest("[data-leg-id]") → setActiveOutLegId(id)
  ↓
RatesPanel получает activeLegSummary + handlePickRate(from, to, rate)
  ↓
handlePickRate:
  • if leg.currency==to AND inLegs[0].currency==from → fill rate as-is
  • if inverse direction → fill 1/rate (auto-detect)
  • else → fill raw rate + mark rateManual=true
```

### handleSubmit flow

```
runSubmitFlow({buildPayload, createDeal, t, onSuccess, onError}):
  1. buildPayload() → throws на validation → mapErrorToToast(22000) → onError
  2. createDeal(payload):
     • USE_NEW_LEDGER=true → rpcCreateDealV2 (camelCase shape)
     • USE_NEW_LEDGER=false → rpcCreateDeal (legacy shape)
  3. throws → mapErrorToToast(error) → onError(toast):
     • P0001 → error_insufficient_balance
     • P0422 → error_idempotency_conflict + retry=true
     • 22000 → error_validation + field={side, legId}
     • P0002 / 23502 / 42501 / unknown → respective i18n keys
  4. success → onSuccess(result) → toast + clearDraft + reset()
```

Pure function `runSubmitFlow` extracted в `src/lib/dealForm/submitFlow.js`
для testability (без jsdom).

### Feature-flag matrix (4 combinations)

| `VITE_USE_NEW_DEAL_FORM` | `VITE_USE_NEW_LEDGER` | Behavior |
|:---:|:---:|---|
| `false` | `false` | **Production legacy** — ExchangeForm + rpcCreateDeal |
| `true`  | `false` | New form ↔ legacy ledger (UI verify, payload в legacy shape) |
| `false` | `true`  | Legacy form ↔ new ledger (integration test) |
| `true`  | `true`  | **Production-ready** после cutover (full v2 path) |

### Stub limitations

`src/lib/dealOperations.js` — **TEMPORARY STUB** до merge Direction 2 backend
(полный adapter живёт в `ledger/direction2-write-wrappers`).

При `VITE_USE_NEW_LEDGER=true`:
- ✅ `createDeal` / `createTopup` / `createTransfer` → V2 wrapper
- ⚠️ `createWithdrawal` → V2 (legacy fallback semantics-mismatch)
- ⚠️ `createReservation` / `releaseReservation` → V2 (throws на legacy)
- ⚠️ `createAdjustment` → legacy only (`rpcCreateAdjustmentV2` в Direction 2 ветке)

EDIT/DELETE — re-export legacy (Direction 3 mapping). Direction 2 merge
заменит этот stub полностью.
