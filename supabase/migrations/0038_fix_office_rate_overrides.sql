-- ============================================================================
-- CoinPlata · 0038_fix_office_rate_overrides.sql
--
-- 0036 починил reverse-pair rates в public.pairs, но public.office_rate_overrides
-- осталась с теми же инвертированными значениями (user создавал override'ы
-- в той же конвенции). Результат: per-office rate chip на "Создать сделку"
-- показывает 44.92 для TRY→USD → клик → multiply → 2 млн USD снова.
--
-- Применяем ТУ ЖЕ логику что 0036: для пар где from "слабее" to (priority)
-- И оба направления имеют rate > 1 И их product > 2 → base_rate = 1/forward.
--
-- Сравнение forward и reverse ведётся ВНУТРИ одного office_id.
-- ============================================================================

-- Показать что ДО
select 'BEFORE' as when_, office_id, from_currency, to_currency, base_rate
  from public.office_rate_overrides
  order by office_id, from_currency, to_currency;

-- Fix в одном UPDATE с CTE
with fixes as (
  select p.office_id, p.from_currency, p.to_currency,
         1 / r.base_rate as fixed_rate
    from public.office_rate_overrides p
    join public.office_rate_overrides r
      on r.office_id     = p.office_id
      and r.from_currency = p.to_currency
      and r.to_currency   = p.from_currency
    where p.base_rate > 1
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
update public.office_rate_overrides p
  set base_rate = f.fixed_rate,
      updated_at = now()
  from fixes f
  where p.office_id     = f.office_id
    and p.from_currency = f.from_currency
    and p.to_currency   = f.to_currency;

-- Показать что ПОСЛЕ
select 'AFTER' as when_, office_id, from_currency, to_currency, base_rate,
       round(base_rate::numeric, 6) as rounded
  from public.office_rate_overrides
  order by office_id, from_currency, to_currency;
