-- ============================================================================
-- CoinPlata · 0081_create_deal_with_kind_and_payments.sql
--
-- ФАЗА 8 OTC re-design: рефактор create_deal/update_deal под новую модель
-- in_kind/out_kind + multi-payment.
--
-- НОВЫЕ ПАРАМЕТРЫ (все опциональные с default — backward compat):
--   p_in_kind         text default null
--                     ∈ {ours_now | ours_later | partner_now | partner_later}
--                     Если null → derive из старых p_in_account_id/p_in_partner_account_id/p_deferred_in.
--   p_in_payments     jsonb default '[]'
--                     Список фактических платежей по IN-стороне:
--                       [{amount, kind, account_id?, partner_account_id?, paid_at?, note?}]
--                     Если пусто И in_kind ∈ {ours_now, partner_now}:
--                       создаётся ровно одна полная оплата (legacy).
--                     Если пусто И in_kind ∈ {*_later}:
--                       платежей нет → только obligation.
--
-- В каждой leg внутри p_legs:
--   leg.out_kind      аналогично, ∈ 4 значения. Default — derive.
--   leg.payments      аналогично p_in_payments, для OUT-стороны этой leg.
--
-- 16 КОМБИНАЦИЙ IN×OUT поддерживаются:
--   ours_now × ours_now      — обычный обмен (legacy A)
--   ours_now × partner_now   — мы получили, партнёр выдал клиенту (legacy B)
--   partner_now × ours_now   — партнёр получил от клиента, мы выдали (legacy C)
--   partner_now × partner_now — чистый брокеридж (legacy D)
--   ours_later × *           — клиент должен нам, потом …
--   partner_later × *        — партнёр должен нам, потом …
--   * × ours_later           — мы должны клиенту
--   * × partner_later        — партнёр должен клиенту
--
-- ОБЯЗАТЕЛЬСТВА (obligations):
--   in_kind = 'ours_later'     → debtor=client, creditor=us
--   in_kind = 'partner_later'  → debtor=partner, creditor=us
--   out_kind = 'ours_later'    → debtor=us, creditor=client
--   out_kind = 'partner_later' → debtor=partner, creditor=client (внешний долг!)
--
-- ВАЖНО: при partner_later OUT — обязательство ВНЕШНЕЕ (партнёр↔клиент).
-- Нас финансово не касается; учитывается только для трекинга и истории.
--
-- profit_usd = fee_usd + commission_usd − referral_bonus
-- (margin рассчитывается как раньше через эффективные курсы;
--  для брокера при kind='broker' margin = 0, остаётся только commission)
-- ============================================================================

-- ============================================================================
-- 1. drop старых сигнатур
-- ============================================================================

drop function if exists public.create_deal(
  uuid, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text,
  jsonb, timestamptz, boolean, boolean, uuid, numeric
);

drop function if exists public.update_deal(
  bigint, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text,
  jsonb, timestamptz, boolean, boolean, uuid, numeric
);

-- ============================================================================
-- 2. create_deal — новая версия
-- ============================================================================

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
  p_legs jsonb,
  p_planned_at timestamptz default null,
  p_deferred_in boolean default false,
  p_skip_min_fee boolean default false,
  p_in_partner_account_id uuid default null,
  p_commission_usd numeric default 0,
  p_in_kind text default null,
  p_in_payments jsonb default '[]'::jsonb,
  p_kind text default null
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
  v_now timestamptz := now();
  v_plan_at timestamptz;
  v_in_kind text;
  v_kind text;
  v_commission_usd numeric;
  v_in_partner_id uuid;
  v_in_partner_curr text;
  v_leg_partner_id uuid;
  v_leg_partner_curr text;
  v_leg_out_kind text;
  v_leg_account_id uuid;
  v_leg_partner_account_id uuid;
  v_leg_id uuid;
  v_leg_planned numeric;
  v_leg_currency text;
  v_leg_rate numeric;
  v_leg_address text;
  v_leg_network_id text;
  v_leg_is_crypto_send boolean;
  v_leg_is_internal boolean;
  v_leg_office uuid;
  v_pay jsonb;
  v_pay_amount numeric;
  v_pay_kind text;
  v_pay_account_id uuid;
  v_pay_partner_account_id uuid;
  v_pay_at timestamptz;
  v_pay_note text;
  v_pay_movement_id uuid;
  v_in_paid_total numeric := 0;
  v_in_last_paid_at timestamptz;
  v_leg_paid_total numeric;
  v_leg_last_paid_at timestamptz;
  v_final_status text;
  v_snapshot_id uuid;
  v_all_legs_complete boolean := true;
