-- ============================================================================
-- CoinPlata · 0049_import_rates_master_aware.sql
--
-- КОРЕНЬ БАГА "1000 USDT → 1185 EUR":
--
-- import_rates (0015) писала напрямую в pairs.base_rate любой записи
-- найденной по (from, to), ИГНОРИРУЯ is_master. Если админ через
-- DailyRatesModal/Quick вводил курс в reverse direction (например
-- "EUR→USDT = 1.185"), функция писала в reverse row, а master НЕ
-- синхронизировался → pairs рассинхрон → форма сделки показывает
-- неправильный курс.
--
-- Сценарий:
--   1. Admin вводит "1.185" для EUR→USDT (думая "1 EUR = 1.185 USDT"
--      — что верно).
--   2. import_rates пишет EUR→USDT.base_rate = 1.185.
--   3. Trigger sync_reverse_pair (0046) ничего не делает — он
--      срабатывает только при UPDATE master (is_master=true).
--   4. Master USDT→EUR остаётся со старым (или дефолтным) base_rate.
--   5. Форма сделки делает 1000 USDT × master.rate = неправильный итог.
--
-- ФИКС: переписываю import_rates чтобы для каждого row находить master
-- и обновлять ИМЕННО его — с инверсией base_rate если admin указал
-- reverse direction. Trigger sync_reverse дальше синхронизирует
-- reverse автоматически.
-- ============================================================================

drop function if exists public.import_rates(jsonb, text);

create function public.import_rates(
  p_rows jsonb,
  p_reason text default 'xlsx import'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_user uuid := auth.uid();
  v_snapshot_id uuid;
  v_row jsonb;
  v_from text;
  v_to text;
  v_rate numeric;
  v_master_from text;
  v_master_to text;
  v_master_rate numeric;
  v_master_id uuid;
  v_pair_is_master boolean;
  v_existing_id uuid;
  v_updated int := 0;
  v_inserted int := 0;
  v_current_rates jsonb;
  v_total_pairs int;
  v_from_prio int;
  v_to_prio int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array';
  end if;

  -- 1. Snapshot текущих default пар
  select
    jsonb_object_agg(from_currency || '_' || to_currency, rate),
    count(*)
  into v_current_rates, v_total_pairs
  from public.pairs
  where is_default;

  insert into public.rate_snapshots (office_id, created_by, reason, rates, pairs_count)
  values (null, v_user, coalesce(p_reason, 'xlsx import'), coalesce(v_current_rates, '{}'::jsonb), coalesce(v_total_pairs, 0))
  returning id into v_snapshot_id;

  -- 2. Цикл по новым строкам с master-aware логикой
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_from := upper(trim(v_row->>'from'));
    v_to   := upper(trim(v_row->>'to'));
    v_rate := (v_row->>'rate')::numeric;

    if v_from is null or v_to is null or v_from = '' or v_to = '' or v_from = v_to then
      raise exception 'Invalid row: from=% to=% rate=%', v_from, v_to, v_rate;
    end if;
    if v_rate is null or v_rate <= 0 then
      raise exception 'Invalid rate for %/%: %', v_from, v_to, v_rate;
    end if;

    if not exists (select 1 from public.currencies where code = v_from) then
      raise exception 'Unknown currency: %', v_from;
    end if;
    if not exists (select 1 from public.currencies where code = v_to) then
      raise exception 'Unknown currency: %', v_to;
    end if;

    -- Определяем master direction по приоритету
    -- (USDT=0, USD=1, TRY=2, EUR=3, GBP=4, CHF=5, RUB=6).
    -- Если переданное направление = master, обновляем base_rate как есть.
    -- Если переданное = reverse, инвертируем: master.base_rate = 1/p_rate.
    v_from_prio := case v_from
      when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
      when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;
    v_to_prio := case v_to
      when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
      when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;

    if v_from_prio < v_to_prio or (v_from_prio = v_to_prio and v_from < v_to) then
      -- Переданное направление = master
      v_master_from := v_from;
      v_master_to := v_to;
      v_master_rate := v_rate;
    else
      -- Переданное = reverse → master это противоположное направление,
      -- инвертируем rate.
      v_master_from := v_to;
      v_master_to := v_from;
      v_master_rate := 1.0 / v_rate;
    end if;

    -- Найти/создать master pair
    select id into v_master_id
      from public.pairs
      where from_currency = v_master_from
        and to_currency = v_master_to
        and is_default = true
      limit 1;

    if v_master_id is null then
      -- Master не найден — создаём как master
      insert into public.pairs (
        from_currency, to_currency, base_rate, spread_percent,
        is_default, is_master, priority, updated_by
      ) values (
        v_master_from, v_master_to, v_master_rate, 0,
        true, true, 50, v_user
      ) returning id into v_master_id;
      v_inserted := v_inserted + 1;
      -- Создаём reverse row если его нет (trigger sync будет её
      -- держать synced при будущих обновлениях master).
      if not exists (
        select 1 from public.pairs
        where from_currency = v_master_to and to_currency = v_master_from and is_default
      ) then
        insert into public.pairs (
          from_currency, to_currency, base_rate, spread_percent,
          is_default, is_master, priority, updated_by
        ) values (
          v_master_to, v_master_from, 1.0 / v_master_rate, 0,
          true, false, 50, v_user
        );
      end if;
    else
      -- Обновляем master.base_rate. Trigger sync_reverse_pair (0046)
      -- автоматически обновит reverse = 1/new_base_rate.
      update public.pairs
        set base_rate = v_master_rate,
            updated_at = now(),
            updated_by = v_user,
            -- Принудительно ставим is_master=true (если backfill 0046/0047
            -- по какой-то причине не отметил эту pair — фиксим прямо тут).
            is_master = true
        where id = v_master_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'updated', v_updated,
    'inserted', v_inserted,
    'snapshot_id', v_snapshot_id
  );
end;
$func$;

grant execute on function public.import_rates(jsonb, text) to authenticated;

-- Проверка: показать текущие default pairs после миграции
select from_currency, to_currency, base_rate, rate, is_master, is_default
  from public.pairs
  where is_default = true
  order by is_master desc, from_currency, to_currency;
