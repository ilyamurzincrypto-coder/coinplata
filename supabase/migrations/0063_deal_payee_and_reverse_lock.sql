-- ============================================================================
-- CoinPlata · 0063_deal_payee_and_reverse_lock.sql
--
-- 1) Deal payee — менеджер ответственный за ВЫДАЧУ денег по сделке. Когда
--    OUT-leg расположен в другом офисе (или у другого менеджера), создатель
--    сделки отмечает кто будет выдавать. Получатель (payee) видит сделку
--    как "невыданная" в своём UI и подтверждает выдачу.
--
-- 2) Reverse lock — фикс уязвимости: триггер sync_reverse_pair раньше
--    перезатирал reverse.base_rate каждый раз когда admin update'ил master,
--    делая independent buy/sell rate невозможным. Теперь reverse_locked
--    флаг защищает explicit override.
--
-- 3) RPC set_deal_payee — назначить ответственного на existing сделку
--    (вызывается из frontend сразу после rpcCreateDeal).
--
-- 4) RPC mark_deal_payed_out — payee подтверждает что выдал деньги.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Deal payee columns
-- ----------------------------------------------------------------------------
alter table public.deals
  add column if not exists payee_user_id uuid references public.users(id),
  add column if not exists payee_office_id uuid references public.offices(id),
  add column if not exists payed_out_at timestamptz,
  add column if not exists payed_out_by uuid references public.users(id),
  add column if not exists payed_out_note text;

create index if not exists deals_payee_pending_idx
  on public.deals(payee_user_id)
  where payee_user_id is not null and payed_out_at is null;

-- ----------------------------------------------------------------------------
-- 2. Reverse lock — независимый sell/buy rate
-- ----------------------------------------------------------------------------
alter table public.pairs
  add column if not exists reverse_locked boolean not null default false;

-- Обновляем sync_reverse_pair: если reverse pair locked, не перезаписываем
-- её base_rate. spread всё равно копируем (он логически общий).
create or replace function public.sync_reverse_pair()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if new.is_master is not true then
    return new;
  end if;
  if new.base_rate is null or new.base_rate = 0 then
    return new;
  end if;
  -- Spread всегда синхронизируется. base_rate — только если reverse не locked.
  update public.pairs
    set base_rate = case
          when reverse_locked then base_rate
          else 1.0 / new.base_rate
        end,
        spread_percent = new.spread_percent,
        updated_at = new.updated_at
    where from_currency = new.to_currency
      and to_currency = new.from_currency
      and is_default = true
      and is_master = false;
  return new;
end;
$func$;

-- update_pair (0062) теперь дополнительно ставит reverse_locked=true когда
-- админ задал явный p_reverse_rate. Без переписывания всей функции — patch
-- через ALTER FUNCTION? Нет, в pg нельзя. Делаем drop + recreate.
drop function if exists public.update_pair(text, text, numeric, numeric, numeric);

create function public.update_pair(
  p_from text,
  p_to text,
  p_base_rate numeric default null,
  p_spread numeric default null,
  p_reverse_rate numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['accountant','admin','owner']);
  v_pair_id uuid;
  v_pair_is_master boolean;
  v_master_id uuid;
  v_target_id uuid;
  v_master_rate numeric;
  v_master_spread numeric;
  v_master_from text;
  v_master_to text;
  v_reverse_target_rate numeric;