begin
  if v_caller_role = 'manager' and p_manager_id <> v_uid then
    raise exception 'Manager can only create deals as themselves' using errcode = '42501';
  end if;
  if p_manager_id is null then
    raise exception 'p_manager_id required' using errcode = '22000';
  end if;

  -- ─── derive in_kind ─────────────────────────────────────────────────
  v_in_kind := coalesce(p_in_kind,
    case
      when p_deferred_in then 'ours_later'
      when p_in_partner_account_id is not null then 'partner_now'
      when p_in_account_id is not null then 'ours_now'
      else 'ours_later'
    end);

  if v_in_kind not in ('ours_now','ours_later','partner_now','partner_later') then
    raise exception 'invalid in_kind: %', v_in_kind using errcode = '22000';
  end if;

  -- in_account_id/in_partner_account_id согласованы с in_kind (CHECK на deals)
  if v_in_kind = 'ours_now' and p_in_account_id is null then
    -- если есть платежи — попробовать derive из первого
    if jsonb_array_length(coalesce(p_in_payments, '[]'::jsonb)) > 0 then
      p_in_account_id := nullif(p_in_payments->0->>'account_id','')::uuid;
    end if;
    if p_in_account_id is null then
      raise exception 'in_kind=ours_now требует in_account_id или хотя бы один payment с account_id' using errcode = '22000';
    end if;
  end if;
  if v_in_kind = 'partner_now' and p_in_partner_account_id is null then
    if jsonb_array_length(coalesce(p_in_payments, '[]'::jsonb)) > 0 then
      p_in_partner_account_id := nullif(p_in_payments->0->>'partner_account_id','')::uuid;
    end if;
    if p_in_partner_account_id is null then
      raise exception 'in_kind=partner_now требует in_partner_account_id или хотя бы один payment' using errcode = '22000';
    end if;
  end if;
  if v_in_kind in ('ours_later','partner_later') then
    p_in_account_id := null;
    p_in_partner_account_id := null;
  end if;

  -- проверка валюты партнёрского счёта
  if p_in_partner_account_id is not null then
    select partner_id, currency_code into v_in_partner_id, v_in_partner_curr
      from public.partner_accounts where id = p_in_partner_account_id and active;
    if not found then
      raise exception 'Partner account % not found or inactive', p_in_partner_account_id;
    end if;
    if v_in_partner_curr <> p_currency_in then
      raise exception 'IN partner_account currency (%) <> p_currency_in (%)',
        v_in_partner_curr, p_currency_in;
    end if;
  end if;

  -- ─── derive deal.kind ───────────────────────────────────────────────
  v_kind := coalesce(p_kind,
    case
      when v_in_kind in ('partner_now','partner_later') then 'otc'
      when exists (
        select 1 from jsonb_array_elements(p_legs) leg
        where (leg->>'out_kind') in ('partner_now','partner_later')
           or (leg->>'partner_account_id') is not null
      ) then 'otc'
      else 'regular'
    end);

  v_commission_usd := coalesce(p_commission_usd, 0);

  select id, min_fee_usd, fee_percent into v_office
    from public.offices where id = p_office_id;
  if not found then raise exception 'Office % not found', p_office_id; end if;

  v_plan_at := coalesce(p_planned_at, v_now);

  -- ─── margin расчёт ─────────────────────────────────────────────────
  for v_leg in select * from jsonb_array_elements(p_legs) loop
    v_market_rate := public.effective_rate(p_office_id, p_currency_in, v_leg->>'currency');
    if v_market_rate is null or v_market_rate <= 0 then continue; end if;
    v_margin_in_curIn :=
      ((v_leg->>'amount')::numeric / nullif((v_leg->>'rate')::numeric, 0)) -
      ((v_leg->>'amount')::numeric / v_market_rate);
    if p_currency_in = 'USD' then
      v_margin_usd := v_margin_usd + v_margin_in_curIn;
    else
      v_to_usd := public.effective_rate(p_office_id, p_currency_in, 'USD');
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
      v_to_usd := public.effective_rate(p_office_id, p_currency_in, 'USD');
      v_amt_in_usd := p_amount_in * coalesce(v_to_usd, 0);
    end if;
    v_referral_bonus := round(v_amt_in_usd * v_referral_pct / 100, 2);
  end if;

  v_profit_usd := v_fee_usd + v_commission_usd - v_referral_bonus;

  select id into v_snapshot_id from public.rate_snapshots order by created_at desc limit 1;

  -- ─── создаём deal-row (статус определим в конце, пока pending) ──────
  insert into public.deals (
    office_id, manager_id, client_id, client_nickname,
    currency_in, amount_in, in_account_id, in_partner_account_id, in_tx_hash,
    fee_usd, profit_usd, commission_usd, min_fee_applied, referral, comment, status,
    rate_snapshot_id,
    in_planned_at, in_actual_amount, in_completed_at,
    kind, in_kind
  ) values (
    p_office_id, p_manager_id, p_client_id, p_client_nickname,
    p_currency_in, p_amount_in, p_in_account_id, p_in_partner_account_id, p_in_tx_hash,
    v_fee_usd, v_profit_usd, v_commission_usd, v_min_fee_applied, p_referral, p_comment, 'pending',
    v_snapshot_id,
    v_plan_at, 0, null,
    v_kind, v_in_kind
  ) returning id into v_deal_id;

  -- ─── IN side: payments + obligation ────────────────────────────────
  if v_in_kind in ('ours_now','partner_now') then
    -- если payments пуст — создаём одну полную оплату (legacy)
    if jsonb_array_length(coalesce(p_in_payments, '[]'::jsonb)) = 0 then
      p_in_payments := jsonb_build_array(jsonb_build_object(
        'amount', p_amount_in,
        'kind', v_in_kind,
        'account_id', p_in_account_id,
        'partner_account_id', p_in_partner_account_id,
        'paid_at', v_now
      ));
    end if;

    for v_pay in select * from jsonb_array_elements(p_in_payments) loop
      v_pay_amount := (v_pay->>'amount')::numeric;
      v_pay_kind := coalesce(v_pay->>'kind', v_in_kind);
      v_pay_account_id := nullif(v_pay->>'account_id','')::uuid;
      v_pay_partner_account_id := nullif(v_pay->>'partner_account_id','')::uuid;
      v_pay_at := coalesce((v_pay->>'paid_at')::timestamptz, v_now);
      v_pay_note := nullif(v_pay->>'note','');

      if v_pay_amount is null or v_pay_amount <= 0 then
        raise exception 'Invalid IN payment amount: %', v_pay->>'amount';
      end if;

      if v_pay_kind = 'ours_now' then
        if v_pay_account_id is null then
          v_pay_account_id := p_in_account_id;
        end if;
        if v_pay_account_id is null then
          raise exception 'IN payment kind=ours_now требует account_id';
        end if;
        insert into public.account_movements (
          account_id, amount, direction, currency_code, reserved,
          source_kind, source_ref_id, movement_group_id, note, created_by, created_at
        ) values (
          v_pay_account_id, v_pay_amount, 'in', p_currency_in, false,
          'exchange_in', v_deal_id::text, v_mov_group,
          coalesce(v_pay_note, 'Deal #' || v_deal_id), p_manager_id, v_pay_at
        ) returning id into v_pay_movement_id;
      elsif v_pay_kind = 'partner_now' then
        if v_pay_partner_account_id is null then
          v_pay_partner_account_id := p_in_partner_account_id;
        end if;
        if v_pay_partner_account_id is null then
          raise exception 'IN payment kind=partner_now требует partner_account_id';
        end if;
        insert into public.partner_account_movements (
          partner_account_id, amount, direction, currency_code,
          source_kind, source_ref_id, movement_group_id, note, created_by, created_at
        ) values (
          v_pay_partner_account_id, v_pay_amount, 'in', p_currency_in,
          'otc_in', v_deal_id::text, v_mov_group,
          coalesce(v_pay_note, 'Deal #' || v_deal_id || ' · partner received'),
          p_manager_id, v_pay_at
        ) returning id into v_pay_movement_id;
      else
        raise exception 'Unsupported IN payment kind: % (только ours_now/partner_now)', v_pay_kind;
      end if;

      insert into public.deal_in_payments (
        deal_id, amount, currency_code, paid_at, kind,
        account_id, partner_account_id, movement_id, note, created_by, created_at
      ) values (
        v_deal_id, v_pay_amount, p_currency_in, v_pay_at, v_pay_kind,
        case when v_pay_kind='ours_now' then v_pay_account_id else null end,
        case when v_pay_kind='partner_now' then v_pay_partner_account_id else null end,
        v_pay_movement_id, v_pay_note, p_manager_id, v_pay_at
      );

      v_in_paid_total := v_in_paid_total + v_pay_amount;
      if v_in_last_paid_at is null or v_pay_at > v_in_last_paid_at then
        v_in_last_paid_at := v_pay_at;
      end if;
    end loop;

    -- Если оплачено не до конца — остаток превращается в obligation.
    -- Триггер _sync_obligation_direction заполнит debtor_kind/creditor_kind
    -- из direction + client_id/partner_id (см. 0079).
    if v_in_paid_total + 0.00000001 < p_amount_in then
      insert into public.obligations (
        office_id, deal_id, client_id, partner_id, partner_account_id,
        currency_code, amount, direction, note, created_by
      ) values (
        p_office_id, v_deal_id,
        case when v_in_kind = 'ours_now' then p_client_id else null end,
        case when v_in_kind = 'partner_now' then v_in_partner_id else null end,
        case when v_in_kind = 'partner_now' then p_in_partner_account_id else null end,
        p_currency_in, p_amount_in - v_in_paid_total,
        'they_owe',
        'IN partial: остаток ' || (p_amount_in - v_in_paid_total) || ' ' || p_currency_in,
        p_manager_id
      );
    end if;
  elsif v_in_kind = 'ours_later' then
    -- Клиент должен нам всю сумму.
    insert into public.obligations (
      office_id, deal_id, client_id,
      currency_code, amount, direction, note, created_by
    ) values (
      p_office_id, v_deal_id, p_client_id,
      p_currency_in, p_amount_in, 'they_owe',
      'Deferred IN: client will pay later',
      p_manager_id
    );
  elsif v_in_kind = 'partner_later' then
    -- Партнёр должен нам. partner_id может быть null (только counterparty_name).
    -- Если null — оставляем debtor_kind=null, триггер не сможет derivit'ь.
    if p_in_partner_account_id is not null then
      raise exception 'partner_later не должен иметь in_partner_account_id (deferred)' using errcode = '22000';
    end if;
    insert into public.obligations (
      office_id, deal_id,
      currency_code, amount, direction, note, created_by,
      counterparty_name
    ) values (
      p_office_id, v_deal_id,
      p_currency_in, p_amount_in, 'they_owe',
      'Deferred IN: partner will deliver later',
      p_manager_id,
      p_client_nickname
    );
  end if;

  -- ─── OUT side (legs) ────────────────────────────────────────────────
  v_idx := 0;
  for v_leg in select * from jsonb_array_elements(p_legs) loop
    v_leg_currency := v_leg->>'currency';
    v_leg_planned := (v_leg->>'amount')::numeric;
    v_leg_rate := (v_leg->>'rate')::numeric;
    v_leg_address := nullif(v_leg->>'address','');
    v_leg_network_id := nullif(v_leg->>'network_id','');
    v_leg_account_id := nullif(v_leg->>'account_id','')::uuid;
    v_leg_partner_account_id := nullif(v_leg->>'partner_account_id','')::uuid;

    -- derive out_kind
    v_leg_out_kind := coalesce(nullif(v_leg->>'out_kind',''),
      case
        when v_leg_partner_account_id is not null then 'partner_now'
        when v_leg_account_id is not null then 'ours_now'
        else 'ours_later'
      end);

    if v_leg_out_kind not in ('ours_now','ours_later','partner_now','partner_later') then
      raise exception 'Leg %: invalid out_kind=%', v_idx, v_leg_out_kind;
    end if;

    -- consistency: now-режимы требуют account, later-режимы — оба null
    if v_leg_out_kind in ('ours_later','partner_later') then
      v_leg_account_id := null;
      v_leg_partner_account_id := null;
    end if;

    -- payments[] для leg может derivit'ся из leg.payments или быть пустым
    v_leg_paid_total := 0;
    v_leg_last_paid_at := null;

    -- Валидация partner_account валюты
    if v_leg_partner_account_id is not null then
      select partner_id, currency_code into v_leg_partner_id, v_leg_partner_curr
        from public.partner_accounts where id = v_leg_partner_account_id and active;
      if not found then
        raise exception 'Partner account % not found/inactive', v_leg_partner_account_id;
      end if;
      if v_leg_partner_curr <> v_leg_currency then
        raise exception 'Leg %: partner_account currency (%) <> leg.currency (%)',
          v_idx, v_leg_partner_curr, v_leg_currency;
      end if;
    end if;

    if v_leg_account_id is not null then
      select office_id into v_leg_office from public.accounts where id = v_leg_account_id;
      v_leg_is_internal := v_leg_office is not null and v_leg_office <> p_office_id;
    else
      v_leg_is_internal := false;
    end if;
    v_leg_is_crypto_send := v_leg_address is not null and v_leg_network_id is not null;

    -- INSERT leg (actual_amount/completed_at заполним после payments)
    insert into public.deal_legs (
      deal_id, leg_index, currency, amount, rate,
      account_id, partner_account_id, address, network_id, send_status, is_internal,
      planned_at, actual_amount, completed_at, out_kind
    ) values (
      v_deal_id, v_idx,
      v_leg_currency, v_leg_planned, v_leg_rate,
      v_leg_account_id, v_leg_partner_account_id,
      v_leg_address, v_leg_network_id,
      case when v_leg_is_crypto_send then 'pending_send' else null end,
      v_leg_is_internal,
      v_plan_at, 0, null, v_leg_out_kind
    ) returning id into v_leg_id;

    -- Process leg.payments[]
    if v_leg_out_kind in ('ours_now','partner_now') then
      -- если payments пуст — создаём одну полную выдачу (legacy)
      if jsonb_array_length(coalesce(v_leg->'payments', '[]'::jsonb)) = 0 then
        v_leg := jsonb_set(v_leg, '{payments}',
          jsonb_build_array(jsonb_build_object(
            'amount', v_leg_planned,
            'kind', v_leg_out_kind,
            'account_id', v_leg_account_id,
            'partner_account_id', v_leg_partner_account_id,
            'paid_at', v_now
          ))
        );
      end if;

      for v_pay in select * from jsonb_array_elements(v_leg->'payments') loop
        v_pay_amount := (v_pay->>'amount')::numeric;
        v_pay_kind := coalesce(v_pay->>'kind', v_leg_out_kind);
        v_pay_account_id := nullif(v_pay->>'account_id','')::uuid;
        v_pay_partner_account_id := nullif(v_pay->>'partner_account_id','')::uuid;
        v_pay_at := coalesce((v_pay->>'paid_at')::timestamptz, v_now);
        v_pay_note := nullif(v_pay->>'note','');

        if v_pay_amount is null or v_pay_amount <= 0 then
          raise exception 'Leg %: invalid payment amount', v_idx;
        end if;

        if v_pay_kind = 'ours_now' then
          if v_pay_account_id is null then v_pay_account_id := v_leg_account_id; end if;
          if v_pay_account_id is null then
            raise exception 'Leg %: payment kind=ours_now требует account_id', v_idx;
          end if;
          insert into public.account_movements (
            account_id, amount, direction, currency_code, reserved,
            source_kind, source_ref_id, source_leg_index, movement_group_id,
            note, created_by, created_at
          ) values (
            v_pay_account_id, v_pay_amount, 'out', v_leg_currency,
            v_leg_is_crypto_send,
            'exchange_out', v_deal_id::text, v_idx, v_mov_group,
            coalesce(v_pay_note, 'Deal #' || v_deal_id || ' · leg ' || (v_idx+1)),
            p_manager_id, v_pay_at
          ) returning id into v_pay_movement_id;
        elsif v_pay_kind = 'partner_now' then
          if v_pay_partner_account_id is null then
            v_pay_partner_account_id := v_leg_partner_account_id;
          end if;
          if v_pay_partner_account_id is null then
            raise exception 'Leg %: payment kind=partner_now требует partner_account_id', v_idx;
          end if;
          insert into public.partner_account_movements (
            partner_account_id, amount, direction, currency_code,
            source_kind, source_ref_id, source_leg_index, movement_group_id,
            note, created_by, created_at
          ) values (
            v_pay_partner_account_id, v_pay_amount, 'out', v_leg_currency,
            'otc_out', v_deal_id::text, v_idx, v_mov_group,
            coalesce(v_pay_note, 'Deal #' || v_deal_id || ' · leg ' || (v_idx+1) || ' · partner paid'),
            p_manager_id, v_pay_at
          ) returning id into v_pay_movement_id;
        else
          raise exception 'Leg %: unsupported payment kind=%', v_idx, v_pay_kind;
        end if;

        insert into public.deal_leg_payments (
          deal_leg_id, amount, currency_code, paid_at, kind,
          account_id, partner_account_id, movement_id, note, created_by, created_at
        ) values (
          v_leg_id, v_pay_amount, v_leg_currency, v_pay_at, v_pay_kind,
          case when v_pay_kind='ours_now' then v_pay_account_id else null end,
          case when v_pay_kind='partner_now' then v_pay_partner_account_id else null end,
          v_pay_movement_id, v_pay_note, p_manager_id, v_pay_at
        );

        v_leg_paid_total := v_leg_paid_total + v_pay_amount;
        if v_leg_last_paid_at is null or v_pay_at > v_leg_last_paid_at then
          v_leg_last_paid_at := v_pay_at;
        end if;
      end loop;

      -- Если не до конца — obligation на остаток
      if v_leg_paid_total + 0.00000001 < v_leg_planned then
        insert into public.obligations (
          office_id, deal_id, deal_leg_id, client_id,
          partner_id, partner_account_id,
          currency_code, amount, direction, note, created_by
        ) values (
          p_office_id, v_deal_id, v_leg_id,
          case when v_leg_out_kind = 'ours_now' then p_client_id else null end,
          case when v_leg_out_kind = 'partner_now' then v_leg_partner_id else null end,
          case when v_leg_out_kind = 'partner_now' then v_leg_partner_account_id else null end,
          v_leg_currency, v_leg_planned - v_leg_paid_total,
          'we_owe',
          'OUT partial leg ' || (v_idx+1) || ': остаток',
          p_manager_id
        );
      end if;
    elsif v_leg_out_kind = 'ours_later' then
      -- Мы должны клиенту.
      insert into public.obligations (
        office_id, deal_id, deal_leg_id, client_id,
        currency_code, amount, direction, note, created_by
      ) values (
        p_office_id, v_deal_id, v_leg_id, p_client_id,
        v_leg_currency, v_leg_planned, 'we_owe',
        'Deferred OUT leg ' || (v_idx+1) || ': мы выдадим клиенту позже',
        p_manager_id
      );
    elsif v_leg_out_kind = 'partner_later' then
      -- Партнёр должен клиенту (внешний долг). partner_id может быть null.
      -- Триггер заполнит debtor_kind/creditor_kind только если ВСЕ нужные id есть;
      -- иначе они останутся null (CHECK это допускает).
      v_leg_partner_id := null;
      v_leg_partner_account_id := null;

      insert into public.obligations (
        office_id, deal_id, deal_leg_id, client_id,
        partner_id, counterparty_name,
        currency_code, amount, direction, note, created_by
      ) values (
        p_office_id, v_deal_id, v_leg_id, p_client_id,
        v_leg_partner_id, p_client_nickname,
        v_leg_currency, v_leg_planned, 'we_owe',
        'External: partner promised to deliver to client (leg ' || (v_idx+1) || ')',
        p_manager_id
      );
    end if;

    -- update leg actual/completed
    update public.deal_legs set
      actual_amount = v_leg_paid_total,
      completed_at = case when v_leg_paid_total + 0.00000001 >= v_leg_planned then v_leg_last_paid_at else null end
      where id = v_leg_id;

    if v_leg_paid_total + 0.00000001 < v_leg_planned then
      v_all_legs_complete := false;
    end if;

    v_idx := v_idx + 1;
  end loop;

  -- ─── обновить deal статус и in_actual ──────────────────────────────
  v_final_status := case
    when v_in_paid_total + 0.00000001 >= p_amount_in
         and v_all_legs_complete
         and v_in_kind in ('ours_now','partner_now')
      then 'completed'
    else 'pending'
  end;

  update public.deals set
    in_actual_amount = v_in_paid_total,
    in_completed_at = case
      when v_in_paid_total + 0.00000001 >= p_amount_in then v_in_last_paid_at
      else null
    end,
    status = v_final_status
  where id = v_deal_id;

  return v_deal_id;
