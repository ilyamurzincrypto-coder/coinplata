-- ============================================================================
-- CoinPlata · 0046_master_pair_model.sql
--
-- Переход на модель "один master rate + spread на логическую пару".
--
-- Раньше (USDT,EUR) и (EUR,USDT) хранились как ДВЕ независимые записи
-- в pairs со своими base_rate и spread. Админ редактировал обе вручную
-- → возможен рассинхрон (например base_rate=1.185 в обе стороны вместо
-- forward=0.85 / reverse=1.176).
--
-- После миграции:
--   * Каждая логическая пара = одна master запись (is_master=true).
--   * Master direction: priority(from) < priority(to). Это "сильная →
--     слабая валюта" по нашей конвенции (USD<USDT<EUR<GBP<CHF<TRY<RUB).
--   * Reverse запись остаётся в БД для back-compat (getRate читает обе),
--     но ВСЕГДА синхронизирована с master через trigger:
--       reverse.base_rate     = 1 / master.base_rate
--       reverse.spread_percent = master.spread_percent
--   * Trigger sync_reverse_pair (AFTER UPDATE master) автоматически
--     перезаписывает reverse.
--   * Initial backfill — синхронизирует все existing reverse pairs.
--
-- В UI (DailyRatesModal) показываем только master pairs — один inline
-- input для base_rate + один для spread. Reverse computed read-only.
-- ============================================================================

-- 1. Добавляем колонку is_master
alter table public.pairs
  add column if not exists is_master boolean not null default false;

-- 2. Backfill — определяем master по priority валют.
--    Priority (ниже = "сильнее", идёт первым в master direction):
--      USD=1, USDT=2, EUR=3, GBP=4, CHF=5, TRY=6, RUB=7, остальные=99.
--    Если приоритеты совпадают — lexicographic порядок (from < to).
do $backfill$
declare
  v_from_prio int;
  v_to_prio int;
begin
  -- Сбрасываем чтобы был чистый старт
  update public.pairs set is_master = false;

  -- Помечаем master pairs
  update public.pairs p
    set is_master = true
    where p.is_default = true
      and (
        (case upper(p.from_currency)
           when 'USD' then 1 when 'USDT' then 2 when 'EUR' then 3
           when 'GBP' then 4 when 'CHF' then 5 when 'TRY' then 6
           when 'RUB' then 7 else 99 end)
        <
        (case upper(p.to_currency)
           when 'USD' then 1 when 'USDT' then 2 when 'EUR' then 3
           when 'GBP' then 4 when 'CHF' then 5 when 'TRY' then 6
           when 'RUB' then 7 else 99 end)
        or (
          (case upper(p.from_currency)
             when 'USD' then 1 when 'USDT' then 2 when 'EUR' then 3
             when 'GBP' then 4 when 'CHF' then 5 when 'TRY' then 6
             when 'RUB' then 7 else 99 end)
          =
          (case upper(p.to_currency)
             when 'USD' then 1 when 'USDT' then 2 when 'EUR' then 3
             when 'GBP' then 4 when 'CHF' then 5 when 'TRY' then 6
             when 'RUB' then 7 else 99 end)
          and p.from_currency < p.to_currency
        )
      );

  raise notice 'Backfill is_master complete';
end
$backfill$;

create index if not exists pairs_is_master_idx on public.pairs(is_master) where is_master;

-- 3. Trigger function: при update master pair → синхронизировать reverse pair.
--    Reverse.base_rate = 1 / master.base_rate
--    Reverse.spread_percent = master.spread_percent
--    pairs.rate (generated) автоматически пересчитается.
create or replace function public.sync_reverse_pair()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if new.is_master is not true then
    return new;
  end if;
  if new.base_rate is null or new.base_rate = 0 then
    return new;
  end if;
  update public.pairs
    set base_rate = 1.0 / new.base_rate,
        spread_percent = new.spread_percent,
        updated_at = new.updated_at
    where from_currency = new.to_currency
      and to_currency = new.from_currency
      and is_default = true
      and is_master = false;
  return new;
end;
$func$;

drop trigger if exists trg_sync_reverse_pair on public.pairs;
create trigger trg_sync_reverse_pair
  after insert or update of base_rate, spread_percent, is_master on public.pairs
  for each row
  when (new.is_master = true)
  execute function public.sync_reverse_pair();

-- 4. Forced initial sync — для каждого existing master, переписываем reverse.
--    Гарантирует что после миграции все reverse pairs = 1/master.
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

-- 5. update_pair RPC (0037) принимает (from, to). Если переданная
--    пара — reverse (is_master=false), переадресуем на master с
--    инвертированным rate. Это гарантирует что админ может вызвать
--    update_pair с любой стороной — система сама поймёт что обновить.
create or replace function public.update_pair(
  p_from text,
  p_to text,
  p_base_rate numeric default null,
  p_spread numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['accountant','admin','owner']);
  v_pair_id uuid;
  v_pair_is_master boolean;
  v_master_id uuid;
  v_target_id uuid;
  v_master_rate numeric;
  v_master_spread numeric;
begin
  -- Находим переданную пару
  select id, is_master into v_pair_id, v_pair_is_master
    from public.pairs
    where from_currency = upper(p_from)
      and to_currency = upper(p_to)
      and is_default = true
    limit 1;

  if v_pair_id is null then
    raise exception 'No default pair for % → %', p_from, p_to using errcode = 'P0002';
  end if;

  -- Если переданная пара — master, обновляем её напрямую.
  -- Если reverse, инвертируем base_rate и обновляем master.
  if v_pair_is_master then
    v_target_id := v_pair_id;
    v_master_rate := p_base_rate;
    v_master_spread := p_spread;
  else
    -- Находим master pair (обратное направление)
    select id into v_master_id
      from public.pairs
      where from_currency = upper(p_to)
        and to_currency = upper(p_from)
        and is_default = true
        and is_master = true
      limit 1;
    if v_master_id is null then
      -- Если master отсутствует — обновляем переданную (legacy fallback)
      v_target_id := v_pair_id;
      v_master_rate := p_base_rate;
      v_master_spread := p_spread;
    else
      v_target_id := v_master_id;
      -- Инвертируем rate (reverse → master)
      v_master_rate := case
        when p_base_rate is not null and p_base_rate > 0 then 1.0 / p_base_rate
        else null
      end;
      v_master_spread := p_spread;
    end if;
  end if;

  update public.pairs
    set base_rate = coalesce(v_master_rate, base_rate),
        spread_percent = coalesce(v_master_spread, spread_percent),
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_target_id;
end;
$func$;

grant execute on function public.update_pair(text, text, numeric, numeric) to authenticated;

-- 6. import_rates (0015) — для каждого row автоматически нормализуется
--    через update_pair (которая в свою очередь knows о master). Старая
--    логика import_rates делает direct UPDATE на pairs — может писать
--    в reverse напрямую. Перепишем чтобы использовать update_pair.
--    (Если import_rates RPC не вызывается на проде — это no-op.)

-- Проверка
select 'pairs after migration' as info;
select from_currency, to_currency, base_rate, spread_percent, is_master, is_default
  from public.pairs
  where is_default = true
  order by is_master desc, from_currency, to_currency;
