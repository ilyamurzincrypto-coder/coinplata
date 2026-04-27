-- ============================================================================
-- CoinPlata · 0048_backfill_missing_reverse_pairs.sql
--
-- Баг: после 0046/0047 для некоторых пар в БД есть только master row
-- (например USDT→EUR), а reverse row (EUR→USDT) отсутствует физически.
-- В таком случае sidebar показывает только master, а форма создания
-- сделки при curIn=EUR не находит rate(EUR, USDT) → перевернутая
-- сделка не работает.
--
-- Frontend уже синтезирует reverse в buildRatesLookup (1/master.rate),
-- но БД должна быть консистентной для всех остальных consumers
-- (RPC create_deal margin, rate snapshots, history).
--
-- Backfill: для каждого master без существующего reverse — INSERT
-- reverse row с base_rate = 1/master.base_rate, тем же spread,
-- is_default=true, is_master=false. Trigger sync_reverse_pair (0046)
-- будет поддерживать синхронизацию при будущих updates master.
-- ============================================================================

insert into public.pairs (
  from_currency, to_currency, base_rate, spread_percent,
  is_default, is_master, priority, updated_by, updated_at
)
select
  m.to_currency as from_currency,
  m.from_currency as to_currency,
  1.0 / m.base_rate as base_rate,
  m.spread_percent,
  true as is_default,
  false as is_master,
  coalesce(m.priority, 50) as priority,
  m.updated_by,
  now() as updated_at
from public.pairs m
where m.is_default = true
  and m.is_master = true
  and m.base_rate > 0
  and not exists (
    select 1 from public.pairs r
    where r.is_default = true
      and r.from_currency = m.to_currency
      and r.to_currency = m.from_currency
  );

-- Проверка
select 'After backfill: ' as info;
select from_currency, to_currency, base_rate, spread_percent, is_master
  from public.pairs
  where is_default = true
  order by is_master desc, from_currency, to_currency;
