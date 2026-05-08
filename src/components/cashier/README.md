# cashier/ — новая форма создания сделки (DealForm v2)

Параллельная переработка формы «Создать сделку». Старый
`src/components/ExchangeForm.jsx` остаётся нетронутым до этапа 5
(cleanup) — новая форма активируется feature-flag'ом.

## Включение

```bash
# .env.local (НЕ коммитить, только для разработчика)
VITE_USE_NEW_DEAL_FORM=true
```

После изменения `.env.local` перезапустите dev-сервер
(`npm run dev`). На этапе 1 новая форма показывает
только sticky title + counterparty bar + placeholder
«Секции формы появятся на следующих этапах».

`USE_NEW_DEAL_FORM=false` (default) — `CashierPage`
продолжает рендерить legacy `ExchangeForm`.

## Этапы

- **Этап 1** ✓ tokens + StickyTitle + CounterpartyBar + feature-flag
- **Этап 2** ✓ DealLegsTable + унифицированный `legs[]` state + buildTx
- Этап 2.5 — Tab-flow refinement + cross-leg validation + RatesPanel sync
- Этап 3 — ConditionsBar (3 группы) + on-demand chips
- Этап 4 — FooterBar + LivePreview + Submit CTA
- Этап 5 — cleanup старых компонентов

## Архитектура (целевая, после этапа 5)

```
DealForm.jsx                    — root, useReducer state
├─ StickyTitle.jsx              — 56px sticky bar (этап 1)
├─ CounterpartyBar.jsx          — client/partner picker (этап 1)
├─ DealLegsTable.jsx            — таблица ног (этап 2)
│  ├─ LegRow.jsx
│  ├─ LegSidePill.jsx
│  ├─ CurrencyTextInput.jsx
│  ├─ AccountInlineSelect.jsx
│  └─ RateCell.jsx
├─ ConditionsBar.jsx            — 3 группы dropdown (этап 3)
│  ├─ TimingGroup.jsx           — single-select Расчёт
│  ├─ DealTypeGroup.jsx         — multi-select Тип
│  └─ FeeCalcGroup.jsx          — multi-select Комиссии
├─ FooterBar.jsx                — sticky bottom, 64px (этап 4)
│  ├─ LivePreview.jsx
│  └─ SubmitCTA.jsx
└─ ui/
   ├─ Avatar.jsx                — манагер аватар (этап 1)
   ├─ PillToggle.jsx
   └─ OnDemandChip.jsx
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

Ключи добавлены в `src/i18n/translations.jsx` для
en / ru / tr (см. PR этапа 1):

- `cashier_title_new`, `cashier_title_edit`
- `cashier_counterparty_placeholder`
- `cashier_close_confirm`
- `cashier_stage1_placeholder`
- `close`, `loading`
