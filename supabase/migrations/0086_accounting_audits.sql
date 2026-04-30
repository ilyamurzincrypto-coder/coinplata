-- ============================================================================
-- CoinPlata · 0086_accounting_audits.sql
--
-- Бухгалтерский audit-слой: подтверждение операций бухгалтером без
-- мутации underlying таблиц.
--
-- Принцип. Менеджер создаёт операцию (deal / transfer / expense /
-- balance_adjustment / cash_closure). По умолчанию accounting_status =
-- 'pending_review'. Бухгалтер открывает Capital → Бухгалтерский репорт,
-- проверяет, нажимает Approve / Reject. Запись хранится в отдельной
-- таблице accounting_audits — underlying entity не трогается.
--
-- Trigger _invalidate_accounting_audit срабатывает при UPDATE
-- underlying таблиц и сбрасывает approved → pending_review автоматически.
-- Так бухгалтер видит когда менеджер исправил операцию после approve.
--
-- RPC accounting_review(entity_type, entity_id, action, reason, notes)
-- — единственный путь изменения статуса. SECURITY DEFINER + role-check.
-- Действия:
--   approve — status='approved', approved_by/approved_at заполняются
--   reject  — status='rejected', rejection_reason обязателен
--   reset   — status='pending_review' (отозвать решение)
-- ============================================================================

-- ============================================================================
-- 1. Table
-- ============================================================================

create table if not exists public.accounting_audits (
  id                    uuid primary key default gen_random_uuid(),
  entity_type           text not null check (entity_type in (
                          'deal','transfer','expense',
                          'balance_adjustment','cash_closure'
                        )),
  entity_id             text not null,
  status                text not null default 'pending_review' check (status in (
                          'pending_review','approved','rejected'
                        )),
  approved_by           uuid references public.users(id),
  approved_at           timestamptz,
  rejection_reason      text,
  reviewer_notes        text,
  -- Когда underlying entity был обновлён в последний раз — сбрасывается
  -- триггером ниже. Бухгалтер видит «approved устарел» если updated > approved.
  underlying_updated_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (entity_type, entity_id),
  check (
    (status = 'approved' and approved_by is not null and approved_at is not null)
    or (status = 'rejected' and rejection_reason is not null and length(trim(rejection_reason)) > 0)
    or (status = 'pending_review')
  )
);

create index if not exists accounting_audits_status_idx
  on public.accounting_audits(status);
create index if not exists accounting_audits_entity_idx
  on public.accounting_audits(entity_type, entity_id);
create index if not exists accounting_audits_approved_at_idx
  on public.accounting_audits(approved_at desc) where approved_at is not null;

-- updated_at автоматический touch
create or replace function public._touch_accounting_audit_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists accounting_audits_touch on public.accounting_audits;
create trigger accounting_audits_touch
  before update on public.accounting_audits
  for each row execute function public._touch_accounting_audit_updated_at();

alter table public.accounting_audits enable row level security;

-- READ: все аутентифицированные (для отображения статуса в обычных списках,
-- например пометки «approved» рядом со сделкой). Это безопасно — это просто
-- факт «бухгалтер посмотрел».
drop policy if exists "accounting_audits_read" on public.accounting_audits;
create policy "accounting_audits_read" on public.accounting_audits
  for select to authenticated using (true);

-- WRITE: только через RPC accounting_review (SECURITY DEFINER).
-- Прямой DML заблокирован.
drop policy if exists "accounting_audits_no_direct_write" on public.accounting_audits;
create policy "accounting_audits_no_direct_write" on public.accounting_audits
  for all to authenticated using (false) with check (false);

-- ============================================================================
-- 2. RPC accounting_review
-- ============================================================================

create or replace function public.accounting_review(
  p_entity_type text,
  p_entity_id text,
  p_action text,
  p_reason text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['owner','accountant']);
  v_uid uuid := auth.uid();
  v_audit_id uuid;
  v_now timestamptz := now();
