-- ============================================================================
-- CoinPlata · 0060_independent_buy_rate.sql
--
-- Допускает независимый reverse rate (buy) в дополнение к master (sell).
-- Раньше reverse был чисто вычисленный (1/master через trigger). Теперь
-- admin может задать его вручную в Quick как отдельный sell/buy.
--
-- Расширяем import_rates: если в row передано поле "buy_rate", после
-- сохранения master (sell) делаем явный UPDATE reverse pair.base_rate.
-- Trigger sync_reverse_pair всё равно срабатывает first и пишет
-- reverse=1/master, но наш последующий UPDATE его override'ит.
--
-- Без поля buy_rate import_rates работает как раньше — auto-derive
-- reverse через trigger.
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
  v_buy_rate numeric;
  v_master_from text;
  v_master_to text;
  v_master_rate numeric;
  v_reverse_rate numeric;
  v_master_id uuid;
  v_existing_id uuid;
  v_updated int := 0;
  v_inserted int := 0;
  v_current_rates jsonb;
  v_total_pairs int;
  v_from_prio int;
  v_to_prio int;
  v_input_is_master boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array';
  end if;

  -- Snapshot
  select
    jsonb_object_agg(from_currency || '_' || to_currency, rate),
    count(*)
  into v_current_rates, v_total_pairs
  from public.pairs where is_default;

  insert into public.rate_snapshots (office_id, created_by, reason, rates, pairs_count)
  values (null, v_user, coalesce(p_reason, 'xlsx import'), coalesce(v_current_rates, '{}'::jsonb), coalesce(v_total_pairs, 0))
  returning id into v_snapshot_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_from := upper(trim(v_row->>'from'));
    v_to   := upper(trim(v_row->>'to'));
    v_rate := (v_row->>'rate')::numeric;
    -- Optional: explicit buy rate для независимой обратной стороны
    v_buy_rate := nullif(v_row->>'buy_rate', '')::numeric;

    if v_from is null or v_to is null or v_from = '' or v_to = '' or v_from = v_to then
      raise exception 'Invalid row: from=% to=% rate=%', v_from, v_to, v_rate;
    end if;
    if v_rate is null or v_rate <= 0 then
      raise exception 'Invalid rate for %/%: %', v_from, v_to, v_rate;
    end if;
    if v_buy_rate is not null and v_buy_rate <= 0 then
      raise exception 'Invalid buy_rate for %/%: %', v_from, v_to, v_buy_rate;
    end if;

    if not exists (select 1 from public.currencies where code = v_from) then
      raise exception 'Unknown currency: %', v_from;
    end if;
    if not exists (select 1 from public.currencies where code = v_to) then
      raise exception 'Unknown currency: %', v_to;
    end if;

    -- Master direction
    v_from_prio := case v_from
      when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
      when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;
    v_to_prio := case v_to
      when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
      when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;

    v_input_is_master := (v_from_prio < v_to_prio)
      or (v_from_prio = v_to_prio and v_from < v_to);

    if v_input_is_master then
      v_master_from := v_from;
      v_master_to := v_to;
      v_master_rate := v_rate;       -- sell input
      v_reverse_rate := v_buy_rate;  -- buy input (для reverse direction)
    else
      -- Input is reverse direction → инвертируем
      v_master_from := v_to;
      v_master_to := v_from;
      v_master_rate := 1.0 / v_rate;
      v_reverse_rate := v_buy_rate;  -- buy уже в reverse direction (= what user set)
    end if;

    -- Find or create master
    select id into v_master_id
      from public.pairs
      where from_currency = v_master_from
        and to_currency = v_master_to
        and is_default = true
      limit 1;

    if v_master_id is null then
      insert into public.pairs (
        from_currency, to_currency, base_rate, spread_percent,
        is_default, is_master, priority, updated_by
      ) values (
        v_master_from, v_master_to, v_master_rate, 0,
        true, true, 50, v_user
      ) returning id into v_master_id;
      v_inserted := v_inserted + 1;
      -- Auto-create reverse row
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
      update public.pairs
        set base_rate = v_master_rate,
            updated_at = now(),
            updated_by = v_user,
            is_master = true
        where id = v_master_id;
      v_updated := v_updated + 1;
    end if;

    -- Если задан явный buy_rate — обновляем reverse pair после trigger.
    -- Trigger sync_reverse_pair уже сработал и записал reverse=1/master.
    -- Наш UPDATE override'ит её на admin's buy value.
    if v_reverse_rate is not null and v_reverse_rate > 0 then
      update public.pairs
        set base_rate = v_reverse_rate,
            updated_at = now(),
            updated_by = v_user
        where from_currency = v_master_to
          and to_currency = v_master_from
          and is_default = true;
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
