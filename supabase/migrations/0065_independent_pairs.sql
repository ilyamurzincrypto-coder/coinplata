-- ============================================================================
-- CoinPlata · 0065_independent_pairs.sql
--
-- АРХИТЕКТУРНАЯ СМЕНА: убираем auto-sync триггер sync_reverse_pair.
-- Master и reverse pairs теперь полностью НЕЗАВИСИМЫ.
--
-- До этого:
--   • Триггер копировал base_rate (= 1/master) и spread_percent в reverse
--     при любом UPDATE master.
--   • Юзер: "меняю sell spread на -0.2, buy тоже меняется — это бред".
--   • reverse_locked флаг помогал только для base_rate, spread всё равно
--     синхронизировался → buy.rate = (1/base) * (1+spread/100) шевелился.
--
-- Теперь:
--   • update_pair изменяет ТОЛЬКО переданную пару (без инверсии в master).
--   • Если admin вызывает update_pair(USDT, USD, ...) — обновляется
--     только row USDT→USD. Reverse USD→USDT остаётся как есть.
--   • Чтобы синхронизировать вручную, admin может вызвать оба раза.
--
-- create_pair (0047) при INSERT уже создаёт обе стороны — это начальная
-- синхронизация. После создания они независимы.
--
-- import_rates: оставляем поведение buy_rate (если задан) — независимое
-- сохранение reverse. Без buy_rate — пишется только master, reverse не
-- трогается (раньше триггер сам подхватывал, теперь нет — но import_rates
-- сам пишет master+reverse explicitly как был и до 0060).
-- ============================================================================

-- 1. Drop trigger and trigger function
drop trigger if exists trg_sync_reverse_pair on public.pairs;
drop function if exists public.sync_reverse_pair();

-- 2. Replace update_pair — теперь просто UPDATE переданной пары.
--    Без инверсии в master, без secondary updates.
drop function if exists public.update_pair(text, text, numeric, numeric, numeric);
drop function if exists public.update_pair(text, text, numeric, numeric);

create function public.update_pair(
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
begin
  select id into v_pair_id
    from public.pairs
    where from_currency = upper(p_from)
      and to_currency = upper(p_to)
      and is_default = true
    limit 1;

  if v_pair_id is null then
    raise exception 'No default pair for % → %', p_from, p_to using errcode = 'P0002';
  end if;

  -- Просто обновляем переданную пару. Никакой синхронизации reverse.
  update public.pairs
    set base_rate = coalesce(p_base_rate, base_rate),
        spread_percent = coalesce(p_spread, spread_percent),
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_pair_id;
end;
$func$;

grant execute on function public.update_pair(text, text, numeric, numeric) to authenticated;

-- 3. Replace import_rates — больше не зависит от триггера. Master и reverse
--    пишутся explicitly. buy_rate (опц.) overrides reverse, иначе reverse
--    пишется как 1/master (legacy default — sane initial value).
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
      v_master_rate := v_rate;
      v_reverse_rate := v_buy_rate;
    else
      v_master_from := v_to;
      v_master_to := v_from;
      v_master_rate := 1.0 / v_rate;
      v_reverse_rate := v_buy_rate;
    end if;

    -- Master upsert
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
    else
      update public.pairs
        set base_rate = v_master_rate,
            updated_at = now(),
            updated_by = v_user,
            is_master = true
        where id = v_master_id;
      v_updated := v_updated + 1;
    end if;

    -- Reverse: если задан buy_rate — пишем его. Иначе — НЕ трогаем reverse
    -- (триггер больше не подхватит автоматически, чтобы дать independent
    -- sell/buy). Если reverse не существует — создаём с 1/master как
    -- starter value, admin потом может изменить.
    if v_reverse_rate is not null and v_reverse_rate > 0 then
      update public.pairs
        set base_rate = v_reverse_rate,
            updated_at = now(),
            updated_by = v_user
        where from_currency = v_master_to
          and to_currency = v_master_from
          and is_default = true;
      -- Если reverse не существует — создадим
      if not found then
        insert into public.pairs (
          from_currency, to_currency, base_rate, spread_percent,
          is_default, is_master, priority, updated_by
        ) values (
          v_master_to, v_master_from, v_reverse_rate, 0,
          true, false, 50, v_user
        );
      end if;
    else
      -- Если reverse pair вообще не существует — создаём starter с 1/master
      if not exists (
        select 1 from public.pairs
        where from_currency = v_master_to
          and to_currency = v_master_from
          and is_default = true
      ) then
        insert into public.pairs (
          from_currency, to_currency, base_rate, spread_percent,
          is_default, is_master, priority, updated_by
        ) values (
          v_master_to, v_master_from, 1.0 / v_master_rate, 0,
          true, false, 50, v_user
        );
      end if;
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

-- 4. Cleanup: reverse_locked column больше не используется (всё разделено
--    архитектурно). Не дропаем чтобы не сломать legacy данные, но
--    игнорируем в новом коде.

select 'Migration 0065 applied: independent pairs, sync_reverse_pair removed' as status;
