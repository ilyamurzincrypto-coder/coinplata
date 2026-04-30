-- ============================================================================
-- CoinPlata · 0087_cash_closures.sql
--
-- Закрытие кассы (end-of-day reconciliation).
--
-- Менеджер в конце дня:
--   1) Видит системный остаток по своим счетам (балансы по нашим accounts).
--   2) Считает фактический остаток в кассе (нал + банк-выписка).
--   3) Записывает per-currency: system_total, actual_total, diff, note.
--   4) Может оставить общий комментарий.
--
-- Бухгалтер в Бухгалтерском репорте:
--   - видит cash_closure как обычную операцию
--   - approve / reject через accounting_review (entity_type='cash_closure')
--
-- НЕ создаёт балансовых корректировок автоматически — diff'ы лишь
-- информативны. Если бухгалтер хочет оформить расхождение как корректировку
-- — он создаёт balance_adjustment отдельно (миграция 0084).
-- ============================================================================

-- 1. Table
create table if not exists public.cash_closures (
  id              uuid primary key default gen_random_uuid(),
  office_id       uuid not null references public.offices(id),
  manager_id      uuid not null references public.users(id),
  closure_date    date not null,
  -- jsonb: array of { currency, system_total, actual_total, diff, note? }
  details         jsonb not null check (jsonb_typeof(details) = 'array' and jsonb_array_length(details) > 0),
  manager_comment text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cash_closures_office_idx on public.cash_closures(office_id);
create index if not exists cash_closures_manager_idx on public.cash_closures(manager_id);
create index if not exists cash_closures_date_idx on public.cash_closures(closure_date desc);

-- updated_at touch
drop trigger if exists cash_closures_touch on public.cash_closures;
create trigger cash_closures_touch
  before update on public.cash_closures
  for each row execute function public._touch_accounting_audit_updated_at();

alter table public.cash_closures enable row level security;

drop policy if exists "cash_closures_read" on public.cash_closures;
create policy "cash_closures_read" on public.cash_closures
  for select to authenticated using (true);

-- WRITE: manager может создавать свои closures, accountant/owner — любые.
drop policy if exists "cash_closures_write" on public.cash_closures;
create policy "cash_closures_write" on public.cash_closures
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid()
              and (u.role in ('owner','accountant','admin')
                   or (u.role = 'manager' and public.cash_closures.manager_id = u.id)))
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid()
              and (u.role in ('owner','accountant','admin')
                   or (u.role = 'manager' and manager_id = u.id)))
  );

-- 2. RPC create_cash_closure
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
  v_item jsonb;
  v_currency text;
begin
  if p_office_id is null then
    raise exception 'office_id required';
  end if;
  if p_closure_date is null then
    raise exception 'closure_date required';
  end if;
  if jsonb_typeof(p_details) <> 'array' or jsonb_array_length(p_details) = 0 then
    raise exception 'details: must be non-empty jsonb array';
  end if;

  -- Валидация каждой строки details
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

  insert into public.cash_closures (office_id, manager_id, closure_date, details, manager_comment)
  values (p_office_id, v_uid, p_closure_date, p_details,
          case when p_comment is not null and length(trim(p_comment)) > 0
               then trim(p_comment) else null end)
  returning id into v_id;

  return v_id;
end;
$func$;

grant execute on function public.create_cash_closure(uuid, date, jsonb, text)
  to authenticated;

-- 3. Auto-invalidation trigger (теперь когда таблица существует)
drop trigger if exists cash_closures_invalidate_audit on public.cash_closures;
create trigger cash_closures_invalidate_audit
  after update of details, manager_comment, closure_date
  on public.cash_closures
  for each row execute function public._invalidate_accounting_audit('cash_closure');

-- 4. Verify
select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema='public' and table_name='cash_closures'
  order by ordinal_position;

select pg_get_function_identity_arguments(oid) as signature
  from pg_proc where proname = 'create_cash_closure' and pronamespace = 'public'::regnamespace;
