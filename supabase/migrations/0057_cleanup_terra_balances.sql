-- ============================================================================
-- CoinPlata · 0057_cleanup_terra_balances.sql
--
-- Terra City: остатки поломаны от наложенных opening/topup adjustments
-- (миграции 0051 могла добавить adjustments если pattern совпадал).
--
-- Очищаем все opening/topup movements у accounts офиса. Balance
-- пересчитается из deal-related movements (exchange/transfer/settle).
-- Это даст реальный operational balance.
--
-- Если юзер хочет конкретные target balances — можно прислать суммы,
-- я добавлю их в reset аналогично 0056 (replace logic).
-- ============================================================================

-- BEFORE
select 'BEFORE Terra City balances' as info;
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
    where account_id = a.id
      and source_kind in ('opening','topup')) as opening_topup_count
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%terra%' or o.name ilike '%тер%')
order by o.name, a.currency_code;

-- Cleanup: удаляем все opening/topup movements у всех Terra accounts
do $cleanup$
declare
  v_deleted_count int := 0;
  v_office record;
begin
  for v_office in
    select id, name from public.offices
      where name ilike '%terra%' or name ilike '%тер%'
  loop
    raise notice 'Cleaning up office: %', v_office.name;
    with deleted as (
      delete from public.account_movements
        where source_kind in ('opening','topup')
          and account_id in (
            select id from public.accounts where office_id = v_office.id
          )
        returning id
    )
    select count(*) into v_deleted_count from deleted;
    raise notice '  → deleted % opening/topup movements', v_deleted_count;
  end loop;
end
$cleanup$;

-- AFTER — balances теперь только от deal-related movements
select 'AFTER (deal-only balances)' as info;
select
  o.name as office,
  a.currency_code as currency,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and m.reserved = false
  ), 0) as deal_only_balance,
  (select count(*) from public.account_movements
    where account_id = a.id
      and source_kind in ('opening','topup')) as opening_topup_count_after
from public.accounts a
join public.offices o on o.id = a.office_id
where a.active = true
  and (o.name ilike '%terra%' or o.name ilike '%тер%')
order by o.name, a.currency_code;

-- opening_topup_count_after должен быть = 0 для всех accounts.
-- deal_only_balance = реальный operational balance из sales/transfers.
