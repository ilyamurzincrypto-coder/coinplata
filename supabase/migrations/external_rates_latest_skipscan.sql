-- external_rates_latest_skipscan.sql
-- Вьюха последних котировок падала по таймауту (2026-09-01).
--
-- СИМПТОМ: дашборд «Курсы» неделю показывал «Курс ЦБ ещё не загрузился», а
-- QR-панель — прочерки при живом спреде. Причина не во фронте:
--   select * from v_external_rates_latest
--   → ERROR 57014: canceling statement due to statement timeout (>3000 мс)
--
-- ПРИЧИНА: DISTINCT ON (source, pair) без WHERE. В Postgres нет loose index
-- scan, поэтому индекс (source, pair, fetched_at DESC) НЕ спасает: планировщик
-- читает все 846 тыс. строк и сортирует. Индекс при этом уже был — добавлять
-- нечего, надо переписать сам запрос.
--
-- РЕШЕНИЕ: рекурсивный skip-scan. Сначала 29 итераций «следующая пара
-- (source,pair) после текущей» — каждая одиночный index-only seek, потом по
-- одному seek за последней котировкой каждой пары. Полного скана нет вообще.
--
-- ЗАМЕР НА ЖИВОЙ БАЗЕ:
--   было:  таймаут (>3000 мс, план: Parallel Index Only Scan 846k + Unique)
--   стало: 8.783 мс (план: Recursive Union 29 итераций + 29 Index Scan)
--
-- ИДЕНТИЧНОСТЬ РЕЗУЛЬТАТА (проверено в ОДНОМ снимке, чтобы приезжающие
-- каждые 3 минуты котировки не сдвинули сравнение):
--   old_rows = 29, new_rows = 29, only_in_old = 0, only_in_new = 0
-- по всем 7 провайдерам (rapira, cbr, ecb, binance, tcmb, harem, tolunay).
--
-- ОТКАТ: вернуть определение из блока «-- rollback» в конце файла.

create or replace view public.v_external_rates_latest as
with recursive pairs as (
  -- первая пара по индексу (source, pair, fetched_at DESC)
  (select source, pair from public.external_rates order by source, pair limit 1)
  union all
  -- и дальше «следующая за текущей» — по одному seek на итерацию
  select nxt.source, nxt.pair
  from pairs p
  cross join lateral (
    select e.source, e.pair
    from public.external_rates e
    where (e.source, e.pair) > (p.source, p.pair)
    order by e.source, e.pair
    limit 1
  ) nxt
)
select p.source,
       p.pair,
       l.bid,
       l.ask,
       l.mid,
       l.fetched_at
from pairs p
cross join lateral (
  select e.bid, e.ask, e.mid, e.fetched_at
  from public.external_rates e
  where e.source = p.source and e.pair = p.pair
  order by e.fetched_at desc
  limit 1
) l;

comment on view public.v_external_rates_latest is
  'Последняя котировка по каждой паре (source, pair). Рекурсивный skip-scan вместо DISTINCT ON: у DISTINCT ON нет loose index scan, и на 846 тыс. строк вьюха падала по statement timeout. Результат идентичен, план — 29 index seek вместо полного скана.';

-- rollback:
-- create or replace view public.v_external_rates_latest as
--  select distinct on (source, pair) source, pair, bid, ask, mid, fetched_at
--    from public.external_rates
--   order by source, pair, fetched_at desc;
