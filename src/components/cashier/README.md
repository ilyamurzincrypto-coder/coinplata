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
- Этап 2 — DealLegsTable + унифицированный `legs[]` state
- Этап 2.5 — Tab-flow + cross-leg validation + RatesPanel sync
- Этап 3 — ConditionsBar (3 группы) + on-demand chips
- Этап 4 — FooterBar + LivePreview + RatesPanel переписан
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

## State (этап 2+)

`useReducer` с одним unified shape:

```ts
{
  legs: [{ id, side, currency, amount, accountId, rate, ... }],
  counterparty, counterpartyId, counterpartyTelegram,
  conditions: { timing, isReferral, isPartial, partialPayNow,
                applyMinFee, commissionUsd, customFeeUsd,
                backdateAt, plannedAt, comment, txHash },
  selectedManagerId, payeeUserId, payeeOfficeId,
  // undo/redo (этап 2.5)
  _undoStack, _redoStack,
}
```

## buildTx mapping (этап 2)

`src/lib/dealForm/buildTx.js` — чистая mapping-функция,
конвертирует unified `legs[]` в формат который ожидает
существующий `rpcCreateDeal/rpcUpdateDeal`. **Контракт RPC
не меняется** до cutover.

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
