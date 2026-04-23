-- ============================================================================
-- CoinPlata · 0002_leg_lifecycle.sql
-- Per-leg pending/partial/completed + planned/completed timestamps.
-- Multi-day deals support.
--
-- Apply AFTER 0001_init has run successfully.
-- Run in Supabase Dashboard → SQL Editor → paste → Run.
-- ============================================================================

-- 1. New columns on deal_legs
alter table public.deal_legs
  add column if not exists actual_amount numeric(20,8) not null default 0,
  add column if not exists planned_at timestamptz default now(),
  add column if not exists completed_at timestamptz;

-- 2. IN-side leg fields on deals (IN остаётся на уровне deal для MVP)
alter table public.deals
  add column if not exists in_actual_amount numeric(20,8) not null default 0,
  add column if not exists in_planned_at timestamptz default now(),
  add column if not exists in_completed_at timestamptz;

-- 3. Backfill: all existing completed deals get full actual + completed_at
update public.deals
   set in_actual_amount = amount_in,
       in_completed_at  = coalesce(confirmed_at, created_at),
       in_planned_at    = coalesce(in_planned_at, created_at)
 where status = 'completed' and in_actual_amount = 0;

update public.deal_legs dl
   set actual_amount = dl.amount,
       completed_at  = coalesce(
         (select confirmed_at from public.deals d where d.id = dl.deal_id),
         (select created_at  from public.deals d where d.id = dl.deal_id)
       ),
       planned_at = coalesce(
         dl.planned_at,
         (select created_at from public.deals d where d.id = dl.deal_id)
       )
 where dl.actual_amount = 0
   and exists (select 1 from public.deals d where d.id = dl.deal_id and d.status = 'completed');

-- 4. View: derived leg-status
create or replace view public.v_deal_legs_enriched as
select
  dl.*,
  case
    when dl.completed_at is not null and dl.actual_amount >= dl.amount then 'completed'
    when dl.actual_amount > 0 and dl.actual_amount < dl.amount then 'partial'
    when dl.completed_at is null and dl.planned_at is not null
         and dl.planned_at < (now() - interval '1 day') then 'delayed'
    else 'pending'
  end as leg_status
from public.deal_legs dl;

