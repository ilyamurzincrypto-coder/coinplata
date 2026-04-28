-- ============================================================================
-- CoinPlata · 0053_reset_initial_balances.sql
--
-- Исправление 0051: тогда добавлялись adjustment-движения. Если миграция
-- применилась дважды или existing balances были non-zero — суммы наложились.
--
-- Логика этой миграции:
--   1. УДАЛЯЕМ ВСЕ движения с source_kind IN ('opening','topup') для
--      целевых accounts. Это убирает все "initial setup" движения,
--      сохраняя deal-related (exchange_in/out, transfer_*, settle).
--   2. Считаем balance ОТ DEAL movements (то что осталось).
--   3. INSERT один opening movement = (target − deal_remaining).
--      Финальный баланс = deal_remaining + (target − deal_remaining) = target.
--   4. Никакого наложения — каждое значение становится точно target.
--
-- Целевые балансы:
--   Mark Antalya: USD 166283, EUR 7205, TRY 240645
--   Erasiya:      USD 64824,  EUR 13255, TRY 787755
--   Tambov:       USD 678268, EUR 2639,  TRY 34351
-- ============================================================================

-- BEFORE
select 'BEFORE (current state)' as info;
select
  o.name as office,
  a.currency_code as currency,
  a.id as account_id,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and m.reserved = false
  ), 0) as current_balance,
  (select count(*) from public.account_movements
    where account_id = a.id and source_kind in ('opening','topup')) as opening_movements
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%mark%antalya%' or o.name ilike '%erasi%' or o.name ilike '%tambov%')
  and a.currency_code in ('USD', 'EUR', 'TRY')
order by o.name, a.currency_code;

-- ----------------------------------------------------------------------------
-- Reset block
-- ----------------------------------------------------------------------------
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
      ('mark%antalya%', 'USD'::text, 166283::numeric),
      ('mark%antalya%', 'EUR'::text, 7205::numeric),
      ('mark%antalya%', 'TRY'::text, 240645::numeric),
      ('erasi%',        'USD'::text, 64824::numeric),
      ('erasi%',        'EUR'::text, 13255::numeric),
      ('erasi%',        'TRY'::text, 787755::numeric),
      ('tambov%',       'USD'::text, 678268::numeric),
      ('tambov%',       'EUR'::text, 2639::numeric),
      ('tambov%',       'TRY'::text, 34351::numeric)
    ) as t(office_pattern, currency, amount)
  loop
    -- Найти офис
    select id, name into v_office_id, v_office_name
      from public.offices where name ilike v_target_row.office_pattern limit 1;
    if v_office_id is null then
      raise notice 'SKIP: office % not found', v_target_row.office_pattern;
      continue;
    end if;

    -- Первый active account офиса с нужной валютой
    select id into v_account_id
      from public.accounts
      where office_id = v_office_id
        and currency_code = v_target_row.currency
        and active = true
      order by created_at asc nulls last limit 1;
    if v_account_id is null then
      raise notice 'SKIP: no active account for % %', v_office_name, v_target_row.currency;
      continue;
    end if;

    -- Удаляем ВСЕ existing opening/topup movements
    delete from public.account_movements
      where account_id = v_account_id
        and source_kind in ('opening', 'topup');

    -- Считаем оставшийся balance из deal-related movements
    select coalesce(sum(
      case when direction = 'in' then amount else -amount end
    ), 0)
    into v_deal_balance
    from public.account_movements
    where account_id = v_account_id and reserved = false;

    -- Целевой opening movement = target - deal_balance
    -- (тогда финальный balance = deal_balance + opening = target)
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
        'reset_' || to_char(now(), 'YYYY_MM_DD'),
        'Initial balance set to ' || v_target_row.amount::text
          || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
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
  and (o.name ilike '%mark%antalya%' or o.name ilike '%erasi%' or o.name ilike '%tambov%')
  and a.currency_code in ('USD', 'EUR', 'TRY')
order by o.name, a.currency_code;

-- Expected results:
--   Mark Antalya: USD=166283, EUR=7205, TRY=240645
--   Erasiya:      USD=64824,  EUR=13255, TRY=787755
--   Tambov:       USD=678268, EUR=2639,  TRY=34351
-- opening_count должен быть = 1 для каждого account (один opening movement).
