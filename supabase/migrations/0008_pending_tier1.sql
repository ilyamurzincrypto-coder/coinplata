-- ============================================================================
-- CoinPlata · 0008_pending_tier1.sql
-- Три фичи для работы с pending-сделками:
--   1. User-set planned_at — кассир может выбрать дату "ожидается к"
--   2. Partial settle — obligations закрываются частично через paid_amount
--   3. Deferred pay-in (they_owe) — клиент заплатит позже, мы уже выдали
-- ============================================================================

-- 1. Трекаем частично закрытые obligations
alter table public.obligations
  add column if not exists paid_amount numeric(20,8) not null default 0;

create index if not exists obligations_paid_idx
  on public.obligations(paid_amount)
  where status = 'open';

-- ============================================================================
-- 2. create_deal: добавляем p_planned_at + p_deferred_in
-- ============================================================================

drop function if exists public.create_deal(
  uuid, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text, jsonb
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
  p_deferred_in boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public
as $func$
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
  v_plan_at timestamptz;
  v_leg_planned numeric;
  v_leg_is_crypto_send boolean;
  v_leg_has_address boolean;
  v_leg_fully_paid boolean;
begin
  select id, min_fee_usd, fee_percent into v_office
    from public.offices where id = p_office_id;
  if not found then raise exception 'Office % not found', p_office_id; end if;

  v_plan_at := coalesce(p_planned_at, v_now);

  -- Margin (USD)
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

  -- Deferred in (they_owe) или user-set planned_at → принудительно pending
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

  -- IN side: если deferred_in → создаём they_owe obligation (клиент нам должен)
  --          иначе → обычный exchange_in movement
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

  -- Legs — не меняется в логике, но planned_at теперь из p_planned_at
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
  timestamptz, boolean
) to authenticated;

-- ============================================================================
-- 3. Partial settle — settle_obligation_partial
-- ============================================================================
-- Отличие от settle_obligation (полного):
--   - принимает p_amount (сколько платим сейчас)
--   - проверяет что amount <= (obligation.amount - paid_amount)
--   - создаёт OUT movement на p_amount (не на полную сумму)
--   - увеличивает obligation.paid_amount
--   - закрывает только если paid_amount достиг amount
--   - в deal_legs actual_amount увеличивается на p_amount, completed_at
--     ставится только когда actual_amount >= planned
-- ============================================================================

create or replace function public.settle_obligation_partial(
  p_obligation_id uuid, p_account_id uuid, p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_ob record;
  v_balance numeric;
  v_mov_group uuid := gen_random_uuid();
  v_user_id uuid := auth.uid();
  v_leg_idx smallint;
  v_leg_planned numeric;
  v_leg_actual numeric;
  v_now timestamptz := now();
  v_remaining numeric;
  v_fully_paid boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be > 0';
  end if;

  select * into v_ob from public.obligations where id = p_obligation_id;
  if v_ob is null then raise exception 'Obligation not found'; end if;
  if v_ob.status <> 'open' then raise exception 'Obligation not open'; end if;
  if v_ob.direction <> 'we_owe' then
    raise exception 'settle_obligation_partial is only for we_owe (use receive_payment for they_owe)';
  end if;

  v_remaining := v_ob.amount - v_ob.paid_amount;
  if p_amount > v_remaining then
    raise exception 'amount % exceeds remaining %', p_amount, v_remaining;
  end if;

  select coalesce(b.total, 0) - coalesce(b.reserved, 0) into v_balance
    from public.v_account_balances b where b.account_id = p_account_id;
  if v_balance is null then v_balance := 0; end if;
  if v_balance < p_amount then
    raise exception 'Insufficient balance: % available, % required', v_balance, p_amount;
  end if;

  v_fully_paid := (v_ob.paid_amount + p_amount) >= v_ob.amount;

  -- Movement OUT
  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, source_leg_index, movement_group_id, note, created_by
  )
  select
    p_account_id, p_amount, 'out', v_ob.currency_code, false,
    'settle', v_ob.deal_id::text,
    (select leg_index from public.deal_legs where id = v_ob.deal_leg_id),
    v_mov_group,
    case when v_fully_paid
      then 'Settle obligation ' || v_ob.id || ' (final)'
      else 'Settle obligation ' || v_ob.id || ' (partial ' || p_amount || ')'
    end,
    v_user_id;

  -- Обновляем obligation
  update public.obligations set
    paid_amount = paid_amount + p_amount,
    status = case when v_fully_paid then 'closed' else status end,
    closed_at = case when v_fully_paid then v_now else closed_at end,
    closed_by = case when v_fully_paid then v_user_id else closed_by end,
    closed_movement_group = case when v_fully_paid then v_mov_group else closed_movement_group end
  where id = p_obligation_id;

  -- Обновляем leg: actual_amount += p_amount, completed_at при full close
  if v_ob.deal_leg_id is not null then
    select leg_index, amount, actual_amount into v_leg_idx, v_leg_planned, v_leg_actual
      from public.deal_legs where id = v_ob.deal_leg_id;
    update public.deal_legs set
      actual_amount = actual_amount + p_amount,
      completed_at = case
        when actual_amount + p_amount >= amount then coalesce(completed_at, v_now)
        else completed_at
      end
    where id = v_ob.deal_leg_id;
  end if;

  -- Если это был финальный платёж и у сделки нет других open obligations → close deal
  if v_fully_paid and v_ob.deal_id is not null
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
$func$;

