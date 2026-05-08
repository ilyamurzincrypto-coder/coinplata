# Cutover runbook — переход на новый ledger

**Дата cutover:** 2026-06-01 00:00 UTC (или сдвинутая по решению owner).

## Стратегия

**Опция C — physical inventory cutover.** Текущие legacy данные обнуляются.
Менеджеры на cutover-day делают физическую инвентаризацию по каждому
офису/банку/кошельку. Эти числа = единственный источник для opening
transaction.

С момента cutover:
- Все новые операции идут через `ledger.*` RPC (новый ledger)
- Legacy таблицы `public.account_movements`, `public.deals` и др. становятся
  read-only архивом

## Pre-cutover validations (T-24 hours)

**Before initiating cutover, run these queries и verify ALL return 0.**
Если ANY query > 0 → resolve в legacy ДО cutover. Cutover BLOCKED иначе.

```sql
-- C1. Pending deals — must be settled or cancelled
SELECT count(*) AS pending_deals
  FROM public.deals
 WHERE status IN ('pending','checking');

-- C2. Open obligations — must be settled or cancelled
SELECT count(*) AS open_obligations
  FROM public.obligations
 WHERE settled_at IS NULL AND COALESCE(canceled_at, NULL) IS NULL;

-- C3. Active reservations — must be released or completed
SELECT count(*) AS reserved_movements
  FROM public.account_movements
 WHERE reserved = true;

-- C4. Pending interoffice transfers — must be confirmed/rejected
SELECT count(*) AS pending_transfers
  FROM public.transfers
 WHERE status = 'pending';

-- C5. Unmatched accounts (no ledger mapping AND not legacy_only)
SELECT count(*) AS unmapped_accounts
  FROM public.accounts
 WHERE active
   AND ledger_account_code IS NULL
   AND legacy_only = false;
```

Resolve options для каждого:
- **C1** pending deals → `rpcCompleteDeal` или `rpcDeleteDeal('cutover-cancel')`
- **C2** open obligations → `rpcSettleObligation` / `rpcCancelObligation`
- **C3** active reservations — связаны с pending deals — после resolve C1
  должны очиститься. Orphaned → `rpcDeleteDeal` parent.
- **C4** pending transfers → `rpcConfirmTransfer` / `rpcRejectTransfer`
- **C5** unmapped accounts — либо seed missing ledger account (миграция),
  либо `legacy_only=true` если account реально не нужен в новом ledger.

После прогона ВСЕХ queries → 0 → переходим к Шаг 0.

---

## Шаг 0 — pre-flight (за неделю до)

```bash
# 1. Проверить что новый ledger в продакшене (PR #4 merged)
git log --oneline | head
# должен быть commit "feat(ledger-stage3): RPC integration wrappers"

# 2. Проверить что 134 accounts засеяны
psql ... -c "SELECT count(*) FROM ledger.accounts;"
# Expected: 134
```

**Прогон verification SQL на staging-копии prod-data:**

```sql
-- На staging: применить test inventory, прогнать verify_opening, удалить.
SELECT ledger.create_opening_from_inventory(
  '[{"account_code": "1110", "amount": 1000}]'::jsonb
);
SELECT * FROM ledger.verify_opening('<returned-uuid>');
-- Обе строки passed=true → готовы.
```

## Шаг 1 — physical inventory (cutover day, 9:00–11:00 UTC)

Каждый офис заполняет CSV/таблицу:

| account_code | amount | client_id (optional) | partner_id (optional) | comment |
|---|---|---|---|---|
| 1110 | 50000 |  |  | Cash · Mark Antalya · USD |
| 1112 | 1500000 |  |  | Cash · Mark · TRY |
| 1316 | 250000 |  |  | Hot · USDT TRC20 · Mark |
| 1340 | 1500000 |  |  | Treasury · USDT TRC20 |
| 1210 | 25000 |  |  | Bank · TBD · USD (по выписке) |
| 2110 | 1500 | uuid-of-client-X |  | Customer Liab · USD client X |
| 2112 | 30000 | uuid-of-client-Y |  | Customer Liab · TRY client Y |

Правила:
- **assets** (1xxx): `amount > 0` = у нас на счёте лежит. `amount = 0` → **не включать строку**.
- **liabilities** (2xxx): `amount > 0` = мы должны клиенту/партнёру. **client_id обязателен** для 21xx.
- Валюты в которых ничего нет на cutover-day — пропускаем (не sеем zero entries).

Финальный CSV в JSONB-array → передаём в `ledger.create_opening_from_inventory`.

## Шаг 2 — генерация opening transaction (cutover day, 11:00 UTC)

Через Supabase SQL editor (требуется postgres role):

```sql
SELECT ledger.create_opening_from_inventory(
  '[
    {"account_code": "1110", "amount": 50000},
    {"account_code": "1112", "amount": 1500000},
    ... -- ваш inventory
  ]'::jsonb,
  '2026-06-01 00:00:00+00'::timestamptz,
  'Cutover opening 2026-06-01',
  '{}'::jsonb
);
-- Возвращает opening_tx_id
```

Балансировка через `Opening Balance Equity · X` per currency происходит автоматически.

## Шаг 3 — verification (cutover day, 11:30 UTC)

```sql
SELECT * FROM ledger.verify_opening('<opening_tx_id>'::uuid);
```

Ожидаем:

| check_name | passed |
|---|:---:|
| `per_currency_balance` | true |
| `balances_consistency` | true |

