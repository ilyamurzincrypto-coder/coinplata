-- ============================================================================
-- CoinPlata · 0014_real_rates_from_excel.sql
--
-- Замена demo-курсов на реальные из Excel. Добавляем CHF и RUB в currencies,
-- перезаписываем таблицу pairs на 20 пар из ТЗ.
--
-- ВАЖНО: значения ставятся прямо как есть, без 1/rate и пересчёта.
-- base_rate = rate из Excel; spread_percent = 0 ⇒ rate (generated) = base_rate.
--
-- Применять в Supabase SQL Editor одним запуском.
-- ============================================================================

-- 1. Добавить CHF и RUB (upsert, на случай если уже существуют)
insert into public.currencies (code, type, symbol, name, decimals, active) values
  ('CHF', 'fiat', 'CHF', 'Swiss Franc',   2, true),
  ('RUB', 'fiat', '₽',  'Russian Ruble',  2, true)
on conflict (code) do update set
  type     = excluded.type,
  symbol   = excluded.symbol,
  name     = excluded.name,
  decimals = excluded.decimals,
  active   = true;

-- 2. Очистить все текущие пары (на pairs нет FK от других таблиц — безопасно)
delete from public.pairs;

-- 3. Вставить 20 реальных пар из Excel.
--    Все is_default=true, priority=10, spread_percent=0.
insert into public.pairs (from_currency, to_currency, base_rate, spread_percent, is_default, priority) values
  -- ---------- CRYPTO (через USDT) ----------
  ('EUR',  'USDT', 1.1532,    0, true, 10),
  ('USDT', 'EUR',  1.1827,    0, true, 10),

  ('USDT', 'TRY',  44.0015,   0, true, 10),
  ('TRY',  'USDT', 45.1025,   0, true, 10),

  ('GBP',  'USDT', 1.3315,    0, true, 10),
  ('USDT', 'GBP',  1.3154,    0, true, 10),

  ('CHF',  'USDT', 1.2635,    0, true, 10),
  ('USDT', 'CHF',  1.2832,    0, true, 10),

  ('RUB',  'USDT', 78.6725,   0, true, 10),
  ('USDT', 'RUB',  77.1752,   0, true, 10),

  -- ---------- CASH (через TRY) ----------
  ('USD', 'TRY', 44.9247,    0, true, 10),
  ('TRY', 'USD', 44.9254,    0, true, 10),

  ('EUR', 'TRY', 52.6279,    0, true, 10),
  ('TRY', 'EUR', 52.6345,    0, true, 10),

  ('GBP', 'TRY', 60.3256,    0, true, 10),
  ('TRY', 'GBP', 60.6339,    0, true, 10),

  ('CHF', 'TRY', 56.5923,    0, true, 10),
  ('TRY', 'CHF', 57.0786,    0, true, 10),

  ('RUB', 'TRY', 1.717852,   0, true, 10),
  ('TRY', 'RUB', 1.751181,   0, true, 10);

-- 4. Проверка (опционально) — можно запустить отдельно в SQL editor:
--
--   select from_currency, to_currency, base_rate, rate
--     from public.pairs
--    order by from_currency, to_currency;
--
--   select count(*) from public.pairs;    -- ожидаем 20
--   select code, name from public.currencies where code in ('CHF', 'RUB');
