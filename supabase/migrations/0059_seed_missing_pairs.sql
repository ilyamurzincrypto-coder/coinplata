-- ============================================================================
-- CoinPlata · 0059_seed_missing_pairs.sql
--
-- Добавляем недостающие master pairs для работы с приоритетными валютами.
-- Каждая INSERT — master direction (по приоритету USDT=0, USD=1, TRY=2,
-- EUR=3, GBP=4, CHF=5, RUB=6). Reverse pair автоматом через trigger
-- sync_reverse_pair (0046).
--
-- Если pair уже существует — ON CONFLICT DO NOTHING (не перезаписываем
-- существующие base_rate).
--
-- Default base_rates примерные (рынок ноябрь 2024). Admin откорректирует
-- через DailyRatesModal/Quick.
-- ============================================================================

-- Гарантируем currencies существуют
insert into public.currencies (code, type, symbol, name, decimals, active)
values
  ('USDT', 'crypto', '₮', 'Tether USD', 2, true),
  ('USD',  'fiat',   '$', 'US Dollar', 2, true),
  ('EUR',  'fiat',   '€', 'Euro', 2, true),
  ('TRY',  'fiat',   '₺', 'Turkish Lira', 2, true),
  ('GBP',  'fiat',   '£', 'British Pound', 2, true),
  ('CHF',  'fiat',   'Fr', 'Swiss Franc', 2, true),
  ('RUB',  'fiat',   '₽', 'Russian Ruble', 2, true)
on conflict (code) do nothing;

-- Insert master pairs (priority direction). Если уже есть — пропускаем.
do $seed$
declare
  v_pair record;
  v_admin_id uuid;
begin
  -- Берём любого admin/owner для updated_by (или null если нет)
  select id into v_admin_id from public.users
    where role in ('owner', 'admin') limit 1;

  for v_pair in
    select * from (values
      -- Master direction: priority(from) < priority(to)
      ('USDT'::text, 'USD'::text,  1.0::numeric),
      ('USDT'::text, 'TRY'::text,  44.6::numeric),
      ('USDT'::text, 'EUR'::text,  0.85::numeric),
      ('USDT'::text, 'GBP'::text,  0.78::numeric),
      ('USDT'::text, 'CHF'::text,  0.88::numeric),
      ('USDT'::text, 'RUB'::text,  92.0::numeric),
      ('USD'::text,  'TRY'::text,  44.6::numeric),
      ('USD'::text,  'EUR'::text,  0.85::numeric),
      ('USD'::text,  'GBP'::text,  0.78::numeric),
      ('USD'::text,  'CHF'::text,  0.88::numeric),
      ('USD'::text,  'RUB'::text,  92.0::numeric),
      ('TRY'::text,  'EUR'::text,  0.0191::numeric),
      ('TRY'::text,  'GBP'::text,  0.0175::numeric),
      ('TRY'::text,  'CHF'::text,  0.0197::numeric),
      ('TRY'::text,  'RUB'::text,  2.06::numeric),
      ('EUR'::text,  'GBP'::text,  0.92::numeric),
      ('EUR'::text,  'CHF'::text,  1.04::numeric),
      ('EUR'::text,  'RUB'::text,  108.0::numeric),
      ('GBP'::text,  'CHF'::text,  1.13::numeric),
      ('GBP'::text,  'RUB'::text,  117.0::numeric),
      ('CHF'::text,  'RUB'::text,  104.0::numeric)
    ) as t(from_cur, to_cur, base_rate)
  loop
    -- Master pair (from→to)
    if not exists (
      select 1 from public.pairs
      where from_currency = v_pair.from_cur
        and to_currency = v_pair.to_cur
        and is_default
    ) then
      insert into public.pairs (
        from_currency, to_currency, base_rate, spread_percent,
        is_default, is_master, priority, updated_by
      ) values (
        v_pair.from_cur, v_pair.to_cur, v_pair.base_rate, 0,
        true, true, 50, v_admin_id
      );
      raise notice 'INSERTED master %→% base=%', v_pair.from_cur, v_pair.to_cur, v_pair.base_rate;
    end if;

    -- Reverse pair (to→from). Trigger sync_reverse_pair мог бы её
    -- создать на следующем UPDATE master, но создаём вручную сейчас
    -- чтобы reverse сразу была доступна.
    if not exists (
      select 1 from public.pairs
      where from_currency = v_pair.to_cur
        and to_currency = v_pair.from_cur
        and is_default
    ) then
      insert into public.pairs (
        from_currency, to_currency, base_rate, spread_percent,
        is_default, is_master, priority, updated_by
      ) values (
        v_pair.to_cur, v_pair.from_cur, 1.0 / v_pair.base_rate, 0,
        true, false, 50, v_admin_id
      );
      raise notice 'INSERTED reverse %→% base=%',
        v_pair.to_cur, v_pair.from_cur, 1.0 / v_pair.base_rate;
    end if;
  end loop;
end
$seed$;

-- Проверка
select 'After seed:' as info;
select from_currency, to_currency, base_rate, is_master
  from public.pairs
  where is_default = true
  order by is_master desc, from_currency, to_currency;
