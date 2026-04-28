-- ============================================================================
-- CoinPlata · 0076_crypto_clean_baseline.sql
--
-- Чистый baseline крипты: target = 216 941.65 USDT.
--
-- 1. Удаляем ВСЕ "мишурные" USDT-движения (opening, topup, adjustment) —
--    предыдущие миграции 0066/0067/0075 насоздавали их кучу.
-- 2. Deal/transfer-движения (exchange_in/out, transfer_in/out) НЕ трогаем —
--    бизнес-история сохраняется.
-- 3. Считаем сумму оставшихся (реальных торговых) USDT движений.
-- 4. На целевом счёте Mark Antalya USDT TRC20 ставим opening_balance =
--    216941.65 - sum(remaining movements). Остальные USDT счета: opening_balance=0.
-- 5. Ничего не появляется в delta дашборда (opening_balance — без даты).
--
-- v_account_balances total = sum(opening_balance + sum(in) - sum(out))
--                         = (target - sum_remaining) + sum_remaining
--                         = target. ✓
-- ============================================================================

do $clean$
declare
  v_target numeric := 216941.65;
  v_account_id uuid;
  v_office_id uuid;
  v_admin_id uuid;
  v_remaining_sum numeric;
  v_required_opening numeric;
  v_deleted int;
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

  -- 2. Admin для created_by (хотя для opening_balance не нужен)
  select id into v_admin_id from public.users
    where role in ('owner', 'admin') and status = 'active'
    limit 1;

  -- 3. Целевой USDT TRC20 счёт
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
  raise notice 'Target account: %', v_account_id;

  -- 4. Удаляем ВСЕ opening/topup/adjustment движения у USDT счетов
  delete from public.account_movements
    where account_id in (
      select id from public.accounts where currency_code = 'USDT'
    )
    and source_kind in ('opening', 'topup', 'adjustment');
  get diagnostics v_deleted = row_count;
  raise notice 'Удалено % мишурных USDT движений', v_deleted;

  -- 5. Считаем сумму оставшихся (deal/transfer) USDT движений по всем счетам
  --    Учитываем только non-reserved.
  select coalesce(sum(case
    when m.direction = 'in' then m.amount
    else -m.amount
  end), 0)
  into v_remaining_sum
  from public.account_movements m
  join public.accounts a on a.id = m.account_id
  where a.currency_code = 'USDT'
    and not m.reserved;
  raise notice 'Сумма deal/transfer USDT движений: %', v_remaining_sum;

  -- 6. Обнуляем opening_balance у всех USDT счетов
  update public.accounts
    set opening_balance = 0
    where currency_code = 'USDT';

  -- 7. На целевом счёте ставим opening_balance = target - remaining
  v_required_opening := v_target - v_remaining_sum;
  update public.accounts
    set opening_balance = v_required_opening
    where id = v_account_id;
  raise notice 'opening_balance целевого счёта: %', v_required_opening;
end
$clean$;

-- Проверка: GRAND TOTAL USDT должно быть точно 216941.65
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
  a.opening_balance as ob,
  b.total as view_total,
  (select count(*) from public.account_movements m where m.account_id = a.id) as movements_count
from public.accounts a
join public.offices o on o.id = a.office_id
join public.v_account_balances b on b.account_id = a.id
where a.currency_code = 'USDT' and a.active = true
order by b.total desc nulls last;