end;
$func$;

-- ============================================================================
-- 3. update_deal — symmetric refactor
-- ============================================================================

create or replace function public.update_deal(
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
  p_skip_min_fee boolean default false,
  p_in_partner_account_id uuid default null,
  p_commission_usd numeric default 0,
  p_in_kind text default null,
  p_in_payments jsonb default '[]'::jsonb,
  p_kind text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_manager_id uuid;
  v_now timestamptz := now();
begin
  select manager_id into v_manager_id from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;
  if v_caller_role = 'manager' and v_manager_id <> v_uid then
    raise exception 'Manager can only update own deals' using errcode = '42501';
  end if;

  -- Cleanup всё что было привязано к сделке.
  -- deal_legs cascade'ит deal_leg_payments. Но account_movements/partner_account_movements
  -- надо чистить вручную (они source_ref_id=deal_id::text).
  delete from public.deal_in_payments where deal_id = p_deal_id;
  delete from public.account_movements where source_ref_id = p_deal_id::text;
  delete from public.partner_account_movements where source_ref_id = p_deal_id::text;
  update public.obligations
    set status = 'cancelled', closed_at = v_now, closed_by = v_uid
    where deal_id = p_deal_id and status = 'open';
  delete from public.deal_legs where deal_id = p_deal_id;
  -- ↑ cascade → удалит deal_leg_payments

  -- Удаляем deal-row, потом пересоздаём через create_deal.
  -- Но id сохраняем. Реализуем как "drop deal-row + insert с тем же id"
  -- слишком сложно (FK на obligations/payments). Поэтому:
  -- update полей deal вручную + create_deal-style логика inline.
  --
  -- Чтобы не дублировать огромный код create_deal — выполним через
  -- temp re-insert: сохраним id, удалим запись, вызовем create_deal,
  -- затем переназначим id обратно. Слишком хакерски.
  --
  -- Простое решение: оставляем deal-row, обновляем все поля, и
  -- inline-выполняем ту же логику что create_deal для payments/legs.
  -- Дублирование кода неизбежно.

  perform public._update_deal_impl(
    p_deal_id, p_office_id, p_client_id, p_client_nickname,
    p_currency_in, p_amount_in, p_in_account_id, p_in_tx_hash,
    p_referral, p_comment, p_status, p_legs, p_planned_at,
    p_deferred_in, p_skip_min_fee, p_in_partner_account_id,
    p_commission_usd, p_in_kind, p_in_payments, p_kind, v_manager_id
  );
end;
$func$;

-- ============================================================================
-- 4. _update_deal_impl — внутренний helper, выполняет ре-применение
-- ============================================================================

create or replace function public._update_deal_impl(
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
  p_planned_at timestamptz,
  p_deferred_in boolean,
  p_skip_min_fee boolean,
  p_in_partner_account_id uuid,
  p_commission_usd numeric,
  p_in_kind text,
  p_in_payments jsonb,
  p_kind text,
  p_manager_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
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
  v_now timestamptz := now();
  v_plan_at timestamptz;
  v_in_kind text;
  v_kind text;
  v_commission_usd numeric;
  v_in_partner_id uuid;
  v_in_partner_curr text;
  v_leg_partner_id uuid;
  v_leg_partner_curr text;
  v_leg_out_kind text;
  v_leg_account_id uuid;
  v_leg_partner_account_id uuid;
  v_leg_id uuid;
  v_leg_planned numeric;
  v_leg_currency text;
  v_leg_rate numeric;
  v_leg_address text;
  v_leg_network_id text;
  v_leg_is_crypto_send boolean;
  v_leg_is_internal boolean;
  v_leg_office uuid;
  v_pay jsonb;
  v_pay_amount numeric;
  v_pay_kind text;
  v_pay_account_id uuid;
  v_pay_partner_account_id uuid;
  v_pay_at timestamptz;
  v_pay_note text;
  v_pay_movement_id uuid;
  v_in_paid_total numeric := 0;
  v_in_last_paid_at timestamptz;
  v_leg_paid_total numeric;
  v_leg_last_paid_at timestamptz;
  v_final_status text;
  v_all_legs_complete boolean := true;
begin
  v_in_kind := coalesce(p_in_kind,
    case
      when p_deferred_in then 'ours_later'
      when p_in_partner_account_id is not null then 'partner_now'
      when p_in_account_id is not null then 'ours_now'
      else 'ours_later'
    end);

  if v_in_kind = 'ours_now' and p_in_account_id is null
     and jsonb_array_length(coalesce(p_in_payments,'[]'::jsonb)) > 0 then
    p_in_account_id := nullif(p_in_payments->0->>'account_id','')::uuid;
  end if;
  if v_in_kind = 'partner_now' and p_in_partner_account_id is null
     and jsonb_array_length(coalesce(p_in_payments,'[]'::jsonb)) > 0 then
    p_in_partner_account_id := nullif(p_in_payments->0->>'partner_account_id','')::uuid;
  end if;
  if v_in_kind in ('ours_later','partner_later') then
    p_in_account_id := null;
    p_in_partner_account_id := null;
  end if;

  if p_in_partner_account_id is not null then
    select partner_id, currency_code into v_in_partner_id, v_in_partner_curr
      from public.partner_accounts where id = p_in_partner_account_id and active;
    if not found then
      raise exception 'Partner account % not found/inactive', p_in_partner_account_id;
    end if;
    if v_in_partner_curr <> p_currency_in then
      raise exception 'IN partner_account currency (%) <> p_currency_in (%)',
        v_in_partner_curr, p_currency_in;
    end if;
  end if;

  v_kind := coalesce(p_kind,
    case
      when v_in_kind in ('partner_now','partner_later') then 'otc'
      when exists (
        select 1 from jsonb_array_elements(p_legs) leg
        where (leg->>'out_kind') in ('partner_now','partner_later')
           or (leg->>'partner_account_id') is not null
      ) then 'otc'
      else 'regular'
    end);

  v_commission_usd := coalesce(p_commission_usd, 0);

  select id, min_fee_usd, fee_percent into v_office
    from public.offices where id = p_office_id;
  if not found then raise exception 'Office % not found', p_office_id; end if;

  v_plan_at := coalesce(p_planned_at, v_now);

  for v_leg in select * from jsonb_array_elements(p_legs) loop
    v_market_rate := public.effective_rate(p_office_id, p_currency_in, v_leg->>'currency');
    if v_market_rate is null or v_market_rate <= 0 then continue; end if;
    v_margin_in_curIn :=
      ((v_leg->>'amount')::numeric / nullif((v_leg->>'rate')::numeric, 0)) -
      ((v_leg->>'amount')::numeric / v_market_rate);
    if p_currency_in = 'USD' then
      v_margin_usd := v_margin_usd + v_margin_in_curIn;
    else
      v_to_usd := public.effective_rate(p_office_id, p_currency_in, 'USD');
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
      v_to_usd := public.effective_rate(p_office_id, p_currency_in, 'USD');
      v_amt_in_usd := p_amount_in * coalesce(v_to_usd, 0);
    end if;
    v_referral_bonus := round(v_amt_in_usd * v_referral_pct / 100, 2);
  end if;
  v_profit_usd := v_fee_usd + v_commission_usd - v_referral_bonus;

  update public.deals set
    office_id = p_office_id,
    client_id = p_client_id,
    client_nickname = p_client_nickname,
    currency_in = p_currency_in,
    amount_in = p_amount_in,
    in_account_id = p_in_account_id,
    in_partner_account_id = p_in_partner_account_id,
    in_tx_hash = p_in_tx_hash,
    fee_usd = v_fee_usd,
    profit_usd = v_profit_usd,
    commission_usd = v_commission_usd,
    min_fee_applied = v_min_fee_applied,
    referral = p_referral,
    comment = p_comment,
    in_planned_at = v_plan_at,
    in_actual_amount = 0,
    in_completed_at = null,
    kind = v_kind,
    in_kind = v_in_kind,
    status = 'pending'
  where id = p_deal_id;

  -- IN side
  if v_in_kind in ('ours_now','partner_now') then
    if jsonb_array_length(coalesce(p_in_payments,'[]'::jsonb)) = 0 then
      p_in_payments := jsonb_build_array(jsonb_build_object(
        'amount', p_amount_in, 'kind', v_in_kind,
        'account_id', p_in_account_id,
        'partner_account_id', p_in_partner_account_id,
        'paid_at', v_now
      ));
    end if;

    for v_pay in select * from jsonb_array_elements(p_in_payments) loop
      v_pay_amount := (v_pay->>'amount')::numeric;
      v_pay_kind := coalesce(v_pay->>'kind', v_in_kind);
      v_pay_account_id := nullif(v_pay->>'account_id','')::uuid;
      v_pay_partner_account_id := nullif(v_pay->>'partner_account_id','')::uuid;
      v_pay_at := coalesce((v_pay->>'paid_at')::timestamptz, v_now);
      v_pay_note := nullif(v_pay->>'note','');
      if v_pay_amount is null or v_pay_amount <= 0 then
        raise exception 'Invalid IN payment amount';
      end if;

      if v_pay_kind = 'ours_now' then
        if v_pay_account_id is null then v_pay_account_id := p_in_account_id; end if;
        if v_pay_account_id is null then raise exception 'IN payment ours_now: account_id required'; end if;
        insert into public.account_movements (
          account_id, amount, direction, currency_code, reserved,
          source_kind, source_ref_id, movement_group_id, note, created_by, created_at
        ) values (
          v_pay_account_id, v_pay_amount, 'in', p_currency_in, false,
          'exchange_in', p_deal_id::text, v_mov_group,
          coalesce(v_pay_note, 'Deal #' || p_deal_id || ' (edited)'),
          p_manager_id, v_pay_at
        ) returning id into v_pay_movement_id;
      elsif v_pay_kind = 'partner_now' then
        if v_pay_partner_account_id is null then v_pay_partner_account_id := p_in_partner_account_id; end if;
        if v_pay_partner_account_id is null then raise exception 'IN payment partner_now: partner_account_id required'; end if;
        insert into public.partner_account_movements (
          partner_account_id, amount, direction, currency_code,
          source_kind, source_ref_id, movement_group_id, note, created_by, created_at
        ) values (
          v_pay_partner_account_id, v_pay_amount, 'in', p_currency_in,
          'otc_in', p_deal_id::text, v_mov_group,
          coalesce(v_pay_note, 'Deal #' || p_deal_id || ' (edited) · partner received'),
          p_manager_id, v_pay_at
        ) returning id into v_pay_movement_id;
      else
        raise exception 'Unsupported IN payment kind: %', v_pay_kind;
      end if;

      insert into public.deal_in_payments (
        deal_id, amount, currency_code, paid_at, kind,
        account_id, partner_account_id, movement_id, note, created_by, created_at
      ) values (
        p_deal_id, v_pay_amount, p_currency_in, v_pay_at, v_pay_kind,
        case when v_pay_kind='ours_now' then v_pay_account_id else null end,
        case when v_pay_kind='partner_now' then v_pay_partner_account_id else null end,
        v_pay_movement_id, v_pay_note, p_manager_id, v_pay_at
      );

      v_in_paid_total := v_in_paid_total + v_pay_amount;
      if v_in_last_paid_at is null or v_pay_at > v_in_last_paid_at then
        v_in_last_paid_at := v_pay_at;
      end if;
    end loop;

    if v_in_paid_total + 0.00000001 < p_amount_in then
      insert into public.obligations (
        office_id, deal_id, client_id, partner_id, partner_account_id,
        currency_code, amount, direction, note, created_by
      ) values (
        p_office_id, p_deal_id,
        case when v_in_kind = 'ours_now' then p_client_id else null end,
        case when v_in_kind = 'partner_now' then v_in_partner_id else null end,
        case when v_in_kind = 'partner_now' then p_in_partner_account_id else null end,
        p_currency_in, p_amount_in - v_in_paid_total,
        'they_owe',
        'IN partial (edited): остаток',
        p_manager_id
      );
    end if;
  elsif v_in_kind = 'ours_later' then
    insert into public.obligations (
      office_id, deal_id, client_id,
      currency_code, amount, direction, note, created_by
    ) values (
      p_office_id, p_deal_id, p_client_id,
      p_currency_in, p_amount_in, 'they_owe',
      'Deferred IN (edited): client will pay later',
      p_manager_id
    );
  elsif v_in_kind = 'partner_later' then
    insert into public.obligations (
      office_id, deal_id, currency_code, amount, direction,
      note, created_by, counterparty_name
    ) values (
      p_office_id, p_deal_id, p_currency_in, p_amount_in, 'they_owe',
      'Deferred IN (edited): partner will deliver later',
      p_manager_id, p_client_nickname
    );
  end if;

  -- OUT legs
  v_idx := 0;
  for v_leg in select * from jsonb_array_elements(p_legs) loop
    v_leg_currency := v_leg->>'currency';
    v_leg_planned := (v_leg->>'amount')::numeric;
    v_leg_rate := (v_leg->>'rate')::numeric;
    v_leg_address := nullif(v_leg->>'address','');
    v_leg_network_id := nullif(v_leg->>'network_id','');
    v_leg_account_id := nullif(v_leg->>'account_id','')::uuid;
    v_leg_partner_account_id := nullif(v_leg->>'partner_account_id','')::uuid;

    v_leg_out_kind := coalesce(nullif(v_leg->>'out_kind',''),
      case
        when v_leg_partner_account_id is not null then 'partner_now'
        when v_leg_account_id is not null then 'ours_now'
        else 'ours_later'
      end);

    if v_leg_out_kind in ('ours_later','partner_later') then
      v_leg_account_id := null;
      v_leg_partner_account_id := null;
    end if;

    v_leg_paid_total := 0;
    v_leg_last_paid_at := null;

    if v_leg_partner_account_id is not null then
      select partner_id, currency_code into v_leg_partner_id, v_leg_partner_curr
        from public.partner_accounts where id = v_leg_partner_account_id and active;
      if not found then raise exception 'Leg partner_account not found'; end if;
      if v_leg_partner_curr <> v_leg_currency then
        raise exception 'Leg %: partner_account currency mismatch', v_idx;
      end if;
    end if;

    if v_leg_account_id is not null then
      select office_id into v_leg_office from public.accounts where id = v_leg_account_id;
      v_leg_is_internal := v_leg_office is not null and v_leg_office <> p_office_id;
    else
      v_leg_is_internal := false;
    end if;
    v_leg_is_crypto_send := v_leg_address is not null and v_leg_network_id is not null;

    insert into public.deal_legs (
      deal_id, leg_index, currency, amount, rate,
      account_id, partner_account_id, address, network_id, send_status, is_internal,
      planned_at, actual_amount, completed_at, out_kind
    ) values (
      p_deal_id, v_idx, v_leg_currency, v_leg_planned, v_leg_rate,
      v_leg_account_id, v_leg_partner_account_id,
      v_leg_address, v_leg_network_id,
      case when v_leg_is_crypto_send then 'pending_send' else null end,
      v_leg_is_internal, v_plan_at, 0, null, v_leg_out_kind
    ) returning id into v_leg_id;

    if v_leg_out_kind in ('ours_now','partner_now') then
      if jsonb_array_length(coalesce(v_leg->'payments','[]'::jsonb)) = 0 then
        v_leg := jsonb_set(v_leg, '{payments}', jsonb_build_array(jsonb_build_object(
          'amount', v_leg_planned, 'kind', v_leg_out_kind,
          'account_id', v_leg_account_id,
          'partner_account_id', v_leg_partner_account_id,
          'paid_at', v_now
        )));
      end if;

      for v_pay in select * from jsonb_array_elements(v_leg->'payments') loop
        v_pay_amount := (v_pay->>'amount')::numeric;
        v_pay_kind := coalesce(v_pay->>'kind', v_leg_out_kind);
        v_pay_account_id := nullif(v_pay->>'account_id','')::uuid;
        v_pay_partner_account_id := nullif(v_pay->>'partner_account_id','')::uuid;
        v_pay_at := coalesce((v_pay->>'paid_at')::timestamptz, v_now);
        v_pay_note := nullif(v_pay->>'note','');

        if v_pay_kind = 'ours_now' then
          if v_pay_account_id is null then v_pay_account_id := v_leg_account_id; end if;
          insert into public.account_movements (
            account_id, amount, direction, currency_code, reserved,
            source_kind, source_ref_id, source_leg_index, movement_group_id,
            note, created_by, created_at
          ) values (
            v_pay_account_id, v_pay_amount, 'out', v_leg_currency,
            v_leg_is_crypto_send,
            'exchange_out', p_deal_id::text, v_idx, v_mov_group,
            coalesce(v_pay_note, 'Deal #' || p_deal_id || ' · leg ' || (v_idx+1) || ' (edited)'),
            p_manager_id, v_pay_at
          ) returning id into v_pay_movement_id;
        elsif v_pay_kind = 'partner_now' then
          if v_pay_partner_account_id is null then v_pay_partner_account_id := v_leg_partner_account_id; end if;
          insert into public.partner_account_movements (
            partner_account_id, amount, direction, currency_code,
            source_kind, source_ref_id, source_leg_index, movement_group_id,
            note, created_by, created_at
          ) values (
            v_pay_partner_account_id, v_pay_amount, 'out', v_leg_currency,
            'otc_out', p_deal_id::text, v_idx, v_mov_group,
            coalesce(v_pay_note, 'Deal #' || p_deal_id || ' (edited) · partner paid'),
            p_manager_id, v_pay_at
          ) returning id into v_pay_movement_id;
        else
          raise exception 'Unsupported leg payment kind: %', v_pay_kind;
        end if;

        insert into public.deal_leg_payments (
          deal_leg_id, amount, currency_code, paid_at, kind,
          account_id, partner_account_id, movement_id, note, created_by, created_at
        ) values (
          v_leg_id, v_pay_amount, v_leg_currency, v_pay_at, v_pay_kind,
          case when v_pay_kind='ours_now' then v_pay_account_id else null end,
          case when v_pay_kind='partner_now' then v_pay_partner_account_id else null end,
          v_pay_movement_id, v_pay_note, p_manager_id, v_pay_at
        );

        v_leg_paid_total := v_leg_paid_total + v_pay_amount;
        if v_leg_last_paid_at is null or v_pay_at > v_leg_last_paid_at then
          v_leg_last_paid_at := v_pay_at;
        end if;
      end loop;

      if v_leg_paid_total + 0.00000001 < v_leg_planned then
        insert into public.obligations (
          office_id, deal_id, deal_leg_id, client_id,
          partner_id, partner_account_id,
          currency_code, amount, direction, note, created_by
        ) values (
          p_office_id, p_deal_id, v_leg_id,
          case when v_leg_out_kind = 'ours_now' then p_client_id else null end,
          case when v_leg_out_kind = 'partner_now' then v_leg_partner_id else null end,
          case when v_leg_out_kind = 'partner_now' then v_leg_partner_account_id else null end,
          v_leg_currency, v_leg_planned - v_leg_paid_total,
          'we_owe',
          'OUT partial (edited)',
          p_manager_id
        );
      end if;
    elsif v_leg_out_kind = 'ours_later' then
      insert into public.obligations (
        office_id, deal_id, deal_leg_id, client_id,
        currency_code, amount, direction, note, created_by
      ) values (
        p_office_id, p_deal_id, v_leg_id, p_client_id,
        v_leg_currency, v_leg_planned, 'we_owe',
        'Deferred OUT (edited)',
        p_manager_id
      );
    elsif v_leg_out_kind = 'partner_later' then
      v_leg_partner_id := null;
      insert into public.obligations (
        office_id, deal_id, deal_leg_id, client_id,
        partner_id, counterparty_name,
        currency_code, amount, direction, note, created_by
      ) values (
        p_office_id, p_deal_id, v_leg_id, p_client_id,
        v_leg_partner_id, p_client_nickname,
        v_leg_currency, v_leg_planned, 'we_owe',
        'External (edited): partner→client',
        p_manager_id
      );
    end if;

    update public.deal_legs set
      actual_amount = v_leg_paid_total,
      completed_at = case when v_leg_paid_total + 0.00000001 >= v_leg_planned then v_leg_last_paid_at else null end
      where id = v_leg_id;

    if v_leg_paid_total + 0.00000001 < v_leg_planned then
      v_all_legs_complete := false;
    end if;

    v_idx := v_idx + 1;
  end loop;

  v_final_status := case
    when v_in_paid_total + 0.00000001 >= p_amount_in
         and v_all_legs_complete
         and v_in_kind in ('ours_now','partner_now')
      then 'completed'
    else 'pending'
  end;

  update public.deals set
    in_actual_amount = v_in_paid_total,
    in_completed_at = case
      when v_in_paid_total + 0.00000001 >= p_amount_in then v_in_last_paid_at
      else null
    end,
    status = v_final_status
  where id = p_deal_id;
end;
$func$;

-- ============================================================================
-- 5. Helper RPCs для добавления платежей пост-фактум (Wizard «отметить оплачено»)
-- ============================================================================

create or replace function public.add_deal_in_payment(
  p_deal_id bigint,
  p_amount numeric,
  p_kind text,
  p_account_id uuid default null,
  p_partner_account_id uuid default null,
  p_paid_at timestamptz default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_deal record;
  v_movement_id uuid;
  v_payment_id uuid;
  v_now timestamptz := coalesce(p_paid_at, now());
  v_paid_total numeric;
begin
  select id, office_id, currency_in, amount_in, in_kind, manager_id, client_id
    into v_deal from public.deals where id = p_deal_id;
  if not found then raise exception 'Deal % not found', p_deal_id; end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be > 0';
  end if;
  if p_kind not in ('ours_now','partner_now') then
    raise exception 'kind must be ours_now or partner_now';
  end if;

  if p_kind = 'ours_now' then
    if p_account_id is null then raise exception 'account_id required for ours_now'; end if;
    insert into public.account_movements (
      account_id, amount, direction, currency_code, reserved,
      source_kind, source_ref_id, note, created_by, created_at
    ) values (
      p_account_id, p_amount, 'in', v_deal.currency_in, false,
      'exchange_in', p_deal_id::text,
      coalesce(p_note, 'Deal #' || p_deal_id || ' · payment'),
      v_uid, v_now
    ) returning id into v_movement_id;
  else
    if p_partner_account_id is null then raise exception 'partner_account_id required for partner_now'; end if;
    insert into public.partner_account_movements (
      partner_account_id, amount, direction, currency_code,
      source_kind, source_ref_id, note, created_by, created_at
    ) values (
      p_partner_account_id, p_amount, 'in', v_deal.currency_in,
      'otc_in', p_deal_id::text,
      coalesce(p_note, 'Deal #' || p_deal_id || ' · partner payment'),
      v_uid, v_now
    ) returning id into v_movement_id;
  end if;

  insert into public.deal_in_payments (
    deal_id, amount, currency_code, paid_at, kind,
    account_id, partner_account_id, movement_id, note, created_by, created_at
  ) values (
    p_deal_id, p_amount, v_deal.currency_in, v_now, p_kind,
    case when p_kind='ours_now' then p_account_id else null end,
    case when p_kind='partner_now' then p_partner_account_id else null end,
    v_movement_id, p_note, v_uid, v_now
  ) returning id into v_payment_id;

  -- update deal aggregate
  select coalesce(sum(amount),0) into v_paid_total
    from public.deal_in_payments where deal_id = p_deal_id;
  update public.deals set
    in_actual_amount = v_paid_total,
    in_completed_at = case when v_paid_total + 0.00000001 >= v_deal.amount_in then v_now else null end
    where id = p_deal_id;

  -- close obligation если IN полностью покрыт
  if v_paid_total + 0.00000001 >= v_deal.amount_in then
    update public.obligations set
      paid_amount = amount,
      status = 'closed',
      closed_at = v_now,
      closed_by = v_uid
    where deal_id = p_deal_id and deal_leg_id is null
      and direction = 'they_owe' and status = 'open';
  else
    update public.obligations set paid_amount = v_paid_total
      where deal_id = p_deal_id and deal_leg_id is null
        and direction = 'they_owe' and status = 'open';
  end if;

  -- если все стороны completed — deal.status = completed
  perform public._refresh_deal_status(p_deal_id);

  return v_payment_id;
end;
$func$;

create or replace function public.add_deal_leg_payment(
  p_deal_leg_id uuid,
  p_amount numeric,
  p_kind text,
  p_account_id uuid default null,
  p_partner_account_id uuid default null,
  p_paid_at timestamptz default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_leg record;
  v_movement_id uuid;
  v_payment_id uuid;
  v_now timestamptz := coalesce(p_paid_at, now());
  v_paid_total numeric;
begin
  select id, deal_id, leg_index, currency, amount into v_leg
    from public.deal_legs where id = p_deal_leg_id;
  if not found then raise exception 'Leg % not found', p_deal_leg_id; end if;

  if p_amount is null or p_amount <= 0 then raise exception 'amount must be > 0'; end if;
  if p_kind not in ('ours_now','partner_now') then
    raise exception 'kind must be ours_now or partner_now';
  end if;

  if p_kind = 'ours_now' then
    if p_account_id is null then raise exception 'account_id required'; end if;
    insert into public.account_movements (
      account_id, amount, direction, currency_code, reserved,
      source_kind, source_ref_id, source_leg_index, note, created_by, created_at
    ) values (
      p_account_id, p_amount, 'out', v_leg.currency, false,
      'exchange_out', v_leg.deal_id::text, v_leg.leg_index,
      coalesce(p_note, 'Deal #' || v_leg.deal_id || ' · leg ' || (v_leg.leg_index+1) || ' · payment'),
      v_uid, v_now
    ) returning id into v_movement_id;
  else
    if p_partner_account_id is null then raise exception 'partner_account_id required'; end if;
    insert into public.partner_account_movements (
      partner_account_id, amount, direction, currency_code,
      source_kind, source_ref_id, source_leg_index, note, created_by, created_at
    ) values (
      p_partner_account_id, p_amount, 'out', v_leg.currency,
      'otc_out', v_leg.deal_id::text, v_leg.leg_index,
      coalesce(p_note, 'Deal #' || v_leg.deal_id || ' · partner paid leg ' || (v_leg.leg_index+1)),
      v_uid, v_now
    ) returning id into v_movement_id;
  end if;

  insert into public.deal_leg_payments (
    deal_leg_id, amount, currency_code, paid_at, kind,
    account_id, partner_account_id, movement_id, note, created_by, created_at
  ) values (
    p_deal_leg_id, p_amount, v_leg.currency, v_now, p_kind,
    case when p_kind='ours_now' then p_account_id else null end,
    case when p_kind='partner_now' then p_partner_account_id else null end,
    v_movement_id, p_note, v_uid, v_now
  ) returning id into v_payment_id;

  select coalesce(sum(amount),0) into v_paid_total
    from public.deal_leg_payments where deal_leg_id = p_deal_leg_id;
  update public.deal_legs set
    actual_amount = v_paid_total,
    completed_at = case when v_paid_total + 0.00000001 >= v_leg.amount then v_now else null end
    where id = p_deal_leg_id;

  if v_paid_total + 0.00000001 >= v_leg.amount then
    update public.obligations set
      paid_amount = amount,
      status = 'closed',
      closed_at = v_now,
      closed_by = v_uid
    where deal_leg_id = p_deal_leg_id
      and direction = 'we_owe' and status = 'open';
  else
    update public.obligations set paid_amount = v_paid_total
      where deal_leg_id = p_deal_leg_id
        and direction = 'we_owe' and status = 'open';
  end if;

  perform public._refresh_deal_status(v_leg.deal_id);

  return v_payment_id;
end;
$func$;

-- helper: пересчитать deal.status исходя из всех сторон
create or replace function public._refresh_deal_status(p_deal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_in_done boolean;
  v_legs_done boolean;
  v_in_kind text;
begin
  select in_kind into v_in_kind from public.deals where id = p_deal_id;

  -- IN считается «done» если *_now полностью закрыт; *_later никогда не done
  -- (пока не превратится в *_now через add_payment).
  v_in_done := exists (
    select 1 from public.deals d
    join public.v_deal_in_status s on s.deal_id = d.id
    where d.id = p_deal_id
      and d.in_kind in ('ours_now','partner_now')
      and s.in_status = 'completed'
  );

  v_legs_done := not exists (
    select 1 from public.deal_legs l
    join public.v_deal_leg_status s on s.deal_leg_id = l.id
    where l.deal_id = p_deal_id
      and (l.out_kind in ('ours_later','partner_later') or s.leg_status <> 'completed')
  );

  update public.deals set
    status = case when v_in_done and v_legs_done then 'completed' else 'pending' end
    where id = p_deal_id;
end;
$func$;

-- ============================================================================
-- 6. Grants
-- ============================================================================

grant execute on function public.create_deal(
  uuid, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text,
  jsonb, timestamptz, boolean, boolean, uuid, numeric, text, jsonb, text
) to authenticated;

grant execute on function public.update_deal(
  bigint, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text,
  jsonb, timestamptz, boolean, boolean, uuid, numeric, text, jsonb, text
) to authenticated;

grant execute on function public.add_deal_in_payment(
  bigint, numeric, text, uuid, uuid, timestamptz, text
) to authenticated;

grant execute on function public.add_deal_leg_payment(
  uuid, numeric, text, uuid, uuid, timestamptz, text
) to authenticated;

-- ============================================================================
-- 7. Verify
-- ============================================================================

select n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_deal','update_deal','add_deal_in_payment','add_deal_leg_payment','_refresh_deal_status','_update_deal_impl')
order by proname, signature;
