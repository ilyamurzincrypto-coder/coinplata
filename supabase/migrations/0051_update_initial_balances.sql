-- ============================================================================
-- CoinPlata · 0051_update_initial_balances.sql
--
-- Обновление начальных остатков для трёх офисов: Mark Antalya, Erasiya,
-- Tambov. Балансы считаются из account_movements (см. CLAUDE.md), поэтому
-- "обновление" = добавление adjustment movement до целевого значения.
--
-- Логика:
--   1. Для каждой пары (office, currency, target_amount):
--      a. Найти первый active account по office name + currency.
--      b. Вычислить текущий баланс (sum signed non-reserved movements).
--      c. Insert adjustment movement (in/out) на разницу,
--         source_kind='opening', note с пояснением.
--   2. История movements сохраняется (мы не удаляем — только добавляем
--      компенсирующее движение).
--
-- Если accounts с указанной валютой нет в офисе — RAISE NOTICE,
-- эту пару пропускаем (нужно создать аккаунт через UI).
-- ============================================================================

-- BEFORE — текущее состояние
select 'BEFORE adjustment' as info;
select
  o.name as office,
  a.currency_code as currency,
  a.name as account,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and m.reserved = false
  ), 0) as current_balance
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%mark%' or o.name ilike '%erasi%' or o.name ilike '%tambov%')
order by o.name, a.currency_code;

-- ----------------------------------------------------------------------------
-- Adjustment block
-- ----------------------------------------------------------------------------
do $adjust$
declare
  v_target_row record;
  v_account_id uuid;
  v_office_id uuid;
  v_office_name text;
  v_current_balance numeric;
  v_diff numeric;
  v_user_id uuid := auth.uid();
begin
  -- Целевые балансы. office_pattern — ILIKE по name (case-insensitive,
  -- частичное совпадение). currency / amount — целевое значение.
  for v_target_row in
    select * from (values
      -- Mark Antalya
      ('mark%antalya%', 'USD'::text, 166283::numeric),
      ('mark%antalya%', 'EUR'::text, 7205::numeric),
      ('mark%antalya%', 'TRY'::text, 240645::numeric),
      -- Erasiya (поиск ILIKE)
      ('erasi%',        'USD'::text, 64824::numeric),
      ('erasi%',        'EUR'::text, 13255::numeric),
      ('erasi%',        'TRY'::text, 787755::numeric),
      -- Tambov
      ('tambov%',       'USD'::text, 678268::numeric),
      ('tambov%',       'EUR'::text, 2639::numeric),
      ('tambov%',       'TRY'::text, 34351::numeric)
    ) as t(office_pattern, currency, amount)
  loop
    -- Найти офис
    select id, name into v_office_id, v_office_name
      from public.offices
      where name ilike v_target_row.office_pattern
      limit 1;

    if v_office_id is null then
      raise notice 'SKIP: office matching % not found', v_target_row.office_pattern;
      continue;
    end if;

    -- Найти первый active account офиса с нужной валютой
    select id into v_account_id
      from public.accounts
      where office_id = v_office_id
        and currency_code = v_target_row.currency
        and active = true
      order by created_at asc nulls last
      limit 1;

    if v_account_id is null then
      raise notice 'SKIP: no active account for office "%" currency %',
        v_office_name, v_target_row.currency;
      continue;
    end if;

    -- Текущий баланс (sum signed non-reserved movements)
    select coalesce(sum(
      case when direction = 'in' then amount else -amount end
    ), 0)
    into v_current_balance
    from public.account_movements
    where account_id = v_account_id
      and reserved = false;

    v_diff := v_target_row.amount - v_current_balance;

    if abs(v_diff) < 0.01 then
      raise notice 'OK: % % already at target % (no adjustment needed)',
        v_office_name, v_target_row.currency, v_target_row.amount;
      continue;
    end if;

    -- Adjustment movement
    insert into public.account_movements (
      account_id,
      amount,
      direction,
      currency_code,
      reserved,
      source_kind,
      source_ref_id,
      note,
      created_by
    ) values (
      v_account_id,
      abs(v_diff),
      case when v_diff > 0 then 'in' else 'out' end,
      v_target_row.currency,
      false,
      'opening',
      'init_' || to_char(now(), 'YYYY_MM_DD'),
      'Initial balance adjustment '
        || to_char(now(), 'YYYY-MM-DD')
        || ': '
        || v_current_balance::text || ' → ' || v_target_row.amount::text,
      v_user_id
    );

    raise notice 'ADJUSTED % % : % → % (diff %)',
      v_office_name, v_target_row.currency,
      v_current_balance, v_target_row.amount, v_diff;
  end loop;
end
$adjust$;

-- AFTER — финальное состояние
select 'AFTER adjustment' as info;
select
  o.name as office,
  a.currency_code as currency,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and m.reserved = false
  ), 0) as final_balance
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%mark%' or o.name ilike '%erasi%' or o.name ilike '%tambov%')
  and a.currency_code in ('USD', 'EUR', 'TRY')
order by o.name, a.currency_code;