-- 5. Update create_deal to stamp planned/actual/completed on each leg
--    (полная замена функции — безопасно т.к. create or replace).
create or replace function public.create_deal(
  p_office_id uuid,
  p_manager_id uuid,
  p_client_id uuid,
  p_client_nickname text,
  p_currency_in text,
  p_amount_in numeric,
  p_in_account_id uuid,
  p_in_tx_hash text,
  p_referral boolean,
  p_comment text,
  p_status text,
  p_legs jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id bigint;
  v_office record;
  v_leg jsonb;
  v_idx smallint := 0;
  v_referral_pct numeric := coalesce((get_setting('referral_pct'))::numeric, 0.1);
  v_market_rate numeric;
  v_margin_usd numeric := 0;
  v_margin_in_curIn numeric;
  v_to_usd numeric;
  v_fee_usd numeric;
  v_min_fee_applied boolean;
  v_profit_usd numeric;
  v_referral_bonus numeric := 0;
  v_amt_in_usd numeric;
  v_mov_group uuid := gen_random_uuid();
  v_is_reserved boolean;
  v_has_obligation boolean := false;
  v_leg_office uuid;
  v_is_internal boolean;
  v_available numeric;
  v_leg_id uuid;
  v_final_status text;
  v_snapshot_id uuid;
  v_now timestamptz := now();
  v_leg_planned numeric;
  v_leg_is_crypto_send boolean;
  v_leg_has_address boolean;
  v_leg_fully_paid boolean;
begin
  select id, min_fee_usd, fee_percent into v_office
    from public.offices where id = p_office_id;
  if not found then raise exception 'Office % not found', p_office_id; end if;

  -- Margin USD (как раньше)
  for v_leg in select * from jsonb_array_elements(p_legs) loop
    select rate into v_market_rate from public.pairs
      where from_currency = p_currency_in and to_currency = (v_leg->>'currency') and is_default
      limit 1;
    if v_market_rate is null or v_market_rate <= 0 then continue; end if;
    v_margin_in_curIn :=
      ((v_leg->>'amount')::numeric / nullif((v_leg->>'rate')::numeric, 0)) -
      ((v_leg->>'amount')::numeric / v_market_rate);
    if p_currency_in = 'USD' then
      v_margin_usd := v_margin_usd + v_margin_in_curIn;
    else
      select rate into v_to_usd from public.pairs
        where from_currency = p_currency_in and to_currency = 'USD' and is_default limit 1;
      if v_to_usd is not null and v_to_usd > 0 then
        v_margin_usd := v_margin_usd + v_margin_in_curIn * v_to_usd;
      end if;
    end if;
  end loop;
  v_margin_usd := round(v_margin_usd, 2);

  v_fee_usd := greatest(v_margin_usd, v_office.min_fee_usd);
  v_min_fee_applied := v_margin_usd < v_office.min_fee_usd;

  if p_referral then
    if p_currency_in = 'USD' then
      v_amt_in_usd := p_amount_in;
    else
      select rate into v_to_usd from public.pairs
        where from_currency = p_currency_in and to_currency = 'USD' and is_default limit 1;
      v_amt_in_usd := p_amount_in * coalesce(v_to_usd, 0);
    end if;
    v_referral_bonus := round(v_amt_in_usd * v_referral_pct / 100, 2);
  end if;
  v_profit_usd := v_fee_usd - v_referral_bonus;

  select id into v_snapshot_id from public.rate_snapshots order by created_at desc limit 1;

  v_final_status := coalesce(p_status, 'completed');
  v_is_reserved := v_final_status in ('pending','checking');

  -- Insert deal: IN side planned/actual/completed
  insert into public.deals (
    office_id, manager_id, client_id, client_nickname,
    currency_in, amount_in, in_account_id, in_tx_hash,
    fee_usd, profit_usd, min_fee_applied, referral, comment, status,
    checking_started_at, checking_by, rate_snapshot_id,
    in_planned_at, in_actual_amount, in_completed_at
  ) values (
    p_office_id, p_manager_id, p_client_id, p_client_nickname,
    p_currency_in, p_amount_in, p_in_account_id, p_in_tx_hash,
    v_fee_usd, v_profit_usd, v_min_fee_applied, p_referral, p_comment, v_final_status,
    case when v_final_status = 'checking' then v_now else null end,
    case when v_final_status = 'checking' then p_manager_id else null end,
    v_snapshot_id,
    v_now,
    case when v_final_status = 'completed' and p_in_account_id is not null then p_amount_in else 0 end,
    case when v_final_status = 'completed' and p_in_account_id is not null then v_now else null end
  ) returning id into v_deal_id;

  if p_in_account_id is not null then
    insert into public.account_movements (
      account_id, amount, direction, currency_code, reserved,
      source_kind, source_ref_id, movement_group_id, note, created_by
    ) values (
      p_in_account_id, p_amount_in, 'in', p_currency_in, v_is_reserved,
      'exchange_in', v_deal_id::text, v_mov_group,
      'Deal #' || v_deal_id, p_manager_id
    );
  end if;

  -- Legs
  for v_leg in select * from jsonb_array_elements(p_legs) loop
    v_is_internal := false;
    v_leg_office := null;
    if (v_leg->>'account_id') is not null and (v_leg->>'account_id') <> '' then
      select office_id into v_leg_office from public.accounts where id = (v_leg->>'account_id')::uuid;
      v_is_internal := v_leg_office is not null and v_leg_office <> p_office_id;
    end if;

    v_leg_planned := (v_leg->>'amount')::numeric;
    v_leg_has_address := (v_leg->>'address') is not null and (v_leg->>'address') <> '';
    v_leg_is_crypto_send := v_leg_has_address and (v_leg->>'network_id') is not null;

    -- Available check (для obligation decision)
    v_available := null;
    if (v_leg->>'account_id') is not null and (v_leg->>'account_id') <> '' then
      select
        coalesce(b.total, 0) - coalesce(b.reserved, 0) -
        coalesce((
          select sum(amount) from public.obligations ob
          where ob.office_id = a.office_id and ob.currency_code = a.currency_code
            and ob.direction = 'we_owe' and ob.status = 'open'
        ), 0)
      into v_available
      from public.accounts a
      left join public.v_account_balances b on b.account_id = a.id
      where a.id = (v_leg->>'account_id')::uuid;
      if v_available is null then v_available := 0; end if;
    end if;

    -- Правило для leg.completed:
    --   fullyPaid = не obligation, не crypto-send-pending, сделка не pending/checking
    v_leg_fully_paid :=
      v_available is null or v_available >= v_leg_planned  -- хватает баланса
      and not v_leg_is_crypto_send                          -- не ждём on-chain
      and not v_is_reserved;                                -- deal не pending/checking

    insert into public.deal_legs (
      deal_id, leg_index, currency, amount, rate,
      account_id, address, network_id, send_status, is_internal,
      planned_at, actual_amount, completed_at
    ) values (
      v_deal_id, v_idx,
      v_leg->>'currency', v_leg_planned, (v_leg->>'rate')::numeric,
      nullif(v_leg->>'account_id','')::uuid,
      nullif(v_leg->>'address',''),
      nullif(v_leg->>'network_id',''),
      case when v_leg_is_crypto_send then 'pending_send' else null end,
      v_is_internal,
      v_now,
      case when v_leg_fully_paid then v_leg_planned else 0 end,
      case when v_leg_fully_paid then v_now else null end
    ) returning id into v_leg_id;

    if (v_leg->>'account_id') is not null and (v_leg->>'account_id') <> '' then
      if v_available >= v_leg_planned then
        insert into public.account_movements (
          account_id, amount, direction, currency_code, reserved,
          source_kind, source_ref_id, source_leg_index, movement_group_id,
          note, created_by
        ) values (
          (v_leg->>'account_id')::uuid,
          v_leg_planned, 'out', v_leg->>'currency',
          v_is_reserved or v_leg_has_address,
          'exchange_out', v_deal_id::text, v_idx, v_mov_group,
          'Deal #' || v_deal_id || ' · leg ' || (v_idx+1), p_manager_id
        );
      else
        insert into public.obligations (
          office_id, deal_id, deal_leg_id, client_id,
          currency_code, amount, direction, note, created_by
        ) values (
          p_office_id, v_deal_id, v_leg_id, p_client_id,
          v_leg->>'currency', v_leg_planned, 'we_owe',
          'Auto-created: insufficient balance at deal submit',
          p_manager_id
        );
        v_has_obligation := true;
      end if;
    end if;

    v_idx := v_idx + 1;
  end loop;

  if v_has_obligation then
    update public.deals set status = 'pending' where id = v_deal_id;
  end if;

  return v_deal_id;
end;
$$;

-- 6. complete_deal: закрывает все legs и IN при полном завершении
create or replace function public.complete_deal(p_deal_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now();
begin
  update public.deals set
    status = 'completed',
    confirmed_at = v_now,
    in_actual_amount = case when in_completed_at is null then amount_in else in_actual_amount end,
    in_completed_at = coalesce(in_completed_at, v_now)
  where id = p_deal_id and status in ('pending','checking');

  update public.account_movements set reserved = false
    where source_ref_id = p_deal_id::text;

  update public.deal_legs
  set actual_amount = case when completed_at is null then amount else actual_amount end,
      completed_at = coalesce(completed_at, v_now)
  where deal_id = p_deal_id;
end;
$$;

-- 7. settle_obligation: закрывает конкретный leg + создаёт OUT movement
--    (+ если это последняя obligation на сделке — закрывает всю сделку)
create or replace function public.settle_obligation(
  p_obligation_id uuid, p_account_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ob record;
  v_balance numeric;
  v_mov_group uuid := gen_random_uuid();
  v_user_id uuid := auth.uid();
  v_leg_idx smallint;
  v_now timestamptz := now();
begin
  select * into v_ob from public.obligations where id = p_obligation_id;
  if v_ob is null then raise exception 'Obligation not found'; end if;
  if v_ob.status <> 'open' then raise exception 'Obligation not open'; end if;

  select coalesce(b.total, 0) - coalesce(b.reserved, 0) into v_balance
    from public.v_account_balances b where b.account_id = p_account_id;
  if v_balance < v_ob.amount then
    raise exception 'Insufficient balance: % available, % required', v_balance, v_ob.amount;
  end if;

  select leg_index into v_leg_idx from public.deal_legs where id = v_ob.deal_leg_id;

  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, source_leg_index, movement_group_id, note, created_by
  ) values (
    p_account_id, v_ob.amount, 'out', v_ob.currency_code, false,
    'settle', v_ob.deal_id::text, v_leg_idx, v_mov_group,
    'Settle obligation ' || v_ob.id, v_user_id
  );

  update public.obligations set
    status = 'closed',
    closed_at = v_now,
    closed_by = v_user_id,
    closed_movement_group = v_mov_group
  where id = p_obligation_id;

  -- Помечаем конкретный leg completed
  update public.deal_legs
  set actual_amount = amount,
      completed_at = v_now
  where id = v_ob.deal_leg_id;

  -- Если нет открытых obligations на сделке → закрываем deal + все оставшиеся legs + IN
  if v_ob.deal_id is not null
     and not exists (
       select 1 from public.obligations
       where deal_id = v_ob.deal_id and status = 'open'
     ) then
    update public.deals set
      status = 'completed',
      confirmed_at = v_now,
      in_actual_amount = case when in_completed_at is null then amount_in else in_actual_amount end,
      in_completed_at = coalesce(in_completed_at, v_now)
    where id = v_ob.deal_id and status = 'pending';

    update public.deal_legs
    set actual_amount = case when completed_at is null then amount else actual_amount end,
        completed_at = coalesce(completed_at, v_now)
    where deal_id = v_ob.deal_id;
  end if;
end;
$$;

-- 8. confirm_deal_leg: crypto OUT confirmed — leg → completed, остальная сделка
--    остаётся в своём статусе (возможно other legs ещё pending)
create or replace function public.confirm_deal_leg(p_deal_id bigint, p_leg_index smallint)
returns void language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now();
begin
  update public.deal_legs
  set send_status = 'confirmed',
      actual_amount = amount,
      completed_at = v_now
  where deal_id = p_deal_id and leg_index = p_leg_index;

  update public.account_movements set reserved = false
    where source_ref_id = p_deal_id::text
      and source_leg_index = p_leg_index
      and source_kind = 'exchange_out';
end;
$$;

-- 9. try_match_incoming: на матч — IN completed, остальные legs (не crypto pending) completed
create or replace function public.try_match_incoming(p_blockchain_tx_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_tx record;
  v_deal record;
  v_tolerance numeric := 0.005;
  v_window interval := '2 hours';
  v_now timestamptz := now();
begin
  select bt.*, a.currency_code, a.network_id as acc_network, a.office_id as acc_office
    into v_tx
    from public.blockchain_txs bt
    join public.accounts a on a.id = bt.our_account_id
    where bt.id = p_blockchain_tx_id;
  if v_tx is null or v_tx.matched_deal_id is not null then return null; end if;

  select d.* into v_deal
    from public.deals d
    where d.status in ('checking','pending')
      and d.in_account_id = v_tx.our_account_id
      and d.currency_in = v_tx.currency_code
      and abs(d.amount_in - v_tx.amount) <= greatest(d.amount_in * v_tolerance, 0.01)
      and d.created_at between (v_tx.block_timestamp - v_window) and (v_tx.block_timestamp + v_window)
    order by d.created_at asc
    limit 1;
  if v_deal is null then return null; end if;

  update public.deals set
    status = 'completed',
    confirmed_at = v_now,
    confirmed_tx_hash = v_tx.tx_hash,
    in_actual_amount = v_deal.amount_in,
    in_completed_at = v_now
  where id = v_deal.id;

  update public.account_movements set reserved = false
    where source_ref_id = v_deal.id::text;

  update public.blockchain_txs set matched_deal_id = v_deal.id where id = v_tx.id;

  -- Закрываем все legs, которые не ждут отдельного crypto-подтверждения
  update public.deal_legs
  set actual_amount = case when completed_at is null then amount else actual_amount end,
      completed_at = coalesce(completed_at, v_now)
  where deal_id = v_deal.id
    and (send_status is null or send_status = 'confirmed');

  if v_deal.client_id is not null and v_tx.from_address is not null then
    perform public.upsert_client_wallet(v_deal.client_id, v_tx.from_address, v_tx.network_id);
  end if;

  return v_deal.id;
end;
$$;

-- Done.
