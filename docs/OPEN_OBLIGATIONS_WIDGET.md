# OpenObligationsWidget

Widget «Открытые обязательства» для кассы — список deferred сделок где
менеджер должен закончить выдачу или принять платёж.

## Architecture

```
CashierPage
└─ OpenObligationsWidget (рядом с Balances)
   ├─ useOpenObligations() — fetch v_open_deals + Realtime subscribe
   ├─ ObligationRow × N — collapsible rows
   │  ├─ status chip (4 colors)
   │  ├─ counterparty + age
   │  ├─ open_count + pending_out_total
   │  └─ Actions (expanded):
   │     • Mark paid (awaiting_payment) → rpcUpdateWorkflowStatusV2('awaiting_release')
   │     • Complete release (awaiting_release/partial) → ledger.complete_deal_leg
   │       (cascade trigger → workflow auto-update)
   │     • Cancel (any) → window.prompt(reason) → rpcCancelWorkflowV2
   └─ Empty state с emerald check icon
```

## Data flow

1. Mount → `useOpenObligations` хук вызывает `supabase.from('v_open_deals').select('*')`
2. Subscribe на `operations.deal_workflow` через `supabase.channel`:
   ```js
   .on('postgres_changes', { event: '*', schema: 'operations', table: 'deal_workflow' },
       () => refetch())
   ```
3. Любой INSERT/UPDATE/DELETE в `deal_workflow` → refetch view
4. Unmount → `removeChannel` (cleanup в useEffect return)

## Action flow

### Mark paid
- Доступно только для `status='awaiting_payment'`
- Вызов `rpcUpdateWorkflowStatusV2(workflow_id, 'awaiting_release')`
- Backend RPC валидирует transition через state machine
- Realtime UPDATE → виджет обновляется автоматически

### Complete release
- Доступно для `status='awaiting_release'` или `'partial'`
- Берёт `open_legs[0]` (next leg к закрытию)
- Прямой вызов `supabase.rpc('complete_deal_leg', {...})` — Direction 2 RPC,
  не через dealOperations switcher (т.к. switcher не имеет completeDealLeg)
- БД trigger `cascade_ledger_settle_trg` ловит settle → удаляет leg из
  `open_legs` → если empty: `status='done'` + `closed_at`; иначе: `status='partial'`
- Realtime UPDATE → виджет обновляется

### Cancel
- Доступно для любого active status
- `window.prompt('Причина отмены')` — required reason
- `rpcCancelWorkflowV2({workflow_id, reason})`
- Backend `cancel_workflow` валидирует reason non-empty → 22000 если пусто
- Internal call → `update_workflow_status('cancelled', reason)`

## Status chip colors

| status | bg | text |
|---|---|---|
| draft | slate-100 | slate-600 |
| awaiting_payment | amber-50 | amber-700 |
| awaiting_release | indigo-50 | indigo-700 |
| partial | violet-50 | violet-700 |

(`done` и `cancelled` не показываются — view фильтрует их.)

## Realtime subscription pattern

```js
useEffect(() => {
  if (!isSupabaseConfigured) return;
  fetchAll();

  const channel = supabase
    .channel("open-obligations")
    .on("postgres_changes",
        { event: "*", schema: "operations", table: "deal_workflow" },
        () => fetchAll())
    .subscribe();
  channelRef.current = channel;

  return () => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
  };
}, [fetchAll]);
```

## Office filter

Передаётся `officeId` prop из CashierPage. Client-side filter:
`items.filter(it => !it.office_id || it.office_id === officeId)`.

Если у workflow нет `office_id` (старые записи) — показываем всем.

## Files

- `src/components/cashier/widgets/OpenObligationsWidget.jsx` — main component
- `src/store/openObligations.js` — useOpenObligations hook + formatAge helper
- `src/store/openObligations.test.js` — formatAge tests
- `src/components/cashier/widgets/OpenObligationsWidget.test.jsx` — render + actions tests
- i18n keys в `src/i18n/translations.jsx` (en/ru/tr × 14 keys)

## Integration points

- `src/pages/CashierPage.jsx` — widget рендерится в `lg:[grid-area:bal]`
  под `Balances`
- `src/lib/dealOperations.js` `createDeal` под `USE_NEW_LEDGER=true` —
  auto-creates workflow для deferred OUT legs (chain закрывается через
  виджет)

## Out of scope (W4 follow-up)

Spec предлагал filters panel (office/status/owner/stale) с localStorage
persist. Отложено до follow-up — current MVP использует только officeId
prop. Status и owner filters добавятся при необходимости.
