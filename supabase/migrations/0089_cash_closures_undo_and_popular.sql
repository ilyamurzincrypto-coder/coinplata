-- ============================================================================
-- CoinPlata · 0089_cash_closures_undo_and_popular.sql
--
-- Расширения для cash_closures (миграция 0087):
--
-- 1. cancelled_at / cancelled_by — soft-delete для 5-минутного undo окна.
-- 2. UNIQUE (office_id, manager_id, closure_date) WHERE cancelled_at IS NULL
--    — partial unique. Один менеджер закрывает свою кассу один раз в день.
--    Если отменил — может закрыть снова.
-- 3. offices.popular_currencies text[] — какие валюты по умолчанию показывать
--    в форме закрытия (TRY/USD/RUB по умолчанию для всех).
-- 4. RPC create_cash_closure → UPSERT (обновляет если уже есть запись на
--    этот день+manager+office, не cancelled).
-- 5. RPC cancel_cash_closure(id) — отменить в течение 5 минут (только свою).
-- 6. v_accounting_feed — исключаем cancelled cash_closures.
-- ============================================================================

-- 1. cash_closures — undo столбцы
alter table public.cash_closures
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.users(id);

create index if not exists cash_closures_active_idx
  on public.cash_closures(office_id, closure_date) where cancelled_at is null;

-- 2. UNIQUE partial — один активный closure per (office, manager, date)
drop index if exists cash_closures_uniq_active;
create unique index cash_closures_uniq_active
  on public.cash_closures(office_id, manager_id, closure_date)
  where cancelled_at is null;

-- 3. offices.popular_currencies
alter table public.offices
  add column if not exists popular_currencies text[]
    default array['TRY','USD','RUB']::text[];

-- 4. UPSERT-версия create_cash_closure
drop function if exists public.create_cash_closure(uuid, date, jsonb, text);

create or replace function public.create_cash_closure(
  p_office_id uuid,
  p_closure_date date,
  p_details jsonb,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
  v_item jsonb;
  v_currency text;
begin
  if p_office_id is null then raise exception 'office_id required'; end if;
  if p_closure_date is null then raise exception 'closure_date required'; end if;
  if jsonb_typeof(p_details) <> 'array' or jsonb_array_length(p_details) = 0 then
    raise exception 'details: must be non-empty jsonb array';
  end if;

  for v_item in select * from jsonb_array_elements(p_details) loop
    v_currency := v_item->>'currency';
    if v_currency is null or length(v_currency) < 2 then
      raise exception 'details[].currency required';
    end if;
    if not exists (select 1 from public.currencies where code = v_currency) then
      raise exception 'Unknown currency: %', v_currency;
    end if;
    if v_item->>'system_total' is null or v_item->>'actual_total' is null then
      raise exception 'details[]: system_total and actual_total required';
    end if;
  end loop;

  -- Существует ли активный (non-cancelled) closure на этот day+manager+office?
  select id into v_existing
    from public.cash_closures
   where office_id = p_office_id
     and manager_id = v_uid
     and closure_date = p_closure_date
     and cancelled_at is null;

  if v_existing is not null then
    -- UPSERT — обновляем существующий. Trigger invalidate_audit вернёт
    -- бухгалтерский статус в pending_review автоматически.
    update public.cash_closures set
      details = p_details,
      manager_comment = case when p_comment is not null and length(trim(p_comment)) > 0
                             then trim(p_comment) else null end,
      updated_at = now()
     where id = v_existing;
    return v_existing;
  else
    insert into public.cash_closures (office_id, manager_id, closure_date, details, manager_comment)
    values (p_office_id, v_uid, p_closure_date, p_details,
            case when p_comment is not null and length(trim(p_comment)) > 0
                 then trim(p_comment) else null end)
    returning id into v_id;
    return v_id;
  end if;
end;
$func$;

grant execute on function public.create_cash_closure(uuid, date, jsonb, text)
  to authenticated;

-- 5. RPC cancel_cash_closure — undo в течение 5 минут
create or replace function public.cancel_cash_closure(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_row record;
  v_undo_window interval := interval '5 minutes';
begin
  select id, manager_id, created_at, cancelled_at into v_row
    from public.cash_closures where id = p_id;
  if not found then
    raise exception 'Cash closure % not found', p_id using errcode = '02000';
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'Already cancelled' using errcode = '22000';
  end if;

  -- manager: только свои + только в окне. accountant/owner — без окна.
  if v_caller_role = 'manager' then
    if v_row.manager_id <> v_uid then
      raise exception 'Manager can cancel only own closures' using errcode = '42501';
    end if;
    if now() - v_row.created_at > v_undo_window then
      raise exception 'Undo window expired (5 minutes). Ask accountant to reject.'
        using errcode = '22000';
    end if;
  end if;

  update public.cash_closures
    set cancelled_at = now(),
        cancelled_by = v_uid,
        updated_at = now()
   where id = p_id;
end;
$func$;

grant execute on function public.cancel_cash_closure(uuid) to authenticated;

-- 6. v_accounting_feed — исключаем cancelled
create or replace view public.v_accounting_feed as

-- ─── 1. Deals ─────────────────────────────────────────────────────────
select
  'deal'::text as entity_type,
  d.id::text as entity_id,
  d.created_at as occurred_at,
  d.office_id, d.manager_id, d.client_id,
  d.client_nickname as counterparty_label,
  d.kind as deal_kind, d.in_kind as deal_in_kind,
  null::text as transfer_kind, null::text as expense_type,
  d.amount_in as primary_amount, d.currency_in as primary_currency,
  (select sum(l.amount) from public.deal_legs l where l.deal_id = d.id) as secondary_amount,
  (select string_agg(distinct l.currency, '/') from public.deal_legs l where l.deal_id = d.id) as secondary_currency,
  d.fee_usd, d.profit_usd, d.commission_usd,
  d.referral, d.status as op_status, d.comment,
  coalesce(a.status, 'pending_review') as accounting_status,
  a.approved_by, a.approved_at, a.rejection_reason, a.reviewer_notes,
  a.underlying_updated_at, d.created_by_user_id as created_by
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

-- ─── 3. Expenses ─────────────────────────────────────────────────────
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

-- ─── 5. Cash closures (NEW: исключаем cancelled) ─────────────────────
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
-- Verify
-- ============================================================================
select column_name from information_schema.columns
  where table_schema='public' and table_name='cash_closures'
    and column_name in ('cancelled_at','cancelled_by');

select column_name from information_schema.columns
  where table_schema='public' and table_name='offices'
    and column_name = 'popular_currencies';

select pg_get_function_identity_arguments(oid) as signature
  from pg_proc where proname in ('create_cash_closure','cancel_cash_closure')
    and pronamespace='public'::regnamespace
  order by proname;
