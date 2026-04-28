-- ============================================================================
-- CoinPlata · 0055_real_balances_v2.sql
--
-- Финальные правильные остатки от юзера. Включают GBP/RUB которые в
-- предыдущих миграциях не учитывались.
--
-- Mark Antalya:
--   USD 136253, TRY 240645, EUR 7205, GBP 1185
--
-- Lara:
--   TRY 787755, RUB 50000, GBP 2270, EUR 13455, USD 64824
--
-- Istanbul:
--   USD 87553, TRY 34351, EUR 2639
--
-- Логика replace (как в 0053/0054):
--   1. DELETE all opening/topup movements для целевых accounts.
--   2. INSERT один opening = (target − deal_balance).
--   3. opening_count = 1 на каждый account, никакого наложения.
-- ============================================================================

-- BEFORE
select 'BEFORE (current state)' as info;
select
  o.name as office,
  a.currency_code as currency,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and m.reserved = false
  ), 0) as current_balance
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%mark%antalya%' or o.name ilike '%lara%' or o.name ilike '%istanbul%')
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
begin
  for v_target_row in
    select * from (values
      -- Mark Antalya
      ('mark%antalya%', 'USD'::text, 136253::numeric),
      ('mark%antalya%', 'EUR'::text, 7205::numeric),
      ('mark%antalya%', 'TRY'::text, 240645::numeric),
      ('mark%antalya%', 'GBP'::text, 1185::numeric),
      -- Lara
      ('lara%',         'USD'::text, 64824::numeric),
      ('lara%',         'EUR'::text, 13455::numeric),
      ('lara%',         'TRY'::text, 787755::numeric),
      ('lara%',         'GBP'::text, 2270::numeric),
      ('lara%',         'RUB'::text, 50000::numeric),
      -- Istanbul
      ('istanbul%',     'USD'::text, 87553::numeric),
      ('istanbul%',     'EUR'::text, 2639::numeric),
      ('istanbul%',     'TRY'::text, 34351::numeric)
    ) as t(office_pattern, currency, amount)
  loop
    select id, name into v_office_id, v_office_name
      from public.offices where name ilike v_target_row.office_pattern limit 1;
    if v_office_id is null then
      raise notice 'SKIP: office % not found', v_target_row.office_pattern;
      continue;
    end if;

    select id into v_account_id
      from public.accounts
      where office_id = v_office_id
        and currency_code = v_target_row.currency
        and active = true
      order by created_at asc nulls last limit 1;
    if v_account_id is null then
      raise notice 'SKIP: no active account for "%" currency % — нужно создать через UI',
        v_office_name, v_target_row.currency;
      continue;
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
        'reset_v2_' || to_char(now(), 'YYYY_MM_DD'),
        'Real balance reset to ' || v_target_row.amount::text,
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
select 'AFTER (must match targets)' as info;
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
  and (o.name ilike '%mark%antalya%' or o.name ilike '%lara%' or o.name ilike '%istanbul%')
  and a.currency_code in ('USD', 'EUR', 'TRY', 'GBP', 'RUB')
order by o.name, a.currency_code;

-- Expected:
--   Mark Antalya: USD=136253, EUR=7205,  TRY=240645, GBP=1185
--   Lara:         USD=64824,  EUR=13455, TRY=787755, GBP=2270, RUB=50000
--   Istanbul:     USD=87553,  EUR=2639,  TRY=34351
-- opening_count = 1 для каждого account.
