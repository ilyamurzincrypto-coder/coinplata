-- ============================================================================
-- CoinPlata · 0075_crypto_adjustment.sql
--
-- Hard корректировка крипто-баланса: итоговая сумма USDT должна стать
-- 217 056.65 (текущий target). Юзер: "аккуратно через SQL чтобы ничего
-- не сломать".
--
-- Стратегия — НЕ удаляем deal/transfer movements (они часть бизнес-
-- истории). Вместо этого создаём ОДНО adjustment-движение на дельту
-- (target - existing) на целевом счёте Mark Antalya USDT TRC20.
--
-- 1. Считаем текущий total USDT через v_account_balances (учитывает
--    opening_balance + все movements кроме reserved).
-- 2. delta = 217056.65 - existing_total.
-- 3. Если delta != 0 — INSERT adjustment movement (in / out) на target.
-- 4. accounts.opening_balance не трогаем — корректировка через movements,
--    история сохранена.
--
-- В конце — проверка: должно показать 217056.65.
-- ============================================================================

do $adjust$
declare
  v_target numeric := 217056.65;          -- Целевой total USDT
  v_account_id uuid;
  v_office_id uuid;
  v_admin_id uuid;
  v_existing_total numeric;
  v_delta numeric;
  v_now timestamptz := now();
begin
  -- 1. Mark Antalya office
  select id into v_office_id
    from public.offices
    where lower(name) like '%mark%antalya%' or lower(name) like '%antalya%mark%'
    limit 1;
  if v_office_id is null then
    select id into v_office_id
      from public.offices
      where lower(name) like '%antalya%' or lower(name) like '%mark%'
      order by case when lower(name) like '%antalya%' then 1 else 2 end
      limit 1;
  end if;
  if v_office_id is null then
    raise exception 'Не найден офис Mark/Antalya';
  end if;

  -- 2. Admin для created_by
  select id into v_admin_id from public.users
    where role in ('owner', 'admin') and status = 'active'
    limit 1;

  -- 3. Целевой счёт USDT TRC20
  select id into v_account_id
    from public.accounts
    where office_id = v_office_id
      and currency_code = 'USDT'
      and active = true
      and (upper(coalesce(network_id, '')) = 'TRC20' or upper(coalesce(name, '')) like '%TRC20%')
    limit 1;
  if v_account_id is null then
    raise exception 'USDT TRC20 счёт не найден в Mark Antalya';
  end if;

  -- 4. Существующий total USDT по всей системе (через view)
  select coalesce(sum(b.total), 0) into v_existing_total
    from public.v_account_balances b
    join public.accounts a on a.id = b.account_id
    where a.currency_code = 'USDT' and a.active = true;

  v_delta := v_target - v_existing_total;
  raise notice 'Существующий total USDT: %', v_existing_total;
  raise notice 'Целевой:                 %', v_target;
  raise notice 'Корректировка (delta):   %', v_delta;

  if abs(v_delta) < 0.000001 then
    raise notice 'Дельта = 0, корректировка не нужна';
    return;
  end if;

  -- 5. INSERT adjustment movement
  if v_delta > 0 then
    insert into public.account_movements (
      account_id, amount, direction, currency_code,
      source_kind, note, created_by, created_at
    ) values (
      v_account_id, v_delta, 'in', 'USDT',
      'adjustment',
      'Корректировка до целевого остатка ' || v_target || ' USDT',
      v_admin_id, v_now
    );
    raise notice 'Создан +% USDT adjustment IN', v_delta;
  else
    insert into public.account_movements (
      account_id, amount, direction, currency_code,
      source_kind, note, created_by, created_at
    ) values (
      v_account_id, abs(v_delta), 'out', 'USDT',
      'adjustment',
      'Корректировка до целевого остатка ' || v_target || ' USDT',
      v_admin_id, v_now
    );
    raise notice 'Создан -% USDT adjustment OUT', abs(v_delta);
  end if;
end
$adjust$;

-- Проверка: total USDT должен быть точно 217056.65
select
  'GRAND TOTAL USDT' as label,
  coalesce(sum(b.total), 0) as total
from public.v_account_balances b
join public.accounts a on a.id = b.account_id
where a.currency_code = 'USDT' and a.active = true;

-- Per-account breakdown
select
  o.name as office,
  a.name as account,
  a.network_id,
  b.total,
  (select count(*) from public.account_movements m where m.account_id = a.id) as movements_count,
  (select count(*) from public.account_movements m where m.account_id = a.id and m.source_kind = 'adjustment') as adjustment_count
from public.accounts a
join public.offices o on o.id = a.office_id
join public.v_account_balances b on b.account_id = a.id
where a.currency_code = 'USDT' and a.active = true
order by b.total desc;
