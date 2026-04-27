-- ============================================================================
-- CoinPlata · 0044_skip_min_fee.sql
--
-- Новый параметр p_skip_min_fee (default false) в create_deal и update_deal:
-- когда true — комиссия = max(margin_usd, 0) без применения min_fee_usd
-- офиса. Используется галочкой "применить min fee" в ExchangeForm — менеджер
-- может уступить минимальный сбор клиенту по договорённости.
--
-- Сигнатура меняется (15-й параметр) — нельзя через CREATE OR REPLACE,
-- нужно DROP + CREATE. Существующие grants пересоздаём явно.
-- ============================================================================

drop function if exists public.create_deal(
  uuid, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text, jsonb,
  timestamptz, boolean
);

create function public.create_deal(
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
  p_legs jsonb,
  p_planned_at timestamptz default null,
  p_deferred_in boolean default false,
  p_skip_min_fee boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
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
  v_plan_at timestamptz;
  v_leg_planned numeric;
  v_leg_is_crypto_send boolean;
  v_leg_has_address boolean;
  v_leg_fully_paid boolean;
begin
  if v_caller_role = 'manager' and p_manager_id <> v_uid then
    raise exception 'Manager can only create deals as themselves'
      using errcode = '42501';
  end if;
  if p_manager_id is null then
    raise exception 'p_manager_id required' using errcode = '22000';
  end if;

  select id, min_fee_usd, fee_percent into v_office
    from public.offices where id = p_office_id;
  if not found then raise exception 'Office % not found', p_office_id; end if;

  v_plan_at := coalesce(p_planned_at, v_now);

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

  -- KEY: учитываем p_skip_min_fee. Когда true → fee = max(margin, 0),
  -- min cap офиса не применяется. min_fee_applied=false (cap не задействована).
  if p_skip_min_fee then
    v_fee_usd := greatest(v_margin_usd, 0);
    v_min_fee_applied := false;
  else
    v_fee_usd := greatest(v_margin_usd, v_office.min_fee_usd);
    v_min_fee_applied := v_margin_usd < v_office.min_fee_usd;
  end if;

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
  if p_deferred_in or (p_planned_at is not null and p_planned_at > v_now) then
    v_final_status := 'pending';
  end if;
  v_is_reserved := v_final_status in ('pending','checking');

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
    v_plan_at,
    case
      when p_deferred_in then 0
      when v_final_status = 'completed' and p_in_account_id is not null then p_amount_in
      else 0
    end,
    case
      when p_deferred_in then null
      when v_final_status = 'completed' and p_in_account_id is not null then v_now
      else null
    end
  ) returning id into v_deal_id;

  if p_deferred_in then
    insert into public.obligations (
      office_id, deal_id, client_id, currency_code, amount,
      direction, note, created_by
    ) values (
      p_office_id, v_deal_id, p_client_id, p_currency_in, p_amount_in,
      'they_owe',
      'Deferred pay-in: client will pay ' || p_currency_in || ' later',
      p_manager_id
    );
    v_has_obligation := true;
  elsif p_in_account_id is not null then
    insert into public.account_movements (
      account_id, amount, direction, currency_code, reserved,
      source_kind, source_ref_id, movement_group_id, note, created_by
    ) values (
      p_in_account_id, p_amount_in, 'in', p_currency_in, v_is_reserved,
      'exchange_in', v_deal_id::text, v_mov_group,
      'Deal #' || v_deal_id, p_manager_id
    );
  end if;

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

    v_available := null;
    if (v_leg->>'account_id') is not null and (v_leg->>'account_id') <> '' then
      select
        coalesce(b.total, 0) - coalesce(b.reserved, 0) -
        coalesce((
          select sum(amount - paid_amount) from public.obligations ob
          where ob.office_id = a.office_id and ob.currency_code = a.currency_code
            and ob.direction = 'we_owe' and ob.status = 'open'
        ), 0)
      into v_available
      from public.accounts a
      left join public.v_account_balances b on b.account_id = a.id
      where a.id = (v_leg->>'account_id')::uuid;
      if v_available is null then v_available := 0; end if;
    end if;

    v_leg_fully_paid :=
      v_available is null or v_available >= v_leg_planned
      and not v_leg_is_crypto_send
      and not v_is_reserved;

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
      v_plan_at,
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

  if v_has_obligation and v_final_status = 'completed' then
    update public.deals set status = 'pending' where id = v_deal_id;
  end if;

  return v_deal_id;
end;
$func$;

grant execute on function public.create_deal(
  uuid, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text, jsonb,
  timestamptz, boolean, boolean
) to authenticated;

-- ============================================================================
-- update_deal — те же изменения
-- ============================================================================

drop function if exists public.update_deal(
  bigint, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text, jsonb,
  timestamptz, boolean
);

