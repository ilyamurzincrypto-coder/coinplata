-- ============================================================================
-- CoinPlata · 0097_partner_settlements.sql
--
-- Контекст: контрагент напрямую внёс нам кеш или забрал у нас кеш — без
-- сделки. В UI на странице Контрагенты на каждом partner_account кнопки
-- "↓ Внёс" / "↑ Забрал".
--
-- record_partner_inflow:
--   • partner_account_movements: direction=in, source_kind='settle'
--   • наш account НЕ трогаем (одностороннее — баланс партнёра у нас
--     меняется, а кеш в кассу прихходит отдельной операцией если надо)
--
-- record_partner_outflow:
--   • partner_account_movements: direction=out, source_kind='settle'
--   • account_movements (наш счёт): direction=out, source_kind='settle'
--   • оба движения связаны movement_group_id (для атомарного отката)
--
-- Доступ: manager / admin / owner.
-- ============================================================================

-- 1. record_partner_inflow — одностороннее
create or replace function public.record_partner_inflow(
  p_partner_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_note text default null
)
returns uuid  -- partner_account_movement id
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','admin','owner']);
  v_uid uuid := auth.uid();
  v_pa record;
  v_mid uuid;
begin
  if p_partner_account_id is null then
    raise exception 'partner_account_id required' using errcode = '22000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22000';
  end if;

  select id, currency_code into v_pa
    from public.partner_accounts where id = p_partner_account_id;
  if not found then
    raise exception 'Partner account % not found', p_partner_account_id;
  end if;

  if p_currency is not null and upper(p_currency) <> upper(v_pa.currency_code) then
    raise exception 'Currency mismatch: partner account is %, got %',
      v_pa.currency_code, p_currency using errcode = '22000';
  end if;

  insert into public.partner_account_movements (
    partner_account_id, amount, direction, currency_code,
    source_kind, source_ref_id, note, created_by
  ) values (
    p_partner_account_id, p_amount, 'in', v_pa.currency_code,
    'settle', null, nullif(trim(coalesce(p_note,'')), ''), v_uid
  ) returning id into v_mid;

  return v_mid;
end;
$func$;

grant execute on function public.record_partner_inflow(uuid, numeric, text, text)
  to authenticated;

-- 2. record_partner_outflow — парное (partner OUT + наш account OUT)
create or replace function public.record_partner_outflow(
  p_partner_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_from_account_id uuid,    -- наш счёт-источник кеша
  p_note text default null
)
returns uuid  -- movement_group_id
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','admin','owner']);
  v_uid uuid := auth.uid();
  v_pa record;
  v_acc record;
  v_group uuid := gen_random_uuid();
  v_note text := nullif(trim(coalesce(p_note,'')), '');
begin
  if p_partner_account_id is null or p_from_account_id is null then
    raise exception 'partner_account_id and from_account_id required'
      using errcode = '22000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22000';
  end if;

  select id, currency_code into v_pa
    from public.partner_accounts where id = p_partner_account_id;
  if not found then
    raise exception 'Partner account % not found', p_partner_account_id;
  end if;

  select id, currency_code, active into v_acc
    from public.accounts where id = p_from_account_id;
  if not found then
    raise exception 'Account % not found', p_from_account_id;
  end if;
  if not v_acc.active then
    raise exception 'Account % is inactive', p_from_account_id;
  end if;

  -- Валюта должна совпадать у partner_account, нашего счёта и переданной
  if upper(v_acc.currency_code) <> upper(v_pa.currency_code) then
    raise exception 'Currency mismatch: partner % vs account %',
      v_pa.currency_code, v_acc.currency_code using errcode = '22000';
  end if;
  if p_currency is not null and upper(p_currency) <> upper(v_pa.currency_code) then
    raise exception 'Currency mismatch: passed % vs partner %',
      p_currency, v_pa.currency_code using errcode = '22000';
  end if;

  -- 1) partner OUT
  insert into public.partner_account_movements (
    partner_account_id, amount, direction, currency_code,
    source_kind, movement_group_id, note, created_by
  ) values (
    p_partner_account_id, p_amount, 'out', v_pa.currency_code,
    'settle', v_group, v_note, v_uid
  );

  -- 2) наш OUT (партнёр забрал — кассы стало меньше)
  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, movement_group_id, note, created_by
  ) values (
    p_from_account_id, p_amount, 'out', v_acc.currency_code, false,
    'settle', p_partner_account_id::text, v_group, v_note, v_uid
  );

  return v_group;
end;
$func$;

grant execute on function public.record_partner_outflow(uuid, numeric, text, uuid, text)
  to authenticated;

-- 3. delete_partner_settlement — откат по movement_group_id (для outflow)
--    Inflow удаляется по partner_movement_id напрямую (отдельная RPC).
create or replace function public.delete_partner_settlement_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
begin
  if p_group_id is null then
    raise exception 'group_id required' using errcode = '22000';
  end if;
  delete from public.partner_account_movements where movement_group_id = p_group_id;
  delete from public.account_movements where movement_group_id = p_group_id;
end;
$func$;

grant execute on function public.delete_partner_settlement_group(uuid) to authenticated;

-- 4. delete_partner_inflow — откат одностороннего inflow
create or replace function public.delete_partner_inflow(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
begin
  if p_movement_id is null then
    raise exception 'movement_id required' using errcode = '22000';
  end if;
  delete from public.partner_account_movements
    where id = p_movement_id and source_kind = 'settle' and direction = 'in';
end;
$func$;

grant execute on function public.delete_partner_inflow(uuid) to authenticated;

-- Verify
select pg_get_function_identity_arguments(oid) as signature, proname
  from pg_proc
  where proname in ('record_partner_inflow','record_partner_outflow',
                    'delete_partner_settlement_group','delete_partner_inflow')
    and pronamespace = 'public'::regnamespace
  order by proname;