**Если хотя бы одна `passed=false`** — opening transaction **не валиден**.
Действие: рассчитать diff, найти ошибку в inventory, **rollback** через
`ledger.reverse_transaction(p_target_tx_id => opening_tx_id, p_reason => 'Verification failed', p_cascade => true)`.
Затем повторить с исправленным inventory.

## Шаг 4 — заморозка legacy (cutover day, 12:00 UTC)

После успешной верификации:

```sql
SELECT ledger.freeze_legacy_tables();
-- Возвращает JSONB array со статусом каждой таблицы.
```

Это REVOKE INSERT/UPDATE/DELETE на 7 legacy таблицах. SELECT остаётся.

⚠️ **После этого шага legacy `rpcCreateDeal` перестанет работать.**
Перед запуском убедитесь что **frontend уже переключён** на
`VITE_USE_NEW_LEDGER=true`:

```bash
# Vercel/.env.local
VITE_USE_NEW_LEDGER=true
```

И DealForm уже использует `rpcCreateDealV2` (UI этап 2-4 завершены).

## Шаг 5 — post-cutover monitoring (первые 7 дней)

Cron'ы автоматически работают:
- `ledger_reconcile_balances` (каждый час) — алертит при mismatches.
- `ledger_idempotency_cleanup` (03:00 UTC) — чистит expired ключи.
- `ledger_stale_unearned_check` (09:00 UTC) — Unearned > 7d.
- `ledger_active_reservations_audit` (10:00 UTC) — резервы > 24h.
- `ledger_fx_position_snapshot` (23:55 UTC) — daily snapshot позиций.
- `ledger_balance_anomaly_check` (каждые 15 мин) — резкие движения.
- `ledger_weekly_overdraft_summary` (понедельник 09:00 UTC) — overdraft клиентов.

Дополнительно — manual check ежедневно 09:00:

```sql
-- Текущий FX-баланс по валютам
SELECT * FROM ledger.v_open_position;

-- Overdraft clients
SELECT * FROM ledger.v_clients_overdraft LIMIT 50;

-- Recent audit_alerts
SELECT level, source, message, created_at
  FROM ledger.audit_alerts
 WHERE level IN ('warn','error','critical')
   AND resolved_at IS NULL
 ORDER BY created_at DESC LIMIT 50;
```

## Шаг 6 — финальная очистка (через 1-2 недели)

После 1-2 недель работы нового ledger в production без issues:

```sql
-- Опционально: переименовать legacy в schema legacy.* (явное отделение).
-- Не критично — таблицы уже frozen.
CREATE SCHEMA IF NOT EXISTS legacy;
ALTER TABLE public.account_movements         SET SCHEMA legacy;
ALTER TABLE public.partner_account_movements SET SCHEMA legacy;
ALTER TABLE public.obligations               SET SCHEMA legacy;
ALTER TABLE public.deals                     SET SCHEMA legacy;
ALTER TABLE public.deal_legs                 SET SCHEMA legacy;
ALTER TABLE public.deal_in_payments          SET SCHEMA legacy;
ALTER TABLE public.deal_leg_payments         SET SCHEMA legacy;
```

Frontend readers (`supabaseReaders.js`) обновить на `legacy.*`.

После — удалить legacy `rpcCreateDeal`/`rpcUpdateDeal` из `supabaseWrite.js`.

## Шаг 7 — TODO list для cutover prep (sign off)

- [ ] **Banks**: овнер сообщил реальные банки → `UPDATE ledger.accounts SET name, provider WHERE code IN ('1210','1211','1212','1213')`
- [ ] **W-92 GasFree**: реальный TRC20 адрес → `UPDATE ledger.wallet_addresses SET address WHERE label='w-92 Cash-out (GasFree)'`
- [ ] **Frontend feature-flag**: `VITE_USE_NEW_LEDGER=true` в Vercel production env
- [ ] **DealForm UI**: этап 2-4 завершены, форма использует `rpcCreateDealV2`
- [ ] **Inventory CSV**: все 4 офиса (Mark Antalya, Terra City, Istanbul, Москва Вася) сданы в собранный JSONB
- [ ] **Customer Liab**: список клиентов с открытыми обязательствами (с client_id) собран
- [ ] **Verification**: `SELECT * FROM ledger.verify_opening` → обе passed
- [ ] **Freeze**: `SELECT ledger.freeze_legacy_tables()`
- [ ] **Cron monitoring**: первые 24h сверка ежечасная.

## Аварийный rollback

Если на шагах 3-4 что-то пошло не так и обнаружено уже после freeze:

```sql
-- 1. Unfreeze legacy
GRANT INSERT, UPDATE, DELETE ON public.account_movements,
                                public.partner_account_movements,
                                public.obligations,
                                public.deals,
                                public.deal_legs,
                                public.deal_in_payments,
                                public.deal_leg_payments
  TO authenticated, anon, service_role;

-- 2. Reverse opening
SELECT ledger.reverse_transaction(
  p_idempotency_key => gen_random_uuid(),
  p_request_hash => 'rollback-' || now()::text,
  p_target_tx_id => '<opening_tx_id>',
  p_reason => 'Cutover rollback: <причина>',
  p_cascade => true
);

-- 3. Очистить опрос новые данные если успели появиться
DELETE FROM ledger.balances;
DELETE FROM ledger.journal_entries;
DELETE FROM ledger.transactions;

-- 4. VITE_USE_NEW_LEDGER=false → редеплой frontend → legacy back online.
```

Done.
