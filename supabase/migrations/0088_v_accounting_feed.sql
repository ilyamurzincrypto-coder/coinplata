-- ============================================================================
-- CoinPlata · 0088_v_accounting_feed.sql
--
-- Единый view с лентой операций для бухгалтерского репорта.
-- UNION ALL по 5 типам сущностей с нормализованной схемой:
--   entity_type, entity_id, occurred_at, office_id, manager_id, ...
--   primary_amount, primary_currency, secondary_amount, secondary_currency
--   profit_usd, fee_usd, commission_usd
--   accounting_status, approved_by, approved_at, rejection_reason
--
-- Подключённые сущности:
--   1. deal              — обычные и OTC сделки (через kind)
--   2. transfer          — interoffice / inter-account transfers
--   3. expense           — income / expense entries
--   4. balance_adjustment — корректировки балансов
--   5. cash_closure      — закрытия кассы
--
-- View JOIN'ит accounting_audits, чтобы вернуть status и approver.
-- Если строки в audits ещё нет — coalesce → 'pending_review'.
--
-- Используется в: AccountingTab. Не критичен для перформанса при <10k операций.
-- ============================================================================

create or replace view public.v_accounting_feed as

-- ─── 1. Deals ─────────────────────────────────────────────────────────
select
  'deal'::text as entity_type,
  d.id::text as entity_id,
  d.created_at as occurred_at,
  d.office_id,
  d.manager_id,
  d.client_id,
  d.client_nickname as counterparty_label,
  d.kind as deal_kind,                 -- regular | otc | broker
  d.in_kind as deal_in_kind,           -- ours_now/partner_now/...
  null::text as transfer_kind,
  null::text as expense_type,
  -- primary = что пришло (IN)
  d.amount_in as primary_amount,
  d.currency_in as primary_currency,
  -- secondary = что выдано (берём первую leg для краткой строки)
  (select sum(l.amount) from public.deal_legs l where l.deal_id = d.id) as secondary_amount,
  (select string_agg(distinct l.currency, '/') from public.deal_legs l where l.deal_id = d.id) as secondary_currency,
  d.fee_usd, d.profit_usd, d.commission_usd,
  d.referral,
  d.status as op_status,               -- pending/completed/checking/deleted/flagged
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
  'transfer'::text,
  t.id::text,
  t.created_at,
  acc_from.office_id,
  null::uuid as manager_id,            -- transfers не привязаны к manager напрямую
  null::uuid as client_id,
  null::text as counterparty_label,
  null::text as deal_kind,
  null::text as deal_in_kind,
  case
    when acc_from.office_id <> acc_to.office_id then 'interoffice'
    else 'inter_account'
  end as transfer_kind,
  null::text as expense_type,
  t.from_amount as primary_amount,
  t.from_currency as primary_currency,
  t.to_amount as secondary_amount,
  t.to_currency as secondary_currency,
  null::numeric as fee_usd,
  null::numeric as profit_usd,
  null::numeric as commission_usd,
  null::boolean as referral,
  null::text as op_status,
  t.note as comment,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at,
  t.created_by
from public.transfers t
left join public.accounts acc_from on acc_from.id = t.from_account_id
left join public.accounts acc_to on acc_to.id = t.to_account_id
left join public.accounting_audits a
  on a.entity_type = 'transfer' and a.entity_id = t.id::text

union all

-- ─── 3. Expenses (income / expense) ──────────────────────────────────
select
  'expense'::text,
  e.id::text,
  e.created_at,
  e.office_id,
  null::uuid,                          -- expenses не привязаны к manager
  null::uuid,
  null::text,
  null::text, null::text, null::text,
  e.type::text as expense_type,
  e.amount as primary_amount,
  e.currency_code as primary_currency,
  null::numeric, null::text,
  null::numeric, null::numeric, null::numeric,
  null::boolean,
  null::text,
  e.note as comment,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at,
  e.created_by
from public.expenses e
left join public.accounting_audits a
  on a.entity_type = 'expense' and a.entity_id = e.id::text

union all

-- ─── 4. Balance adjustments ──────────────────────────────────────────
select
  'balance_adjustment'::text,
  ba.id::text,
  ba.created_at,
  acc.office_id,
  ba.created_by as manager_id,         -- кто создал = «manager» в feed-смысле
  null::uuid,
  null::text,
  null::text, null::text, null::text, null::text,
  ba.difference as primary_amount,     -- может быть отрицательным
  ba.currency_code as primary_currency,
  ba.new_balance as secondary_amount,  -- куда пришли (новый остаток)
  ba.currency_code as secondary_currency,
  null::numeric, null::numeric, null::numeric,
  null::boolean,
  null::text,
  ba.note as comment,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at,
  ba.created_by
from public.balance_adjustments ba
left join public.accounts acc on acc.id = ba.account_id
left join public.accounting_audits a
  on a.entity_type = 'balance_adjustment' and a.entity_id = ba.id::text

union all

-- ─── 5. Cash closures ────────────────────────────────────────────────
select
  'cash_closure'::text,
  cc.id::text,
  cc.created_at,
  cc.office_id,
  cc.manager_id,
  null::uuid,
  null::text,
  null::text, null::text, null::text, null::text,
  null::numeric, null::text,
  null::numeric, null::text,
  null::numeric, null::numeric, null::numeric,
  null::boolean,
  null::text,
  cc.manager_comment as comment,
  coalesce(a.status, 'pending_review'),
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at,
  cc.manager_id as created_by
from public.cash_closures cc
left join public.accounting_audits a
  on a.entity_type = 'cash_closure' and a.entity_id = cc.id::text;

-- ============================================================================
-- Verify
-- ============================================================================
select entity_type, accounting_status, count(*)
  from public.v_accounting_feed
  group by entity_type, accounting_status
  order by entity_type, accounting_status;