begin
  select id, is_master, from_currency, to_currency
    into v_pair_id, v_pair_is_master, v_master_from, v_master_to
    from public.pairs
    where from_currency = upper(p_from)
      and to_currency = upper(p_to)
      and is_default = true
    limit 1;

  if v_pair_id is null then
    raise exception 'No default pair for % → %', p_from, p_to using errcode = 'P0002';
  end if;

  if v_pair_is_master then
    v_target_id := v_pair_id;
    v_master_rate := p_base_rate;
    v_master_spread := p_spread;
    v_reverse_target_rate := p_reverse_rate;
  else
    select id, from_currency, to_currency
      into v_master_id, v_master_from, v_master_to
      from public.pairs
      where from_currency = upper(p_to)
        and to_currency = upper(p_from)
        and is_default = true
        and is_master = true
      limit 1;
    if v_master_id is null then
      v_target_id := v_pair_id;
      v_master_rate := p_base_rate;
      v_master_spread := p_spread;
      v_reverse_target_rate := p_reverse_rate;
    else
      v_target_id := v_master_id;
      v_master_rate := case
        when p_base_rate is not null and p_base_rate > 0 then 1.0 / p_base_rate
        else null
      end;
      v_master_spread := p_spread;
      v_reverse_target_rate := p_reverse_rate;
    end if;
  end if;

  -- UPDATE master (триггер sync_reverse_pair синхронизирует reverse,
  -- если reverse_locked=false; если locked — оставляет independent value).
  update public.pairs
    set base_rate = coalesce(v_master_rate, base_rate),
        spread_percent = coalesce(v_master_spread, spread_percent),
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_target_id;

  -- Если задан явный reverse_rate — overrides + LOCK reverse, чтобы при
  -- следующих update_pair триггер не перезаписал.
  if v_reverse_target_rate is not null and v_reverse_target_rate > 0 then
    update public.pairs
      set base_rate = v_reverse_target_rate,
          reverse_locked = true,
          updated_at = now(),
          updated_by = auth.uid()
      where from_currency = v_master_to
        and to_currency = v_master_from
        and is_default = true
        and is_master = false;
  end if;
end;
$func$;

grant execute on function public.update_pair(text, text, numeric, numeric, numeric) to authenticated;

-- Также import_rates (0060) использует тот же flow — buy_rate должен
-- ставить reverse_locked=true. Patching:
drop function if exists public.import_rates(jsonb, text);

