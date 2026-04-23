-- ============================================================================
-- CoinPlata · 0016_missing_direct_pairs.sql
--
-- Добавляем прямые пары которые были убраны в 0014 (когда полностью заменили
-- все demo-пары на 20 из Excel). Нужны для сделок USD↔EUR, USD↔GBP, EUR↔GBP,
-- USDT↔USD напрямую (без triangulation через TRY).
--
-- Значения derived из существующих через USDT/USD; их можно вручную поправить
-- в Edit rates → конкретный pair.
--
-- Применять в Supabase SQL Editor одним блоком. DELETE отрабатывает только
-- те пары что вставляем ниже — не трогает 20 пар из 0014.
-- ============================================================================

-- 1. Удаляем только те default-пары что собираемся вставить (idempotent)
delete from public.pairs
where is_default
  and (from_currency, to_currency) in (
    ('USDT','USD'), ('USD','USDT'),
    ('USD','EUR'),  ('EUR','USD'),
    ('USD','GBP'),  ('GBP','USD'),
    ('EUR','GBP'),  ('GBP','EUR'),
    ('CHF','USD'),  ('USD','CHF'),
    ('CHF','EUR'),  ('EUR','CHF'),
    ('CHF','GBP'),  ('GBP','CHF'),
    ('RUB','USD'),  ('USD','RUB'),
    ('RUB','EUR'),  ('EUR','RUB'),
    ('RUB','GBP'),  ('GBP','RUB')
  );

-- 2. Вставляем
insert into public.pairs (from_currency, to_currency, base_rate, spread_percent, is_default, priority) values
  -- USDT ↔ USD (прямой стабильный курс)
  ('USDT', 'USD',  0.9985,   0, true, 10),
  ('USD',  'USDT', 1.0015,   0, true, 10),

  -- USD ↔ EUR
  ('USD', 'EUR',   0.8677,   0, true, 10),
  ('EUR', 'USD',   1.1515,   0, true, 10),

  -- USD ↔ GBP
  ('USD', 'GBP',   0.7596,   0, true, 10),
  ('GBP', 'USD',   1.3295,   0, true, 10),

  -- EUR ↔ GBP
  ('EUR', 'GBP',   0.8766,   0, true, 10),
  ('GBP', 'EUR',   1.5748,   0, true, 10),

  -- CHF ↔ USD / EUR / GBP
  ('CHF', 'USD',   1.2617,   0, true, 10),
  ('USD', 'CHF',   0.7801,   0, true, 10),
  ('CHF', 'EUR',   1.0935,   0, true, 10),
  ('EUR', 'CHF',   0.9144,   0, true, 10),
  ('CHF', 'GBP',   0.9610,   0, true, 10),
  ('GBP', 'CHF',   1.0405,   0, true, 10),

  -- RUB ↔ USD / EUR / GBP
  ('RUB', 'USD',   0.01287,  0, true, 10),
  ('USD', 'RUB',   77.7588,  0, true, 10),
  ('RUB', 'EUR',   0.01118,  0, true, 10),
  ('EUR', 'RUB',   89.5530,  0, true, 10),
  ('RUB', 'GBP',   0.00968,  0, true, 10),
  ('GBP', 'RUB',   103.3050, 0, true, 10);

-- Проверка (опционально):
--   select from_currency, to_currency, rate
--     from public.pairs where is_default
--     order by from_currency, to_currency;
--   select count(*) from public.pairs where is_default;  -- было 20, станет 40
