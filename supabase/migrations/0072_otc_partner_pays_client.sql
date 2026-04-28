-- ============================================================================
-- CoinPlata · 0072_otc_partner_pays_client.sql
--
-- Расширение OTC: 2 варианта расчёта с контрагентом:
--   1. STANDARD — партнёр зачисляет нам (current behavior).
--      Создаются OUT (от нас) + IN (от партнёра) движения.
--   2. PARTNER_PAYS_CLIENT — партнёр выдаёт клиенту напрямую.
--      Создаётся ТОЛЬКО OUT (от нас партнёру). IN movement не создаётся
--      (USDT партнёра не появляется на нашем счёте — он сразу пошёл клиенту).
--      В deal.comment добавляется маркер "[partner-pays-client]".
--      Main deal в этом случае может не иметь outputs к клиенту вовсе
--      (выдача произошла вне нашей системы) — юзер сам решит.
--
-- p_to_account_id и p_to_amount остаются required для учёта эфф. курса —
-- это виртуальная "получаемая" сумма, влияющая на отчётность по сделке.
-- ============================================================================

drop function if exists public.create_otc_deal(uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz);

create or replace function public.create_otc_deal(
  p_office_id uuid,
  p_from_account_id uuid,
  p_from_amount numeric,
  p_to_account_id uuid,
  p_to_amount numeric,
  p_rate numeric,
  p_counterparty text,
  p_note text default null,
  p_occurred_at timestamptz default null,
  p_partner_pays_client boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_user_id uuid := auth.uid();
  v_from_acc record;
  v_to_acc record;
  v_deal_id bigint;
  v_mov_group uuid := gen_random_uuid();
  v_when timestamptz := coalesce(p_occurred_at, now());
  v_comment_suffix text := case
    when p_partner_pays_client then ' [OTC · partner pays client]'
    else ' [OTC]'
  end;
begin
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'from_account_id and to_account_id are required';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'from and to accounts must differ';
  end if;
  if p_from_amount is null or p_from_amount <= 0 then
    raise exception 'from_amount must be > 0';
  end if;
  if p_to_amount is null or p_to_amount <= 0 then
    raise exception 'to_amount must be > 0';
  end if;
  if p_office_id is null then
    raise exception 'office_id is required';
  end if;

  select id, currency_code, office_id into v_from_acc
    from public.accounts where id = p_from_account_id;
  if not found then
    raise exception 'From account % not found', p_from_account_id;
  end if;

  select id, currency_code, office_id into v_to_acc
    from public.accounts where id = p_to_account_id;
  if not found then
    raise exception 'To account % not found', p_to_account_id;
  end if;

  insert into public.deals (
    office_id, manager_id, client_id, client_nickname,
    type, currency_in, amount_in, in_account_id,
    fee_usd, profit_usd, min_fee_applied, referral, comment, status,
    created_at, updated_at,
    in_planned_at, in_actual_amount, in_completed_at,
    created_by_user_id
  ) values (
    p_office_id, v_user_id, null, p_counterparty,
    'EXCHANGE', v_from_acc.currency_code, p_from_amount, p_from_account_id,
    0, 0, false, false,
    coalesce(p_note, '') || v_comment_suffix,
    'completed',
    v_when, v_when,
    v_when, p_from_amount, v_when,
    v_user_id
  ) returning id into v_deal_id;

  -- deal_leg всегда создаём — это для отчётности (зафиксировать какую
  -- сумму получили / должны были получить и по какому курсу)
  insert into public.deal_legs (
    deal_id, leg_index, currency, amount, rate, account_id,
    actual_amount, planned_at, completed_at
  ) values (
    v_deal_id, 0, v_to_acc.currency_code, p_to_amount, p_rate, p_to_account_id,
    p_to_amount, v_when, v_when
  );

  -- OUT movement всегда создаётся (от нас → партнёру)
  insert into public.account_movements (
    account_id, amount, direction, currency_code,
    source_kind, source_ref_id, movement_group_id,
    note, created_by, created_at
  ) values (
    p_from_account_id, p_from_amount, 'out', v_from_acc.currency_code,
    'exchange_out', v_deal_id::text, v_mov_group,
    'OTC #' || v_deal_id || ' · ' || coalesce(p_counterparty, '?')
      || case when p_partner_pays_client then ' · pays client direct' else '' end,
    v_user_id, v_when
  );

  -- IN movement создаём ТОЛЬКО если партнёр зачисляет нам.
  -- В режиме partner_pays_client — IN не создаётся (USDT прошли мимо нашего счёта).
  if not p_partner_pays_client then
    insert into public.account_movements (
      account_id, amount, direction, currency_code,
      source_kind, source_ref_id, source_leg_index, movement_group_id,
      note, created_by, created_at
    ) values (
      p_to_account_id, p_to_amount, 'in', v_to_acc.currency_code,
      'exchange_in', v_deal_id::text, 0, v_mov_group,
      'OTC #' || v_deal_id || ' · ' || coalesce(p_counterparty, '?'),
      v_user_id, v_when
    );
  end if;

  return v_deal_id;
end;
$func$;

grant execute on function public.create_otc_deal(uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz, boolean) to authenticated;
