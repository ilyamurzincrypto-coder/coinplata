-- ============================================================================
-- CoinPlata · 0073_otc_obligations.sql
--
-- Этап 2 модернизации OTC: obligations (долги) при отложенных платежах.
--
-- 1. obligations.counterparty_name — для трекинга партнёров (не клиентов).
--    Если direction='they_owe' и client_id=null → counterparty_name содержит
--    имя партнёра.
--
-- 2. create_otc_deal расширен параметром p_partner_deferred:
--    - false (default): обычное поведение.
--    - true: партнёр обещал зачислить, но ещё не зачислил. IN не создаётся,
--      создаётся obligation they_owe партнёру.
--
-- 3. Если оба флага false — стандарт (IN+OUT движения).
--    Если partner_pays_client=true — IN не создаётся, obligation НЕ создаётся
--    (партнёр уже выдал клиенту, нам ничего не должен).
--    Если partner_deferred=true — IN не создаётся, obligation создаётся.
--
-- 4. Совместное использование флагов partner_pays_client + partner_deferred
--    запрещено (взаимоисключающие сценарии).
-- ============================================================================

-- 1. Add counterparty_name column to obligations
alter table public.obligations
  add column if not exists counterparty_name text;

create index if not exists obligations_counterparty_idx
  on public.obligations(counterparty_name)
  where counterparty_name is not null;

-- 2. Replace create_otc_deal с поддержкой partner_deferred
drop function if exists public.create_otc_deal(uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz, boolean);

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
  p_partner_pays_client boolean default false,
  p_partner_deferred boolean default false
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
  v_comment_suffix text;
begin
  if p_partner_pays_client and p_partner_deferred then
    raise exception 'partner_pays_client and partner_deferred — взаимоисключающие';
  end if;

  v_comment_suffix := case
    when p_partner_pays_client then ' [OTC · partner pays client]'
    when p_partner_deferred    then ' [OTC · partner deferred]'
    else ' [OTC]'
  end;

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

  insert into public.deal_legs (
    deal_id, leg_index, currency, amount, rate, account_id,
    actual_amount, planned_at, completed_at
  ) values (
    v_deal_id, 0, v_to_acc.currency_code, p_to_amount, p_rate, p_to_account_id,
    case when p_partner_deferred then 0 else p_to_amount end,
    v_when,
    case when p_partner_deferred then null else v_when end
  );

  -- OUT movement всегда создаётся (мы → партнёр)
  insert into public.account_movements (
    account_id, amount, direction, currency_code,
    source_kind, source_ref_id, movement_group_id,
    note, created_by, created_at
  ) values (
    p_from_account_id, p_from_amount, 'out', v_from_acc.currency_code,
    'exchange_out', v_deal_id::text, v_mov_group,
    'OTC #' || v_deal_id || ' · ' || coalesce(p_counterparty, '?')
      || case
           when p_partner_pays_client then ' · pays client direct'
           when p_partner_deferred then ' · partner will pay later'
           else ''
         end,
    v_user_id, v_when
  );

  -- IN movement создаётся ТОЛЬКО в standard режиме
  if not p_partner_pays_client and not p_partner_deferred then
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

  -- Obligation they_owe — только если partner_deferred (партнёр должен нам)
  if p_partner_deferred then
    insert into public.obligations (
      office_id, deal_id, client_id, counterparty_name,
      currency_code, amount, direction, status, note, created_by, created_at
    ) values (
      p_office_id, v_deal_id, null, p_counterparty,
      v_to_acc.currency_code, p_to_amount, 'they_owe', 'open',
      'OTC #' || v_deal_id || ' · партнёр обещал зачислить ' || p_to_amount || ' ' || v_to_acc.currency_code,
      v_user_id, v_when
    );
  end if;

  return v_deal_id;
end;
$func$;

grant execute on function public.create_otc_deal(uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz, boolean, boolean) to authenticated;
