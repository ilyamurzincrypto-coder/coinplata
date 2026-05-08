# T4 — Concurrent update_tx_metadata manual test

`pg_background` extension недоступен в Supabase, `dblink_send_query` требует
credentials которых нет в MCP. T4 — manual test через 2 psql sessions.

## Architectural proof (автотест)

```sql
SELECT
  CASE WHEN pg_get_functiondef(oid) LIKE '%FROM ledger.transactions%FOR UPDATE%'
       THEN 'YES' ELSE 'NO' END AS for_update_on_target,
  CASE WHEN pg_get_functiondef(oid) LIKE '%FROM ledger.idempotency_keys%FOR UPDATE%'
       THEN 'YES' ELSE 'NO' END AS for_update_on_idem
FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='ledger')
  AND proname = 'update_tx_metadata';
```

**Result:** оба `YES`. PG-семантика гарантирует сериализацию.

## Manual reproducer (2 psql terminal)

### Setup (любая session)

```sql
INSERT INTO public.clients (id, nickname) VALUES
  ('cccc1111-1111-1111-1111-111111111111','TestClient');
SELECT ledger.create_opening_from_inventory(
  '[{"account_code":"1316","amount":500},{"account_code":"1112","amount":1500000}]'::jsonb,
  now(), 'T4 setup');

WITH d AS (SELECT id FROM public.offices WHERE name='Mark Antalya' LIMIT 1)
SELECT deal_tx_id FROM ledger.create_deal_v2(
  gen_random_uuid(), 't4-deal',
  'cccc1111-1111-1111-1111-111111111111', (SELECT id FROM d),
  '[{"currency":"USDT","amount":50,"source":"fresh","account_code":"1316"}]'::jsonb,
  '[{"currency":"TRY","amount":1500,"destination":"physical","account_code":"1112","rate":30,"rate_source":"market","deferred":false}]'::jsonb,
  '[{"currency":"TRY","amount":15,"kind":"commission"}]'::jsonb);
-- → запиши deal_tx_id, например :TX
```

### Session A (terminal 1)

```sql
BEGIN;
SELECT ledger.update_tx_metadata(
  gen_random_uuid(), 'A-hash', :'TX'::uuid, '{"tx_hash":"0xAAA"}'::jsonb);
-- НЕ COMMIT
```

### Session B (terminal 2) — параллельно

```sql
BEGIN;
SELECT ledger.update_tx_metadata(
  gen_random_uuid(), 'B-hash', :'TX'::uuid, '{"note":"from B"}'::jsonb);
-- ЭТО ВЕДЕТСЯ В WAIT — Session A держит FOR UPDATE на row.
```

### Session A (terminal 1)

```sql
COMMIT;
-- B unblocks → видит обновлённую metadata из A → читает через FOR UPDATE
-- → applies own patch на свежее значение → COMMIT.
```

### Verify

```sql
SELECT metadata FROM ledger.transactions WHERE id = :'TX'::uuid;
-- expected: { ..., "tx_hash": "0xAAA", "note": "from B" }
-- ОБА ключа присутствуют — никакого lost update.
```

### Без FOR UPDATE (counter-proof)

Если бы в коде не было `FOR UPDATE`, обе session читали бы старое значение,
делали бы merge независимо, последняя UPDATE затёрла бы первую — один
из ключей пропал бы. PG row-level lock гарантирует что этого не случится.
