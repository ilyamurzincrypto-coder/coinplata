-- ============================================================================
-- CoinPlata · 0054_correct_office_names_balances.sql
--
-- Юзер уточнил правильные названия офисов:
--   * Mark Antalya  (как было)
--   * Lara          (ранее по ошибке писали Erasiya)
--   * Istanbul      (ранее по ошибке писали Tambov)
--
-- Если предыдущие миграции 0051/0053 искали по 'erasi%' и 'tambov%' —
-- они пропустили эти офисы (RAISE NOTICE 'office not found'). Балансы
-- НЕ были применены к Lara/Istanbul. Эта миграция применяет правильные
-- значения по корректным названиям.
--
-- Логика та же что в 0053 (replace, не add):
--   1. DELETE все opening/topup movements для accounts.
--   2. INSERT один opening = (target − deal_balance).
-- ============================================================================

-- 0. Rename existing offices если в БД остались старые названия.
--    Если офис уже называется Lara/Istanbul — UPDATE no-op (where ilike).
do $rename$
begin
  -- Erasiya → Lara
  if exists (select 1 from public.offices where name ilike 'erasi%') then
    update public.offices set name = 'Lara'
      where name ilike 'erasi%';
    raise notice 'Renamed Erasiya → Lara';
  end if;
  -- Tambov → Istanbul
  if exists (select 1 from public.offices where name ilike 'tambov%') then
    update public.offices set name = 'Istanbul'
      where name ilike 'tambov%';
    raise notice 'Renamed Tambov → Istanbul';
  end if;
end
$rename$;

-- BEFORE — текущее состояние трёх офисов
select 'BEFORE (current state)' as info;
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
  and (o.name ilike '%mark%antalya%' or o.name ilike '%lara%' or o.name ilike '%istanbul%')
  and a.currency_code in ('USD', 'EUR', 'TRY')
order by o.name, a.currency_code;

-- ----------------------------------------------------------------------------
-- Reset block с правильными названиями
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
      -- Mark Antalya
      ('mark%antalya%', 'USD'::text, 166283::numeric),
      ('mark%antalya%', 'EUR'::text, 7205::numeric),
      ('mark%antalya%', 'TRY'::text, 240645::numeric),
      -- Lara (правильное название, было Erasiya)
      ('lara%',         'USD'::text, 64824::numeric),
      ('lara%',         'EUR'::text, 13255::numeric),
      ('lara%',         'TRY'::text, 787755::numeric),
      -- Istanbul (правильное название, было Tambov)
      ('istanbul%',     'USD'::text, 678268::numeric),
      ('istanbul%',     'EUR'::text, 2639::numeric),
      ('istanbul%',     'TRY'::text, 34351::numeric)
    ) as t(office_pattern, currency, amount)
  loop
    select id, name into v_office_id, v_office_name
      from public.offices where name ilike v_target_row.office_pattern limit 1;
    if v_office_id is null then
      raise notice 'SKIP: office matching % not found', v_target_row.office_pattern;
      continue;
    end if;

    select id into v_account_id
      from public.accounts
      where office_id = v_office_id
        and currency_code = v_target_row.currency
        and active = true
      order by created_at asc nulls last limit 1;
    if v_account_id is null then
      raise notice 'SKIP: no active account for "%" currency %',
        v_office_name, v_target_row.currency;
      continue;
    end if;

    -- Удаляем ВСЕ existing opening/topup
    delete from public.account_movements
      where account_id = v_account_id
        and source_kind in ('opening', 'topup');

    -- Deal balance = что осталось после удаления opening/topup
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
        'reset_' || to_char(now(), 'YYYY_MM_DD'),
        'Initial balance set to ' || v_target_row.amount::text
          || ' (correct name fix ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
        v_user_id
      );
    end if;

    raise notice 'RESET % %: target=%, deal_balance=%, opening=%',
      v_office_name, v_target_row.currency,
      v_target_row.amount, v_deal_balance, v_opening_amount;
  end loop;
end
$reset$;

-- AFTER — должно точно соответствовать целевым значениям
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
  and a.currency_code in ('USD', 'EUR', 'TRY')
order by o.name, a.currency_code;

-- Expected:
--   Mark Antalya: USD=166283, EUR=7205,  TRY=240645
--   Lara:         USD=64824,  EUR=13255, TRY=787755
--   Istanbul:     USD=678268, EUR=2639,  TRY=34351
-- opening_count = 1 для каждого (один opening movement, no duplicates).