grant execute on function public.settle_obligation_partial(uuid, uuid, numeric) to authenticated;

-- ============================================================================
-- 4. receive_payment — для they_owe (клиент принёс деньги которые был должен)
-- ============================================================================

create or replace function public.receive_payment(
  p_obligation_id uuid, p_account_id uuid, p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_ob record;
  v_acc record;
  v_mov_group uuid := gen_random_uuid();
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_remaining numeric;
  v_fully_paid boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be > 0';
  end if;

  select * into v_ob from public.obligations where id = p_obligation_id;
  if v_ob is null then raise exception 'Obligation not found'; end if;
  if v_ob.status <> 'open' then raise exception 'Obligation not open'; end if;
  if v_ob.direction <> 'they_owe' then
    raise exception 'receive_payment is only for they_owe (use settle_obligation_partial for we_owe)';
  end if;

  select * into v_acc from public.accounts where id = p_account_id;
  if v_acc is null then raise exception 'Account not found'; end if;
  if v_acc.currency_code <> v_ob.currency_code then
    raise exception 'Account currency % does not match obligation currency %',
      v_acc.currency_code, v_ob.currency_code;
  end if;

  v_remaining := v_ob.amount - v_ob.paid_amount;
  if p_amount > v_remaining then
    raise exception 'amount % exceeds remaining %', p_amount, v_remaining;
  end if;

  v_fully_paid := (v_ob.paid_amount + p_amount) >= v_ob.amount;

  -- Movement IN — клиент принёс
  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, movement_group_id, note, created_by
  ) values (
    p_account_id, p_amount, 'in', v_ob.currency_code, false,
    'exchange_in', v_ob.deal_id::text, v_mov_group,
    case when v_fully_paid
      then 'Received deferred payment for deal #' || v_ob.deal_id || ' (final)'
      else 'Received partial payment ' || p_amount || ' for deal #' || v_ob.deal_id
    end,
    v_user_id
  );

  update public.obligations set
    paid_amount = paid_amount + p_amount,
    status = case when v_fully_paid then 'closed' else status end,
    closed_at = case when v_fully_paid then v_now else closed_at end,
    closed_by = case when v_fully_paid then v_user_id else closed_by end,
    closed_movement_group = case when v_fully_paid then v_mov_group else closed_movement_group end
  where id = p_obligation_id;

  -- Обновляем deal IN side: in_actual_amount += p_amount
  if v_ob.deal_id is not null then
    update public.deals set
      in_actual_amount = in_actual_amount + p_amount,
      in_completed_at = case
        when in_actual_amount + p_amount >= amount_in then coalesce(in_completed_at, v_now)
        else in_completed_at
      end
    where id = v_ob.deal_id;

    -- Если deal не имеет больше open obligations → close
    if v_fully_paid
       and not exists (
         select 1 from public.obligations
         where deal_id = v_ob.deal_id and status = 'open'
       ) then
      update public.deals set
        status = 'completed',
        confirmed_at = v_now
      where id = v_ob.deal_id and status = 'pending';
    end if;
  end if;
end;
$func$;

grant execute on function public.receive_payment(uuid, uuid, numeric) to authenticated;
