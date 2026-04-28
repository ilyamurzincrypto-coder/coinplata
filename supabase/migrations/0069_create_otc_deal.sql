-- ============================================================================
-- CoinPlata · 0069_create_otc_deal.sql
--
-- OTC сделка с контрагентом — упрощённая deal-операция для случаев когда
-- мы обмениваемся валютой с партнёром (не клиентом).
--
-- Сценарий: приняли RUB → партнёр конвертирует в USDT → партнёр прислал
-- USDT. Это OTC обмен RUB→USDT с партнёром, без обычной клиентской
-- сделки (без fee/profit/min_fee_applied/AML).
--
-- Особенности:
--   • from_account → exchange_out movement (списание).
--   • to_account → exchange_in movement (зачисление).
--   • deal row создаётся со статусом='completed', fee=0, profit=0.
--   • created_at можно указать БЭКДЕЙТОМ (p_occurred_at) — для оформления
--     прошедших OTC сделок задним числом.
--
-- В отличие от create_deal (0045): нет multi-output, нет fee/min_fee,
-- нет obligations, нет AML. Просто "что отдали → что получили".
-- ============================================================================

create or replace function public.create_otc_deal(
  p_office_id uuid,
  p_from_account_id uuid,
  p_from_amount numeric,
  p_to_account_id uuid,
  p_to_amount numeric,
  p_rate numeric,
  p_counterparty text,
  p_note text default null,
  p_occurred_at timestamptz default null
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

  -- Создаём deal row
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
    coalesce(p_note, '') || ' [OTC]',
    'completed',
    v_when, v_when,
    v_when, p_from_amount, v_when,
    v_user_id
  ) returning id into v_deal_id;

  -- Создаём deal_leg для to-side (один leg)
  insert into public.deal_legs (
    deal_id, leg_index, currency, amount, rate, account_id,
    actual_amount, planned_at, completed_at
  ) values (
    v_deal_id, 0, v_to_acc.currency_code, p_to_amount, p_rate, p_to_account_id,
    p_to_amount, v_when, v_when
  );

  -- Movements: OUT (exchange_out) на from + IN (exchange_in) на to
  insert into public.account_movements (
    account_id, amount, direction, currency_code,
    source_kind, source_ref_id, movement_group_id,
    note, created_by, created_at
  ) values (
    p_from_account_id, p_from_amount, 'out', v_from_acc.currency_code,
    'exchange_out', v_deal_id::text, v_mov_group,
    'OTC #' || v_deal_id || ' · ' || coalesce(p_counterparty, '?'),
    v_user_id, v_when
  );

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

  return v_deal_id;
end;
$func$;

grant execute on function public.create_otc_deal(uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz) to authenticated;
