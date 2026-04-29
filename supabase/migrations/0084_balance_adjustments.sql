-- ============================================================================
-- CoinPlata · 0084_balance_adjustments.sql
--
-- Initial / opening balance корректировки.
--
-- Зачем. Иногда нужно вручную поправить остаток на счёте: ошибка ввода,
-- завезли наличку без записи, инвентаризация после длинного периода. Раньше
-- это делалось через прямой UPDATE в БД — теперь через аудируемый аппарат:
--
--   1) public.balance_adjustments — отдельная таблица с историей
--      корректировок (account_id, old/new/diff, note, кто, когда).
--   2) Каждая корректировка эмитит ОДНО движение в account_movements
--      с source_kind = 'adjustment' (этот kind уже разрешён check'ом из 0001).
--      direction = 'in' если diff > 0, 'out' если diff < 0.
--      reserved = false. amount = abs(diff).
--   3) Балансы автоматически пересчитываются (они = sum(movements)).
--
-- Влияние на P&L: ZERO. P&L агрегаты используют source_kind in (exchange_*),
-- profit_usd сделок и явные expense entries. 'adjustment' нигде в этих
-- агрегатах не появляется — как и сейчас не появляются 'opening' / 'transfer_*'.
--
-- RPC create_balance_adjustment:
--   - SECURITY DEFINER, только admin/owner/accountant
--   - читает текущий баланс через v_account_balances
--   - пишет балансовую корректировку и movement атомарно
--   - возвращает uuid balance_adjustment row
-- ============================================================================

-- 1. balance_adjustments
create table if not exists public.balance_adjustments (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete restrict,
  currency_code   text not null references public.currencies(code),
  old_balance     numeric(20,8) not null,
  new_balance     numeric(20,8) not null,
  difference      numeric(20,8) generated always as (new_balance - old_balance) stored,
  note            text not null check (length(trim(note)) > 0),
  movement_id     uuid,  -- ссылка на эмитированный account_movement
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists balance_adjustments_account_idx
  on public.balance_adjustments(account_id);
create index if not exists balance_adjustments_created_at_idx
  on public.balance_adjustments(created_at desc);

alter table public.balance_adjustments enable row level security;

drop policy if exists "balance_adjustments_read" on public.balance_adjustments;
create policy "balance_adjustments_read" on public.balance_adjustments
  for select to authenticated using (true);

drop policy if exists "balance_adjustments_write_admin" on public.balance_adjustments;
create policy "balance_adjustments_write_admin" on public.balance_adjustments
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('admin','owner','accountant'))
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('admin','owner','accountant'))
  );

-- 2. RPC create_balance_adjustment
create or replace function public.create_balance_adjustment(
  p_account_id uuid,
  p_new_balance numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner','accountant']);
  v_uid uuid := auth.uid();
  v_account record;
  v_old_balance numeric(20,8);
  v_diff numeric(20,8);
  v_movement_id uuid;
  v_adj_id uuid;
  v_now timestamptz := now();
begin
  if p_account_id is null then
    raise exception 'account_id required' using errcode = '22000';
  end if;
  if p_new_balance is null then
    raise exception 'new_balance required' using errcode = '22000';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'note required (use comment to explain the correction)'
      using errcode = '22000';
  end if;

  select id, currency_code, office_id into v_account
    from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account % not found', p_account_id;
  end if;

  -- current balance из view
  select coalesce(b.total, 0) into v_old_balance
    from public.v_account_balances b where b.account_id = p_account_id;
  if v_old_balance is null then
    v_old_balance := 0;
  end if;

  v_diff := p_new_balance - v_old_balance;

  if abs(v_diff) < 0.00000001 then
    raise exception 'No change: new_balance equals current balance';
  end if;

  -- 1. INSERT balance_adjustments (без movement_id — обновим после)
  insert into public.balance_adjustments (
    account_id, currency_code, old_balance, new_balance, note, created_by, created_at
  ) values (
    p_account_id, v_account.currency_code, v_old_balance, p_new_balance, trim(p_note), v_uid, v_now
  ) returning id into v_adj_id;

  -- 2. INSERT movement
  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, note, created_by, created_at
  ) values (
    p_account_id, abs(v_diff),
    case when v_diff > 0 then 'in' else 'out' end,
    v_account.currency_code, false,
    'adjustment', v_adj_id::text,
    trim(p_note), v_uid, v_now
  ) returning id into v_movement_id;

  -- 3. Сшиваем balance_adjustment с movement_id
  update public.balance_adjustments
    set movement_id = v_movement_id
    where id = v_adj_id;

  return v_adj_id;
end;
$func$;

grant execute on function public.create_balance_adjustment(uuid, numeric, text)
  to authenticated;

-- 3. View с историей: account name, currency, who, etc — для UI.
create or replace view public.v_balance_adjustments as
select
  a.id,
  a.account_id,
  acc.name as account_name,
  acc.office_id,
  a.currency_code,
  a.old_balance,
  a.new_balance,
  a.difference,
  a.note,
  a.movement_id,
  a.created_at,
  a.created_by,
  u.full_name as created_by_name
from public.balance_adjustments a
left join public.accounts acc on acc.id = a.account_id
left join public.users u on u.id = a.created_by
order by a.created_at desc;

-- 4. Verify
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name='balance_adjustments'
  order by ordinal_position;

select pg_get_function_identity_arguments(oid) as signature
  from pg_proc
  where proname = 'create_balance_adjustment'
    and pronamespace = 'public'::regnamespace;
