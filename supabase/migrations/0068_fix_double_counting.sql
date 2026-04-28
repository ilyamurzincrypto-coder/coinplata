-- ============================================================================
-- CoinPlata · 0068_fix_double_counting.sql
--
-- 0067 ставил И accounts.opening_balance=228538.65, И INSERT opening movement
-- на ту же сумму. View v_account_balances считает total как
--   opening_balance + sum(movements)
-- → двойной счёт = 457 077.30 (юзер видит 453 420.68).
--
-- Fix: для USDT обнуляем opening_balance у ВСЕХ счетов. Баланс держится
-- только в movements (наш opening 228 538.65 на Mark Antalya / TRC20).
--
-- Эта миграция идемпотентна — можно прогонять много раз.
-- ============================================================================

-- Обнуляем opening_balance у всех USDT счетов.
-- Балансы теперь полностью держатся в account_movements (как и должно
-- быть по архитектуре — opening_balance это только seed для INSERT
-- opening movement).
update public.accounts
  set opening_balance = 0
  where currency_code = 'USDT';

-- Проверка по каждому счёту
select
  o.name as office,
  a.name as account,
  a.network_id,
  a.opening_balance as ob_field,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and not m.reserved
  ), 0) as movements_balance,
  -- Это то что view выдаст (должно совпадать с movements_balance после fix)
  (select total from public.v_account_balances vb where vb.account_id = a.id) as view_total
from public.accounts a
join public.offices o on o.id = a.office_id
where a.currency_code = 'USDT' and a.active = true
order by view_total desc nulls last;

-- Grand total USDT — должен быть ровно 228 538.65
select
  'GRAND TOTAL USDT' as label,
  coalesce(sum(b.total), 0) as total
from public.v_account_balances b
join public.accounts a on a.id = b.account_id
where a.currency_code = 'USDT';
