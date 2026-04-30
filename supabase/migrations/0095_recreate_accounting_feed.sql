-- ============================================================================
-- CoinPlata · 0095_recreate_accounting_feed.sql
--
-- Профилактический DROP+CREATE v_accounting_feed.
--
-- Проблема: пользователь сообщает что новые сделки/балансовые корректировки
-- не появляются в бухгалтерском репорте. Возможные причины:
--   - View после нескольких CREATE OR REPLACE имеет stale column types
--   - PostgreSQL не сделал invalidate query plan
--
-- Решение: чистый DROP + CREATE с verify-блоком в конце который покажет
-- сколько rows из каждого entity_type попадает в feed. Если есть
-- расхождение между underlying таблицей и view — будет видно сразу.
-- ============================================================================

drop view if exists public.v_accounting_feed cascade;

create view public.v_accounting_feed as

-- ─── 1. Deals (regular + OTC + broker) ───────────────────────────────
select
  'deal'::text as entity_type,
  d.id::text as entity_id,
  d.created_at as occurred_at,
  d.office_id,
  d.manager_id,
  d.client_id,
  d.client_nickname as counterparty_label,
  d.kind as deal_kind,
  d.in_kind as deal_in_kind,
  null::text as transfer_kind,
  null::text as expense_type,
  d.amount_in as primary_amount,
  d.currency_in as primary_currency,
  (select sum(l.amount) from public.deal_legs l where l.deal_id = d.id) as secondary_amount,
  (select string_agg(distinct l.currency, '/') from public.deal_legs l where l.deal_id = d.id) as secondary_currency,
  d.fee_usd, d.profit_usd, d.commission_usd,
  d.referral,
  d.status as op_status,
  d.comment,
  coalesce(a.status, 'pending_review') as accounting_status,
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at,
  d.created_by_user_id as created_by
from public.deals d
left join public.accounting_audits a
  on a.entity_type = 'deal' and a.entity_id = d.id::text
where d.status <> 'deleted'

union all

-- ─── 2. Transfers ────────────────────────────────────────────────────
select
  'transfer'::text, t.id::text, t.created_at,
  acc_from.office_id, null::uuid, null::uuid, null::text,
  null::text, null::text,
  case when acc_from.office_id <> acc_to.office_id then 'interoffice' else 'inter_account' end,
  null::text,
  t.from_amount, t.from_currency, t.to_amount, t.to_currency,
  null::numeric, null::numeric, null::numeric,
  null::boolean, null::text, t.note,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at, t.created_by
from public.transfers t
left join public.accounts acc_from on acc_from.id = t.from_account_id
left join public.accounts acc_to on acc_to.id = t.to_account_id
left join public.accounting_audits a
  on a.entity_type = 'transfer' and a.entity_id = t.id::text

union all

-- ─── 3. Expenses (income/expense entries) ────────────────────────────
select
  'expense'::text, e.id::text, e.created_at,
  e.office_id, null::uuid, null::uuid, null::text,
  null::text, null::text, null::text,
  e.type::text,
  e.amount, e.currency_code, null::numeric, null::text,
  null::numeric, null::numeric, null::numeric,
  null::boolean, null::text, e.note,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at, e.created_by
from public.expenses e
left join public.accounting_audits a
  on a.entity_type = 'expense' and a.entity_id = e.id::text

union all

-- ─── 4. Balance adjustments ──────────────────────────────────────────
select
  'balance_adjustment'::text, ba.id::text, ba.created_at,
  acc.office_id, ba.created_by, null::uuid, null::text,
  null::text, null::text, null::text, null::text,
  ba.difference, ba.currency_code, ba.new_balance, ba.currency_code,
  null::numeric, null::numeric, null::numeric,
  null::boolean, null::text, ba.note,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at, ba.created_by
from public.balance_adjustments ba
left join public.accounts acc on acc.id = ba.account_id
left join public.accounting_audits a
  on a.entity_type = 'balance_adjustment' and a.entity_id = ba.id::text

union all

-- ─── 5. Cash closures (active, non-cancelled) ────────────────────────
select
  'cash_closure'::text, cc.id::text, cc.created_at,
  cc.office_id, cc.manager_id, null::uuid, null::text,
  null::text, null::text, null::text, null::text,
  null::numeric, null::text, null::numeric, null::text,
  null::numeric, null::numeric, null::numeric,
  null::boolean, null::text, cc.manager_comment,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at, cc.manager_id
from public.cash_closures cc
left join public.accounting_audits a
  on a.entity_type = 'cash_closure' and a.entity_id = cc.id::text
where cc.cancelled_at is null;

-- ============================================================================
-- Verify — counts per entity_type. Должно совпадать с подсчётом по
-- underlying tables.
-- ============================================================================

-- Что в feed
select entity_type, accounting_status, count(*) as feed_count
from public.v_accounting_feed
group by entity_type, accounting_status
order by entity_type, accounting_status;

-- Что в underlying tables (для сравнения)
select 'deal_active' as t, count(*) from public.deals where status <> 'deleted'
union all
select 'transfer', count(*) from public.transfers
union all
select 'expense', count(*) from public.expenses
union all
select 'balance_adjustment', count(*) from public.balance_adjustments
union all
select 'cash_closure_active', count(*) from public.cash_closures where cancelled_at is null;
