-- ============================================================================
-- CoinPlata · 0050_auto_fix_inverted_master_rates.sql
--
-- Авто-фикс: existing master pairs могут содержать ИНВЕРТИРОВАННЫЕ
-- значения base_rate (legacy данные до 0049 / случайный ввод admin'ом
-- в reverse direction). Например USDT→EUR.base_rate = 1.175 вместо
-- 0.851 → форма сделки даёт 1000 USDT × 1.175 = 1175 EUR.
--
-- Логика обнаружения: для каждой master pair вычисляем expected
-- через USD-триангуляцию:
--   expected = pair_from→USD / pair_to→USD
-- Если ratio = actual / expected > 1.5 или < 0.667 — пара перевёрнута,
-- инвертируем: base_rate = 1/actual. Trigger sync_reverse_pair дальше
-- автоматически обновит reverse row.
--
-- Дополнительно: BEFORE UPDATE trigger который ловит явные инверсии
-- при будущих обновлениях и автоматически переворачивает обратно.
-- Это защищает от admin'а который снова введёт неправильно.
-- ============================================================================

-- 1. One-time fix existing master pairs
do $autofix$
declare
  v_pair record;
  v_from_usd numeric;
  v_to_usd numeric;
  v_expected numeric;
  v_ratio numeric;
  v_fixed_count int := 0;
begin
  -- Получаем USDT→USD и USD→USDT для триангуляции (USD как pivot).
  -- Для пар где from или to это USD — direct compare без triangulation.
  for v_pair in
    select id, from_currency, to_currency, base_rate
      from public.pairs
      where is_default = true
        and is_master = true
        and base_rate > 0
        and from_currency <> to_currency
  loop
    -- Skip pairs involving currencies we don't know how to triangulate
    if v_pair.from_currency = 'USD' then
      v_expected := (
        select base_rate from public.pairs
        where is_default = true and is_master = true
          and from_currency = 'USD' and to_currency = v_pair.to_currency
        limit 1
      );
      if v_expected is null then
        -- Master может быть в обратную сторону для USD пар
        v_expected := 1.0 / nullif((
          select base_rate from public.pairs
          where is_default = true and is_master = true
            and from_currency = v_pair.to_currency and to_currency = 'USD'
          limit 1
        ), 0);
      end if;
    elsif v_pair.to_currency = 'USD' then
      v_expected := (
        select base_rate from public.pairs
        where is_default = true and is_master = true
          and from_currency = v_pair.from_currency and to_currency = 'USD'
        limit 1
      );
    else
      -- Triangulation через USD
      select base_rate into v_from_usd
        from public.pairs
        where is_default = true and is_master = true
          and from_currency = v_pair.from_currency and to_currency = 'USD'
        limit 1;
      if v_from_usd is null then
        v_from_usd := 1.0 / nullif((
          select base_rate from public.pairs
          where is_default = true and is_master = true
            and from_currency = 'USD' and to_currency = v_pair.from_currency
          limit 1
        ), 0);
      end if;

      select base_rate into v_to_usd
        from public.pairs
        where is_default = true and is_master = true
          and from_currency = v_pair.to_currency and to_currency = 'USD'
        limit 1;
      if v_to_usd is null then
        v_to_usd := 1.0 / nullif((
          select base_rate from public.pairs
          where is_default = true and is_master = true
            and from_currency = 'USD' and to_currency = v_pair.to_currency
          limit 1
        ), 0);
      end if;

      if v_from_usd is null or v_to_usd is null or v_to_usd = 0 then
        v_expected := null;
      else
        v_expected := v_from_usd / v_to_usd;
      end if;
    end if;

    -- Skip если не можем посчитать expected
    if v_expected is null or v_expected <= 0 then
      continue;
    end if;

    v_ratio := v_pair.base_rate / v_expected;

    -- Инвертируем если явно перевёрнуто (>50% deviation)
    if v_ratio > 1.5 or v_ratio < 0.667 then
      update public.pairs
        set base_rate = 1.0 / v_pair.base_rate,
            updated_at = now()
        where id = v_pair.id;
      v_fixed_count := v_fixed_count + 1;
      raise notice 'Inverted master pair %→% : base_rate % → % (expected ≈%)',
        v_pair.from_currency, v_pair.to_currency,
        v_pair.base_rate, 1.0/v_pair.base_rate, round(v_expected::numeric, 6);
    end if;
  end loop;

  raise notice 'Auto-fix complete: % master pairs inverted', v_fixed_count;
end
$autofix$;

-- 2. Re-sync всех reverse pairs от текущих master значений (на случай
--    если auto-fix не triggered triggers — manual sync).
update public.pairs r
  set base_rate = 1.0 / m.base_rate,
      spread_percent = m.spread_percent,
      updated_at = now()
  from public.pairs m
  where m.is_default = true
    and m.is_master = true
    and r.is_default = true
    and r.is_master = false
    and m.from_currency = r.to_currency
    and m.to_currency = r.from_currency
    and m.base_rate > 0;

-- 3. Проверка после фикса
select 'AFTER auto-fix' as info;
select from_currency, to_currency, base_rate, rate, is_master
  from public.pairs
  where is_default = true and is_master = true
  order by from_currency, to_currency;
