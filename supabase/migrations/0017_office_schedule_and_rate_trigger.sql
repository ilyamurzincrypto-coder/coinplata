-- ============================================================================
-- CoinPlata · 0017_office_schedule_and_rate_trigger.sql
--
-- 1. Расширение offices для:
--    • working_hours_by_day jsonb — разные часы на каждый день (сокр. суббота)
--    • holidays date[] — дни когда офис не работает
--    • temp_closed_until timestamptz — временно закрыт до даты
--    • temp_closed_reason text — причина временного закрытия
--
-- 2. Trigger на pairs INSERT/UPDATE → автоматический snapshot в rate_snapshots.
--    Покрывает даже SQL-миграции (0014, 0016) и direct updates без RPC.
--    Пропускается если триггер был инициирован функцией (чтобы не было
--    рекурсии от import_rates / rpcUpdatePair которые сами пишут snapshot).
--
-- Применять в Supabase SQL Editor одним блоком. Безопасно при повторе.
-- ============================================================================

-- --- 1. Office расширение ---------------------------------------------------
alter table public.offices
  add column if not exists working_hours_by_day jsonb,
  add column if not exists holidays date[] not null default '{}',
  add column if not exists temp_closed_until    timestamptz,
  add column if not exists temp_closed_reason   text;

-- Helper: проверяет открыт ли офис в конкретный момент.
-- Учитывает: status, active, temp_closed_until, holidays, working_days,
-- working_hours_by_day (override) или working_hours (fallback).
-- Возвращает true если ОТКРЫТ.
create or replace function public.is_office_open_at(
  p_office_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
as $func$
declare
  v_office public.offices%rowtype;
  v_local_date date;
  v_local_time text;
  v_dow smallint;
  v_hours jsonb;
  v_per_day jsonb;
  v_start text;
  v_end text;
begin
  select * into v_office from public.offices where id = p_office_id;
  if not found then return false; end if;
  if v_office.status = 'closed' or not v_office.active then return false; end if;
  if v_office.temp_closed_until is not null and p_at <= v_office.temp_closed_until then
    return false;
  end if;

  -- Local date/time в таймзоне офиса
  v_local_date := (p_at at time zone v_office.timezone)::date;
  v_local_time := to_char((p_at at time zone v_office.timezone)::time, 'HH24:MI');

  -- Holiday?
  if v_office.holidays && array[v_local_date] then return false; end if;

  -- Day of week: 1=Mon ... 7=Sun (ISO)
  v_dow := extract(isodow from v_local_date)::smallint;
  if not (v_dow = any(v_office.working_days)) then return false; end if;

  -- Per-day override
  v_per_day := v_office.working_hours_by_day;
  v_hours := v_office.working_hours;
  if v_per_day is not null and v_per_day ? v_dow::text then
    v_hours := v_per_day -> v_dow::text;
    -- Если override null — закрыто в этот день
    if v_hours is null or v_hours = 'null'::jsonb then return false; end if;
  end if;

  v_start := v_hours ->> 'start';
  v_end   := v_hours ->> 'end';
  if v_start is null or v_end is null then return true; end if;

  return v_local_time >= v_start and v_local_time < v_end;
end;
$func$;

grant execute on function public.is_office_open_at(uuid, timestamptz) to authenticated;

-- --- 2. Auto-snapshot на изменения pairs ------------------------------------
-- Чтобы история курсов содержала ВСЕ изменения (включая SQL миграции,
-- direct updates, rpcUpdatePair и import_rates).

-- Защита от рекурсии: import_rates и rpcUpdatePair вызываются из RPC
-- которые сами уже пишут snapshot → игнорим через session flag.
-- Простая схема: временно отключаем триггер на уровне RPC через
-- set_config / current_setting. В нашем случае проще: просто проверяем
-- что reason нового snapshot'а не совпадает с pattern "rpc: ...".

create or replace function public.auto_snapshot_on_pair_change()
returns trigger
language plpgsql
security definer
as $func$
declare
  v_skip boolean;
  v_ratesmap jsonb;
  v_count int;
begin
  -- session flag "coinplata.skip_pair_snapshot" = 'true' → пропускаем
  -- (ставится в RPC которые пишут snapshot сами).
  begin
    v_skip := current_setting('coinplata.skip_pair_snapshot', true)::boolean;
  exception when others then
    v_skip := false;
  end;
  if v_skip is true then return coalesce(NEW, OLD); end if;

  -- Берём ТЕКУЩИЙ state всех default-pairs (после триггерного apply).
  select
    jsonb_object_agg(from_currency || '_' || to_currency, rate),
    count(*)
  into v_ratesmap, v_count
  from public.pairs
  where is_default;

  insert into public.rate_snapshots (created_by, reason, rates, pairs_count)
  values (
    null,
    case
      when TG_OP = 'INSERT' then 'auto: pair inserted ' || NEW.from_currency || '→' || NEW.to_currency
      when TG_OP = 'UPDATE' then 'auto: pair updated ' || NEW.from_currency || '→' || NEW.to_currency || ' rate=' || NEW.rate
      when TG_OP = 'DELETE' then 'auto: pair deleted ' || OLD.from_currency || '→' || OLD.to_currency
    end,
    coalesce(v_ratesmap, '{}'::jsonb),
    coalesce(v_count, 0)
  );
  return coalesce(NEW, OLD);
end;
$func$;

drop trigger if exists trg_auto_snapshot_on_pair_change on public.pairs;
create trigger trg_auto_snapshot_on_pair_change
after insert or update or delete on public.pairs
for each row
execute function public.auto_snapshot_on_pair_change();

-- Обновляем import_rates чтобы ставить session flag на время своей
-- работы — иначе триггер сработает на каждую строку вдобавок к snapshot'у
-- который пишет сам RPC (двойная запись).
create or replace function public.import_rates(
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
  -- Отключаем авто-триггер на время работы — сами пишем один snapshot
  perform set_config('coinplata.skip_pair_snapshot', 'true', true);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array';
  end if;

  select
    jsonb_object_agg(from_currency || '_' || to_currency, rate),
    count(*)
  into v_current_rates, v_total_pairs
  from public.pairs
  where is_default;

  insert into public.rate_snapshots (office_id, created_by, reason, rates, pairs_count)
  values (null, v_user, coalesce(p_reason, 'xlsx import'), coalesce(v_current_rates, '{}'::jsonb), coalesce(v_total_pairs, 0))
  returning id into v_snapshot_id;

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

-- Проверка:
--   select reason, pairs_count, created_at from public.rate_snapshots order by created_at desc limit 10;
--   update public.pairs set base_rate = 44.9300 where from_currency='USD' and to_currency='TRY';
--   -- теперь в rate_snapshots появится запись "auto: pair updated USD→TRY ..."
