# Operations Workflow Layer

## Назначение

Operational state для менеджеров поверх immutable financial ledger.

## Two-layer model

| Layer | Schema | Mutability | Purpose |
|---|---|---|---|
| 1 — Financial ledger | `ledger.*` | immutable (status `posted`/`reversed`) | бухгалтерские факты, double-entry |
| 2 — Operations workflow | `operations.*` | mutable | "что менеджеру нужно сделать": открытые ноги, owner, due date |

Связь: `operations.deal_workflow.ledger_tx_id` → `ledger.transactions.id` (FK).
Один `ledger.transactions` row может иметь до 1 workflow row.

## Schema

### `operations.deal_workflow`
```
id uuid PK
ledger_tx_id uuid → ledger.transactions(id)
status text CHECK ∈ {draft, awaiting_payment, awaiting_release, partial, done, cancelled}
open_legs jsonb [{leg_id, currency, amount, kind, account_code}]
notes, assigned_to, due_date, metadata
created_at, updated_at, closed_at
```

Indexes: `(status)`, `(assigned_to)`, `(due_date)`, `(ledger_tx_id)` —
все partial (excluding terminal статусы кроме ledger_tx_id idx).

RLS: `authenticated` SELECT все, `service_role` write.

### `operations.workflow_history`
Append-only audit. INSERT при каждом status change.

## State machine

```
draft → awaiting_payment | awaiting_release | cancelled
awaiting_payment → partial | done | cancelled
awaiting_release → partial | done | cancelled
partial → done | cancelled
done | cancelled → terminal (RAISE 22000 на любую попытку выйти)
```

## RPCs (SECURITY DEFINER, owner=postgres, GRANT to service_role only)

- `operations.create_workflow(ledger_tx_id, initial_status, open_legs, notes, assigned_to, due_date, metadata) → uuid`
- `operations.update_workflow_status(workflow_id, new_status, note, idempotency_key) → void`
- `operations.cancel_workflow(workflow_id, reason) → void` — reason обязателен

## Auto-cascade triggers

### A) `cascade_ledger_settle_trg` AFTER INSERT ON `ledger.journal_entries`
Закрывает open_leg при settle:
- Filter: `direction='cr'` + asset account + parent tx `source_kind='leg_settle'`
- Match leg: первый match по `(currency, amount, kind='out')` в `open_legs`
- Удаляем matched leg → если empty: `status='done'` + `closed_at=now()`; иначе: `status='partial'`
- Если match не найден — INFO audit_alert (нет crash)

### B) `cascade_ledger_reversal_trg` AFTER INSERT ON `ledger.transactions`
Cancel workflow при reverse:
- Filter: `reverses_transaction_id IS NOT NULL`
- Find workflow с `ledger_tx_id = reverses_transaction_id` и status NOT IN (done, cancelled)
- Set `status='cancelled'`, `closed_at=now()`, `metadata.cancelled_by_reversal_tx`

## View `operations.v_open_deals`

Aggregated UI-ready data для widget'a. Filter: `status IN ('awaiting_payment', 'awaiting_release', 'partial')`. Includes: counterparty name (JOIN clients), open_count, pending_out_total. Sorted by `due_date NULLS LAST, created_at`.

GRANT SELECT to authenticated.

## Cron `operations_flag_stale_workflows`

Schedule: `0 3 * * *` (daily 03:00 UTC).
Function: `operations.flag_stale_workflows()`.
Logic: workflow `updated_at < now() - 7 days` AND `status NOT IN (done, cancelled)` → `audit_alert WARN` с count + workflow_ids.

## Adapter integration (`src/lib/dealOperations.js`)

`createDeal(payload)` под `USE_NEW_LEDGER=true`:
1. `adaptLegacyDealPayload(payload)` → v2 payload
2. `rpcCreateDealV2(v2payload)` → `result.deal_tx_id`
3. **Auto-create workflow** для каждого `outLegs[i].deferred=true`:
   ```
   rpcCreateWorkflowV2({
     ledgerTxId: deal_tx_id,
     initialStatus: 'awaiting_release',
     openLegs: deferredLegs.map((l, i) => ({
       leg_id: `out_${i}`, currency, amount, kind: 'out', account_code
     })),
     metadata: { source: 'auto_from_deal_v2' }
   })
   ```
4. Workflow create errors не блокируют deal create (graceful degrade,
   workflow можно создать manually позже).

## Tests

T1-T9 passed (smoke-test через Supabase MCP):
- T1 ✓ `create_workflow` для deal с deferred OUT → status='awaiting_release', open_legs populated
- T2 ✓ `complete_deal_leg` единственной ноги → trigger → status='done', closed_at set
- T3 ✓ Multi-leg deferred: settle one → 'partial'; settle last → 'done'
- T4 ✓ Manual transitions draft→awaiting_release→partial с history
- T5 ✓ Invalid transition done→partial → 22000
- T6 ✓ `cancel_workflow` с reason → cancelled + history
- T6b ✓ `reverse_transaction` parent deal → workflow auto-cancelled
- T7 ✓ `cancel_workflow` без reason → 22000
- T8 ✓ `v_open_deals` view aggregated correctly (open_count, pending_out_total)
- T9 ✓ Cron stale check → audit_alert WARN с count

T10 (adapter integration) — verified в коде; runtime test потребует UI deploy.

## Files

```
supabase/migrations/
  operations_1_schema.sql
  operations_2_rpc_create_workflow.sql
  operations_3_rpc_update_status_and_cancel.sql
  operations_5_cascade_trigger.sql
  operations_6_view_open_deals_and_cron.sql

src/lib/
  newLedger.js — extended с rpcCreateWorkflowV2 / UpdateStatusV2 / CancelV2
  dealOperations.js — createDeal auto-creates workflow для deferred OUT
```

## Что NOT changed

- `ledger.transactions` schema — immutable
- `ledger.complete_deal_leg` — НЕ модифицирован (cascade trigger использует
  existing `source_ref_id=deal_id` для linking, journal_entries match
  для closed leg detection)
- Legacy `public.deals.status` — не trogged