begin
  if p_entity_type not in ('deal','transfer','expense','balance_adjustment','cash_closure') then
    raise exception 'Unknown entity_type: %', p_entity_type using errcode = '22000';
  end if;
  if p_entity_id is null or length(trim(p_entity_id)) = 0 then
    raise exception 'entity_id required' using errcode = '22000';
  end if;
  if p_action not in ('approve','reject','reset') then
    raise exception 'Action must be approve | reject | reset (got %)', p_action
      using errcode = '22000';
  end if;
  if p_action = 'reject' and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'rejection_reason required for reject action' using errcode = '22000';
  end if;

  -- UPSERT
  insert into public.accounting_audits (
    entity_type, entity_id, status,
    approved_by, approved_at, rejection_reason, reviewer_notes
  )
  values (
    p_entity_type, p_entity_id,
    case p_action
      when 'approve' then 'approved'
      when 'reject'  then 'rejected'
      when 'reset'   then 'pending_review'
    end,
    case when p_action = 'approve' then v_uid else null end,
    case when p_action = 'approve' then v_now else null end,
    case when p_action = 'reject'  then trim(p_reason) else null end,
    case when p_notes is not null and length(trim(p_notes)) > 0 then trim(p_notes) else null end
  )
  on conflict (entity_type, entity_id) do update set
    status = excluded.status,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    rejection_reason = excluded.rejection_reason,
    reviewer_notes = coalesce(excluded.reviewer_notes, public.accounting_audits.reviewer_notes)
  returning id into v_audit_id;

  return v_audit_id;
end;
$func$;

grant execute on function public.accounting_review(text, text, text, text, text)
  to authenticated;

-- Bulk-версия для approve/reject нескольких операций сразу.
create or replace function public.accounting_review_bulk(
  p_items jsonb,        -- [{ entity_type, entity_id }]
  p_action text,
  p_reason text default null,
  p_notes text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['owner','accountant']);
  v_item jsonb;
  v_count int := 0;
begin
  if p_action not in ('approve','reject','reset') then
    raise exception 'Action must be approve | reject | reset' using errcode = '22000';
  end if;
  if p_action = 'reject' and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'rejection_reason required for reject' using errcode = '22000';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    perform public.accounting_review(
      v_item->>'entity_type',
      v_item->>'entity_id',
      p_action,
      p_reason,
      p_notes
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$func$;

grant execute on function public.accounting_review_bulk(jsonb, text, text, text)
  to authenticated;

-- ============================================================================
-- 3. Auto-invalidation trigger
--
-- Когда underlying entity редактируется ПОСЛЕ approve — статус
-- автоматически возвращается в pending_review. Бухгалтер видит что что-то
-- изменилось и пересматривает.
--
-- Trigger создаётся для каждого underlying типа отдельно и принимает
-- entity_type через TG_ARGV.
-- ============================================================================

create or replace function public._invalidate_accounting_audit()
returns trigger
language plpgsql
as $$
declare
  v_entity_type text := TG_ARGV[0];
  v_entity_id text;
begin
  -- entity_id берём из NEW (id колонка либо bigint либо uuid — to_text)
  v_entity_id := NEW.id::text;

  update public.accounting_audits
    set status = 'pending_review',
        rejection_reason = null,
        approved_by = null,
        approved_at = null,
        underlying_updated_at = now(),
        updated_at = now()
   where entity_type = v_entity_type
     and entity_id = v_entity_id
     and status in ('approved','rejected');

  return NEW;
end;
$$;

-- deals — большая часть полей могут меняться. Срабатываем на любой UPDATE.
drop trigger if exists deals_invalidate_audit on public.deals;
create trigger deals_invalidate_audit
  after update of office_id, manager_id, client_id, currency_in, amount_in,
                  in_account_id, in_partner_account_id, fee_usd, profit_usd,
                  commission_usd, comment, status, kind, in_kind,
                  referral
  on public.deals
  for each row execute function public._invalidate_accounting_audit('deal');

-- transfers
drop trigger if exists transfers_invalidate_audit on public.transfers;
create trigger transfers_invalidate_audit
  after update of from_account_id, to_account_id, from_amount, to_amount, rate, note
  on public.transfers
  for each row execute function public._invalidate_accounting_audit('transfer');

-- expenses (income/expense entries)
drop trigger if exists expenses_invalidate_audit on public.expenses;
create trigger expenses_invalidate_audit
  after update of office_id, account_id, category_id, amount, currency_code,
                  entry_date, note, type
  on public.expenses
  for each row execute function public._invalidate_accounting_audit('expense');

-- balance_adjustments — обычно immutable, но на всякий случай
drop trigger if exists balance_adjustments_invalidate_audit on public.balance_adjustments;
create trigger balance_adjustments_invalidate_audit
  after update of new_balance, note
  on public.balance_adjustments
  for each row execute function public._invalidate_accounting_audit('balance_adjustment');

-- cash_closures — миграция 0087 добавит trigger там же, после создания таблицы.

-- ============================================================================
-- 4. Verify
-- ============================================================================

select 'accounting_audits' as t, count(*) from public.accounting_audits;

select pg_get_function_identity_arguments(oid) as signature
  from pg_proc where proname = 'accounting_review' and pronamespace = 'public'::regnamespace;

select tgname, tgenabled from pg_trigger
  where tgname like '%invalidate_audit%'
  order by tgname;