create function public.update_deal(
  p_deal_id bigint,
  p_office_id uuid,
  p_client_id uuid,
  p_client_nickname text,
  p_currency_in text,
  p_amount_in numeric,
  p_in_account_id uuid,
  p_in_tx_hash text,
  p_referral boolean,
  p_comment text,
  p_status text,
  p_legs jsonb,
  p_planned_at timestamptz default null,
  p_deferred_in boolean default false,
  p_skip_min_fee boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
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
  v_manager_id uuid;
  v_now timestamptz := now();
  v_plan_at timestamptz;
  v_leg_planned numeric;
  v_leg_is_crypto_send boolean;
  v_leg_has_address boolean;
  v_leg_fully_paid boolean;
begin
  select manager_id into v_manager_id from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  if v_caller_role = 'manager' and v_manager_id <> v_uid then
    raise exception 'Manager can only update own deals' using errcode = '42501';
  end if;

  select id, min_fee_usd, fee_percent into v_office
    from public.offices where id = p_office_id;
  if not found then raise exception 'Office % not found', p_office_id; end if;

  v_plan_at := coalesce(p_planned_at, v_now);

  delete from public.account_movements where source_ref_id = p_deal_id::text;
  update public.obligations
    set status = 'cancelled', closed_at = v_now, closed_by = v_manager_id
    where deal_id = p_deal_id and status = 'open';
  delete from public.deal_legs where deal_id = p_deal_id;

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

  if p_skip_min_fee then
    v_fee_usd := greatest(v_margin_usd, 0);
    v_min_fee_applied := false;
  else
    v_fee_usd := greatest(v_margin_usd, v_office.min_fee_usd);
    v_min_fee_applied := v_margin_usd < v_office.min_fee_usd;
  end if;

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

  v_final_status := coalesce(p_status, 'completed');
  if p_deferred_in or (p_planned_at is not null and p_planned_at > v_now) then
    v_final_status := 'pending';
  end if;
  v_is_reserved := v_final_status in ('pending','checking');

  update public.deals set
    office_id = p_office_id,
    client_id = p_client_id,
    client_nickname = p_client_nickname,
    currency_in = p_currency_in,
    amount_in = p_amount_in,
    in_account_id = p_in_account_id,
    in_tx_hash = p_in_tx_hash,
    fee_usd = v_fee_usd,
    profit_usd = v_profit_usd,
    min_fee_applied = v_min_fee_applied,
    referral = p_referral,
    comment = p_comment,
    status = v_final_status,
    in_planned_at = v_plan_at,
    in_actual_amount = case
      when p_deferred_in then 0
      when v_final_status = 'completed' and p_in_account_id is not null then p_amount_in
      else 0
    end,
    in_completed_at = case
      when p_deferred_in then null
      when v_final_status = 'completed' and p_in_account_id is not null then v_now
      else null
    end
  where id = p_deal_id;

  if p_deferred_in then
    insert into public.obligations (
      office_id, deal_id, client_id, currency_code, amount,
      direction, note, created_by
    ) values (
      p_office_id, p_deal_id, p_client_id, p_currency_in, p_amount_in,
      'they_owe',
      'Deferred pay-in (edited): client will pay ' || p_currency_in || ' later',
      v_manager_id
    );
    v_has_obligation := true;
  elsif p_in_account_id is not null then
    insert into public.account_movements (
      account_id, amount, direction, currency_code, reserved,
      source_kind, source_ref_id, movement_group_id, note, created_by
    ) values (
      p_in_account_id, p_amount_in, 'in', p_currency_in, v_is_reserved,
      'exchange_in', p_deal_id::text, v_mov_group,
      'Deal #' || p_deal_id || ' (edited)', v_manager_id
    );
  end if;

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

    v_available := null;
    if (v_leg->>'account_id') is not null and (v_leg->>'account_id') <> '' then
      select
        coalesce(b.total, 0) - coalesce(b.reserved, 0) -
        coalesce((
          select sum(amount - paid_amount) from public.obligations ob
          where ob.office_id = a.office_id and ob.currency_code = a.currency_code
            and ob.direction = 'we_owe' and ob.status = 'open'
        ), 0)
      into v_available
      from public.accounts a
      left join public.v_account_balances b on b.account_id = a.id
      where a.id = (v_leg->>'account_id')::uuid;
      if v_available is null then v_available := 0; end if;
    end if;

    v_leg_fully_paid :=
      v_available is null or v_available >= v_leg_planned
      and not v_leg_is_crypto_send
      and not v_is_reserved;

    insert into public.deal_legs (
      deal_id, leg_index, currency, amount, rate,
      account_id, address, network_id, send_status, is_internal,
      planned_at, actual_amount, completed_at
    ) values (
      p_deal_id, v_idx,
      v_leg->>'currency', v_leg_planned, (v_leg->>'rate')::numeric,
      nullif(v_leg->>'account_id','')::uuid,
      nullif(v_leg->>'address',''),
      nullif(v_leg->>'network_id',''),
      case when v_leg_is_crypto_send then 'pending_send' else null end,
      v_is_internal,
      v_plan_at,
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
          'exchange_out', p_deal_id::text, v_idx, v_mov_group,
          'Deal #' || p_deal_id || ' · leg ' || (v_idx+1) || ' (edited)', v_manager_id
        );
      else
        insert into public.obligations (
          office_id, deal_id, deal_leg_id, client_id,
          currency_code, amount, direction, note, created_by
        ) values (
          p_office_id, p_deal_id, v_leg_id, p_client_id,
          v_leg->>'currency', v_leg_planned, 'we_owe',
          'Auto-created (edited): insufficient balance at deal submit',
          v_manager_id
        );
        v_has_obligation := true;
      end if;
    end if;

    v_idx := v_idx + 1;
  end loop;

  if v_has_obligation and v_final_status = 'completed' then
    update public.deals set status = 'pending' where id = p_deal_id;
  end if;
end;
$func$;

grant execute on function public.update_deal(
  bigint, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text, jsonb,
  timestamptz, boolean, boolean
) to authenticated;

-- Проверка
select n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) as signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_deal','update_deal');
