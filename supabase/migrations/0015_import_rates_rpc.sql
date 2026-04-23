-- ============================================================================
-- CoinPlata · 0015_import_rates_rpc.sql
--
-- RPC для atomic-импорта курсов из xlsx. На фронте парсим → валидируем →
-- получаем подтверждение пользователя → шлём jsonb с валидными парами.
--
-- Вход:
--   p_rows jsonb — массив [{from:"USD", to:"TRY", rate:44.9247}, ...]
--   p_reason text — audit reason
--
-- Действия:
--   1. Перед любыми изменениями — пишем snapshot в rate_snapshots (все
--      текущие is_default пары с current rate).
--   2. Для каждой строки:
--       - если есть default pair (from→to) → UPDATE base_rate
--       - иначе INSERT новую с is_default=true
--   3. Всё в одной транзакции (RPC = implicit tx). При любой ошибке —
--      rollback, включая snapshot.
--
-- Возвращает: { updated int, inserted int, snapshot_id uuid }
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
  v_existing_id uuid;
  v_updated int := 0;
  v_inserted int := 0;
  v_current_rates jsonb;
  v_total_pairs int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array';
  end if;

  -- 1. Snapshot текущих default пар (pairs_count + jsonb map)
  select
    jsonb_object_agg(from_currency || '_' || to_currency, rate),
    count(*)
  into v_current_rates, v_total_pairs
  from public.pairs
  where is_default;

  insert into public.rate_snapshots (office_id, created_by, reason, rates, pairs_count)
  values (null, v_user, coalesce(p_reason, 'xlsx import'), coalesce(v_current_rates, '{}'::jsonb), coalesce(v_total_pairs, 0))
  returning id into v_snapshot_id;

  -- 2. Цикл по новым строкам
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

    -- Validate currency exists
    if not exists (select 1 from public.currencies where code = v_from) then
      raise exception 'Unknown currency: %', v_from;
    end if;
    if not exists (select 1 from public.currencies where code = v_to) then
      raise exception 'Unknown currency: %', v_to;
    end if;

    -- UPDATE если default pair есть
    select id into v_existing_id
    from public.pairs
    where from_currency = v_from and to_currency = v_to and is_default
    limit 1;

    if v_existing_id is not null then
      update public.pairs
        set base_rate = v_rate,
            spread_percent = 0,
            updated_at = now(),
            updated_by = v_user
        where id = v_existing_id;
      v_updated := v_updated + 1;
    else
      insert into public.pairs (from_currency, to_currency, base_rate, spread_percent, is_default, priority, updated_by)
      values (v_from, v_to, v_rate, 0, true, 10, v_user);
      v_inserted := v_inserted + 1;
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