create function public.import_rates(
  p_rows jsonb,
  p_reason text default 'xlsx import'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_user uuid := auth.uid();
  v_snapshot_id uuid;
  v_row jsonb;
  v_from text;
  v_to text;
  v_rate numeric;
  v_buy_rate numeric;
  v_master_from text;
  v_master_to text;
  v_master_rate numeric;
  v_reverse_rate numeric;
  v_master_id uuid;
  v_updated int := 0;
  v_inserted int := 0;
  v_current_rates jsonb;
  v_total_pairs int;
  v_from_prio int;
  v_to_prio int;
  v_input_is_master boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array';
  end if;

  select
    jsonb_object_agg(from_currency || '_' || to_currency, rate),
    count(*)
  into v_current_rates, v_total_pairs
  from public.pairs where is_default;

  insert into public.rate_snapshots (office_id, created_by, reason, rates, pairs_count)
  values (null, v_user, coalesce(p_reason, 'xlsx import'), coalesce(v_current_rates, '{}'::jsonb), coalesce(v_total_pairs, 0))
  returning id into v_snapshot_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_from := upper(trim(v_row->>'from'));
    v_to   := upper(trim(v_row->>'to'));
    v_rate := (v_row->>'rate')::numeric;
    v_buy_rate := nullif(v_row->>'buy_rate', '')::numeric;

    if v_from is null or v_to is null or v_from = '' or v_to = '' or v_from = v_to then
      raise exception 'Invalid row: from=% to=% rate=%', v_from, v_to, v_rate;
    end if;
    if v_rate is null or v_rate <= 0 then
      raise exception 'Invalid rate for %/%: %', v_from, v_to, v_rate;
    end if;
    if v_buy_rate is not null and v_buy_rate <= 0 then
      raise exception 'Invalid buy_rate for %/%: %', v_from, v_to, v_buy_rate;
    end if;

    if not exists (select 1 from public.currencies where code = v_from) then
      raise exception 'Unknown currency: %', v_from;
    end if;
    if not exists (select 1 from public.currencies where code = v_to) then
      raise exception 'Unknown currency: %', v_to;
    end if;

    v_from_prio := case v_from
      when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
      when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;
    v_to_prio := case v_to
      when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
      when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;

    v_input_is_master := (v_from_prio < v_to_prio)
      or (v_from_prio = v_to_prio and v_from < v_to);

    if v_input_is_master then
      v_master_from := v_from;
      v_master_to := v_to;
      v_master_rate := v_rate;
      v_reverse_rate := v_buy_rate;
    else
      v_master_from := v_to;
      v_master_to := v_from;
      v_master_rate := 1.0 / v_rate;
      v_reverse_rate := v_buy_rate;
    end if;

    select id into v_master_id
      from public.pairs
      where from_currency = v_master_from
        and to_currency = v_master_to
        and is_default = true
      limit 1;

    if v_master_id is null then
      insert into public.pairs (
        from_currency, to_currency, base_rate, spread_percent,
        is_default, is_master, priority, updated_by
      ) values (
        v_master_from, v_master_to, v_master_rate, 0,
        true, true, 50, v_user
      ) returning id into v_master_id;
      v_inserted := v_inserted + 1;
      if not exists (
        select 1 from public.pairs
        where from_currency = v_master_to and to_currency = v_master_from and is_default
      ) then
        insert into public.pairs (
          from_currency, to_currency, base_rate, spread_percent,
          is_default, is_master, priority, updated_by
        ) values (
          v_master_to, v_master_from, 1.0 / v_master_rate, 0,
          true, false, 50, v_user
        );
      end if;
    else
      update public.pairs
        set base_rate = v_master_rate,
            updated_at = now(),
            updated_by = v_user,
            is_master = true
        where id = v_master_id;
      v_updated := v_updated + 1;
    end if;

    -- Explicit buy_rate → lock reverse to prevent trigger from overwriting
    if v_reverse_rate is not null and v_reverse_rate > 0 then
      update public.pairs
        set base_rate = v_reverse_rate,
            reverse_locked = true,
            updated_at = now(),
            updated_by = v_user
        where from_currency = v_master_to
          and to_currency = v_master_from
          and is_default = true;
    end if;
  end loop;

  return jsonb_build_object(
    'updated', v_updated,
    'inserted', v_inserted,
    'snapshot_id', v_snapshot_id
  );
end;
$func$;

grant execute on function public.import_rates(jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC set_deal_payee — назначить ответственного за выдачу
-- ----------------------------------------------------------------------------
create or replace function public.set_deal_payee(
  p_deal_id bigint,
  p_payee_user_id uuid,
  p_payee_office_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_caller_id uuid := auth.uid();
  v_deal record;
begin
  select id, manager_id, created_by_user_id, status, payed_out_at
    into v_deal
    from public.deals where id = p_deal_id;
  if not found then
    raise exception 'Deal % not found', p_deal_id using errcode = 'P0002';
  end if;
  -- Manager может ставить payee только на свои сделки (или на сделки где
  -- он сам payee). Admin/owner — на любые.
  if v_caller_role = 'manager'
     and v_deal.manager_id <> v_caller_id
     and v_deal.created_by_user_id <> v_caller_id then
    raise exception 'Manager can only set payee on own deals' using errcode = '42501';
  end if;
  if v_deal.payed_out_at is not null then
    raise exception 'Deal % already payed out', p_deal_id using errcode = '22000';
  end if;

  update public.deals
    set payee_user_id = p_payee_user_id,
        payee_office_id = p_payee_office_id,
        updated_at = now()
    where id = p_deal_id;
end;
$func$;

grant execute on function public.set_deal_payee(bigint, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC mark_deal_payed_out — payee подтверждает выдачу
-- ----------------------------------------------------------------------------
create or replace function public.mark_deal_payed_out(
  p_deal_id bigint,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_deal record;
begin
  select id, payee_user_id, payed_out_at
    into v_deal
    from public.deals where id = p_deal_id;
  if not found then
    raise exception 'Deal % not found', p_deal_id using errcode = 'P0002';
  end if;
  if v_deal.payed_out_at is not null then
    raise exception 'Deal % already payed out', p_deal_id using errcode = '22000';
  end if;
  -- Только назначенный payee (или admin/owner) может пометить выданным
  if v_caller_role = 'manager'
     and v_deal.payee_user_id is not null
     and v_deal.payee_user_id <> v_caller_id then
    raise exception 'Only assigned payee can mark deal as payed out' using errcode = '42501';
  end if;

  update public.deals
    set payed_out_at = now(),
        payed_out_by = v_caller_id,
        payed_out_note = p_note,
        updated_at = now()
    where id = p_deal_id;
end;
$func$;

grant execute on function public.mark_deal_payed_out(bigint, text) to authenticated;
