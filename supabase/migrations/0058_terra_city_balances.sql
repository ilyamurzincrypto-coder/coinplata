-- ============================================================================
-- CoinPlata · 0058_terra_city_balances.sql
--
-- Terra City начальные остатки.
--
-- Целевые балансы:
--   USD 64824, EUR 13255, TRY 787755, RUB 50000, GBP 2270
--
-- Логика replace + auto-create (как 0056):
--   1. Найти office matching '%terra%'.
--   2. Auto-add currency в registry если нет (GBP/RUB).
--   3. Auto-create cash account если accounts офиса не имеет валюты.
--   4. DELETE all opening/topup movements.
--   5. INSERT один opening = (target − deal_balance).
-- ============================================================================

-- BEFORE
select 'BEFORE Terra City' as info;
select
  o.name as office,
  a.currency_code as currency,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and m.reserved = false
  ), 0) as current_balance,
  (select count(*) from public.account_movements
    where account_id = a.id and source_kind in ('opening','topup')) as opening_count
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%terra%' or o.name ilike '%тер%')
  and a.currency_code in ('USD', 'EUR', 'TRY', 'GBP', 'RUB')
order by o.name, a.currency_code;

do $reset$
declare
  v_target_row record;
  v_account_id uuid;
  v_office_id uuid;
  v_office_name text;
  v_deal_balance numeric;
  v_opening_amount numeric;
  v_user_id uuid := auth.uid();
  v_currency_exists boolean;
begin
  for v_target_row in
    select * from (values
      ('terra%',     'USD'::text, 64824::numeric),
      ('terra%',     'EUR'::text, 13255::numeric),
      ('terra%',     'TRY'::text, 787755::numeric),
      ('terra%',     'RUB'::text, 50000::numeric),
      ('terra%',     'GBP'::text, 2270::numeric)
    ) as t(office_pattern, currency, amount)
  loop
    select id, name into v_office_id, v_office_name
      from public.offices where name ilike v_target_row.office_pattern limit 1;
    if v_office_id is null then
      raise notice 'SKIP: office matching % not found', v_target_row.office_pattern;
      continue;
    end if;

    -- Auto-add currency if missing
    select exists(select 1 from public.currencies where code = v_target_row.currency)
      into v_currency_exists;
    if not v_currency_exists then
      insert into public.currencies (code, type, symbol, name, decimals, active)
      values (
        v_target_row.currency, 'fiat',
        case v_target_row.currency
          when 'GBP' then '£' when 'RUB' then '₽' when 'EUR' then '€'
          when 'USD' then '$' when 'TRY' then '₺' else ''
        end,
        v_target_row.currency, 2, true
      ) on conflict (code) do nothing;
      raise notice 'AUTO-ADDED currency: %', v_target_row.currency;
    end if;

    -- Account lookup
    select id into v_account_id
      from public.accounts
      where office_id = v_office_id
        and currency_code = v_target_row.currency
        and active = true
      order by created_at asc nulls last limit 1;

    -- Auto-create если нет
    if v_account_id is null then
      insert into public.accounts (
        office_id, currency_code, type, name, active, opening_balance
      ) values (
        v_office_id, v_target_row.currency, 'cash',
        'Cash ' || v_target_row.currency, true, 0
      ) returning id into v_account_id;
      raise notice 'AUTO-CREATED account: % cash %',
        v_office_name, v_target_row.currency;
    end if;

    delete from public.account_movements
      where account_id = v_account_id
        and source_kind in ('opening', 'topup');

    select coalesce(sum(
      case when direction = 'in' then amount else -amount end
    ), 0)
    into v_deal_balance
    from public.account_movements
    where account_id = v_account_id and reserved = false;

    v_opening_amount := v_target_row.amount - v_deal_balance;

    if abs(v_opening_amount) >= 0.01 then
      insert into public.account_movements (
        account_id, amount, direction, currency_code, reserved,
        source_kind, source_ref_id, note, created_by
      ) values (
        v_account_id,
        abs(v_opening_amount),
        case when v_opening_amount > 0 then 'in' else 'out' end,
        v_target_row.currency,
        false,
        'opening',
        'terra_reset_' || to_char(now(), 'YYYY_MM_DD'),
        'Terra City initial balance ' || v_target_row.amount::text,
        v_user_id
      );
    end if;

    raise notice 'RESET % %: target=%, deal_balance=%, opening=%',
      v_office_name, v_target_row.currency,
      v_target_row.amount, v_deal_balance, v_opening_amount;
  end loop;
end
$reset$;

-- AFTER
select 'AFTER Terra City (must match)' as info;
select
  o.name as office,
  a.currency_code as currency,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and m.reserved = false
  ), 0) as final_balance,
  (select count(*) from public.account_movements
    where account_id = a.id and source_kind in ('opening','topup')) as opening_count
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%terra%' or o.name ilike '%тер%')
  and a.currency_code in ('USD', 'EUR', 'TRY', 'GBP', 'RUB')
order by o.name, a.currency_code;

-- Expected:
--   Terra City: USD=64824, EUR=13255, TRY=787755, RUB=50000, GBP=2270
-- opening_count = 1 для каждого account.
