-- ============================================================================
-- CoinPlata · 0047_priority_usdt_first.sql
--
-- Меняем приоритет валют для master direction: теперь USDT первый,
-- т.к. это наш мост между фиатом и криптой. Юзер ожидает увидеть
-- курсы как USDT → USD, USDT → TRY, USDT → EUR (USDT база).
--
-- Старый priority (0046): USD=1, USDT=2, EUR=3, GBP=4, CHF=5, TRY=6, RUB=7.
-- Новый priority:         USDT=0, USD=1, TRY=2, EUR=3, GBP=4, CHF=5, RUB=6.
--
-- Что делаем:
--   1. Re-backfill is_master по новому приоритету.
--   2. Принудительная синхронизация reverse pairs от нового master.
--   3. Обновить create_pair RPC: автоматом is_master + auto-создание
--      reverse pair если её нет (master без зеркала бесполезен).
-- ============================================================================

-- 1. Re-backfill is_master с новым приоритетом
do $rebackfill$
begin
  update public.pairs set is_master = false;

  update public.pairs p
    set is_master = true
    where p.is_default = true
      and (
        (case upper(p.from_currency)
           when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
           when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end)
        <
        (case upper(p.to_currency)
           when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
           when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end)
        or (
          (case upper(p.from_currency)
             when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
             when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end)
          =
          (case upper(p.to_currency)
             when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
             when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end)
          and p.from_currency < p.to_currency
        )
      );

  raise notice 'Re-backfill is_master done with new priority (USDT first)';
end
$rebackfill$;

-- 2. Forced sync reverse pairs from new master.
--    После смены master direction, reverse pairs могут содержать stale
--    данные. Пересчитываем все reverse = 1/master.base_rate.
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

-- 3. Расширенный create_pair: автоматически ставит is_master по приоритету
--    и создаёт reverse pair если её нет. Trigger sync_reverse_pair (0046)
--    подхватит при последующих апдейтах.

drop function if exists public.create_pair(text, text, numeric, numeric, smallint);

create function public.create_pair(
  p_from       text,
  p_to         text,
  p_base_rate  numeric,
  p_spread     numeric  default 0,
  p_priority   smallint default 50
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['accountant','admin','owner']);
  v_from text := upper(trim(coalesce(p_from, '')));
  v_to   text := upper(trim(coalesce(p_to, '')));
  v_pair_id uuid;
  v_existing_default boolean;
  v_from_prio int;
  v_to_prio int;
  v_is_master boolean;
  v_master_from text;
  v_master_to text;
  v_master_rate numeric;
  v_spread numeric := coalesce(p_spread, 0);
begin
  if v_from = '' or v_to = '' then
    raise exception 'from/to currencies required' using errcode = '22000';
  end if;
  if v_from = v_to then
    raise exception 'from and to must differ' using errcode = '22000';
  end if;
  if p_base_rate is null or p_base_rate <= 0 then
    raise exception 'base_rate must be > 0' using errcode = '22000';
  end if;

  if not exists (select 1 from public.currencies where code = v_from) then
    raise exception 'Unknown currency: %', v_from using errcode = '22000';
  end if;
  if not exists (select 1 from public.currencies where code = v_to) then
    raise exception 'Unknown currency: %', v_to using errcode = '22000';
  end if;

  -- Определяем master direction по приоритету
  v_from_prio := case v_from
    when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
    when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;
  v_to_prio := case v_to
    when 'USDT' then 0 when 'USD' then 1 when 'TRY' then 2 when 'EUR' then 3
    when 'GBP'  then 4 when 'CHF' then 5 when 'RUB' then 6 else 99 end;

  if v_from_prio < v_to_prio or (v_from_prio = v_to_prio and v_from < v_to) then
    v_is_master := true;
    v_master_from := v_from;
    v_master_to := v_to;
    v_master_rate := p_base_rate;
  else
    v_is_master := false;
    v_master_from := v_to;
    v_master_to := v_from;
    -- Инвертируем base_rate чтобы master хранился в priority direction
    v_master_rate := 1.0 / p_base_rate;
  end if;

  -- Проверяем — есть ли уже default pair в этом направлении
  select exists(
    select 1 from public.pairs
    where from_currency = v_from and to_currency = v_to and is_default
  ) into v_existing_default;

  -- INSERT переданной пары
  insert into public.pairs (
    from_currency, to_currency, base_rate, spread_percent,
    is_default, is_master, priority, updated_by
  ) values (
    v_from, v_to, p_base_rate, v_spread,
    not v_existing_default, v_is_master, coalesce(p_priority, 50), auth.uid()
  )
  returning id into v_pair_id;

  -- Если переданная пара была master — auto-создаём reverse если ещё нет
  -- Если переданная пара была reverse — auto-создаём master если ещё нет
  if v_is_master then
    -- Master inserted, ensure reverse exists
    if not exists (
      select 1 from public.pairs
      where from_currency = v_to and to_currency = v_from and is_default
    ) then
      insert into public.pairs (
        from_currency, to_currency, base_rate, spread_percent,
        is_default, is_master, priority, updated_by
      ) values (
        v_to, v_from, 1.0 / p_base_rate, v_spread,
        true, false, coalesce(p_priority, 50), auth.uid()
      );
    end if;
  else
    -- Reverse inserted — ensure master exists; если нет, создаём с
    -- инвертированным rate. Trigger sync_reverse_pair потом синхронизирует
    -- любые updates обратно в reverse.
    if not exists (
      select 1 from public.pairs
      where from_currency = v_master_from and to_currency = v_master_to and is_default
    ) then
      insert into public.pairs (
        from_currency, to_currency, base_rate, spread_percent,
        is_default, is_master, priority, updated_by
      ) values (
        v_master_from, v_master_to, v_master_rate, v_spread,
        true, true, coalesce(p_priority, 50), auth.uid()
      );
    end if;
  end if;

  return v_pair_id;
end;
$func$;

grant execute on function public.create_pair(text, text, numeric, numeric, smallint) to authenticated;

-- Проверка
select from_currency, to_currency, base_rate, spread_percent, is_master
  from public.pairs
  where is_default = true
  order by is_master desc, from_currency, to_currency;
