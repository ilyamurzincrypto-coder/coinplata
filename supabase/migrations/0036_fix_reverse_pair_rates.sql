-- ============================================================================
-- CoinPlata · 0036_fix_reverse_pair_rates.sql
--
-- КРИТИЧЕСКИЙ MATH-BUG в деалах: при курсе 45 000 TRY → USD система
-- показывала ~2 000 000 USD вместо ~1 000. Причина: pair.rate для
-- reverse-направлений (TRY→USD, TRY→USDT, USDT→EUR и т.д.) хранился в
-- конвенции "quote per base" (те же ~44.92 как forward), а не
-- "to per from" (≈0.022). Код `multiplyAmount(amtIn, rate)` ожидает
-- стандарт → 45000 × 44.92 = 2М вместо 45000 × 0.022 = 1000.
--
-- Fix: для каждой pair где from "слабее" to (по приоритету валют) И
-- обратная пара тоже имеет rate > 1 И их произведение > 2
-- (значит оба стоят в "big-per-small" единице) → перезаписываем на
-- правильный inverse = 1 / forward.base_rate.
--
-- Priority (ниже число = сильнее валюта):
--   USD=1, USDT=2, EUR=3, GBP=4, CHF=5, TRY=6, RUB=7
-- "Forward" — from с меньшим приоритетом. "Reverse" — с бóльшим.
--
-- rate_snapshots НЕ трогаем — это историческая данность, уже использовалась
-- в старой конвенции. Новые snapshots будут корректными после этого фикса.
-- ============================================================================

-- Показать что ДО
select 'BEFORE' as when_, from_currency, to_currency, base_rate
  from public.pairs
  where is_default
  order by from_currency, to_currency;

-- Fix в одном UPDATE с CTE
with fixes as (
  select p.id, 1 / r.base_rate as fixed_rate
    from public.pairs p
    join public.pairs r
      on r.is_default
      and r.from_currency = p.to_currency
      and r.to_currency   = p.from_currency
    where p.is_default
      and p.base_rate > 1
      and r.base_rate > 1
      and p.base_rate * r.base_rate > 2
      and (case upper(p.from_currency)
             when 'USD'  then 1 when 'USDT' then 2 when 'EUR' then 3
             when 'GBP'  then 4 when 'CHF'  then 5 when 'TRY' then 6
             when 'RUB'  then 7 else 99 end)
          >
          (case upper(p.to_currency)
             when 'USD'  then 1 when 'USDT' then 2 when 'EUR' then 3
             when 'GBP'  then 4 when 'CHF'  then 5 when 'TRY' then 6
             when 'RUB'  then 7 else 99 end)
)
update public.pairs p
  set base_rate = f.fixed_rate,
      updated_at = now()
  from fixes f
  where p.id = f.id;

-- Показать что ПОСЛЕ
select 'AFTER' as when_, from_currency, to_currency, base_rate,
       round(base_rate::numeric, 6) as rounded
  from public.pairs
  where is_default
  order by from_currency, to_currency;
