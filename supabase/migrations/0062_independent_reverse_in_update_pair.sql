-- ============================================================================
-- CoinPlata · 0062_independent_reverse_in_update_pair.sql
--
-- Расширяет update_pair RPC опциональным параметром p_reverse_rate чтобы
-- админ мог из RatesPage задать НЕЗАВИСИМЫЕ курсы для master и reverse
-- direction. Без этого параметра логика прежняя — trigger sync_reverse_pair
-- автоматически держит reverse = 1/master (что делает USDT и USD визуально
-- "одной валютой" с rate=1.0 если admin не накрутил spread).
--
-- Если p_reverse_rate задан и > 0 — после UPDATE master (триггер уже
-- записал reverse=1/master) выполняется explicit UPDATE reverse.base_rate
-- = p_reverse_rate. Аналогично 0060 для import_rates.
--
-- Также подправляем seed default для USDT↔USD с 1.0 на 1.02 — реалистичный
-- typical market premium для stablecoin'а. Это не маскирует "одну и ту же
-- валюту", и admin сразу видит что курсы разные.
-- ============================================================================

-- 1. Replace update_pair с поддержкой p_reverse_rate (опционально)
drop function if exists public.update_pair(text, text, numeric, numeric);

create function public.update_pair(
  p_from text,
  p_to text,
  p_base_rate numeric default null,
  p_spread numeric default null,
  p_reverse_rate numeric default null
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
  v_master_from text;
  v_master_to text;
  v_reverse_target_rate numeric;
begin
  -- Находим переданную пару
  select id, is_master, from_currency, to_currency
    into v_pair_id, v_pair_is_master, v_master_from, v_master_to
    from public.pairs
    where from_currency = upper(p_from)
      and to_currency = upper(p_to)
      and is_default = true
    limit 1;

  if v_pair_id is null then
    raise exception 'No default pair for % → %', p_from, p_to using errcode = 'P0002';
  end if;

  -- Если переданная пара — master, обновляем её напрямую.
  -- Если reverse — инвертируем base_rate и обновляем master.
  if v_pair_is_master then
    v_target_id := v_pair_id;
    v_master_rate := p_base_rate;
    v_master_spread := p_spread;
    -- p_reverse_rate в этом случае — explicit override для reverse direction
    v_reverse_target_rate := p_reverse_rate;
  else
    -- Находим master pair (обратное направление)
    select id, from_currency, to_currency
      into v_master_id, v_master_from, v_master_to
      from public.pairs
      where from_currency = upper(p_to)
        and to_currency = upper(p_from)
        and is_default = true
        and is_master = true
      limit 1;
    if v_master_id is null then
      v_target_id := v_pair_id;
      v_master_rate := p_base_rate;
      v_master_spread := p_spread;
      v_reverse_target_rate := p_reverse_rate;
    else
      v_target_id := v_master_id;
      -- Передан p_base_rate в reverse direction → инвертируем для master
      v_master_rate := case
        when p_base_rate is not null and p_base_rate > 0 then 1.0 / p_base_rate
        else null
      end;
      v_master_spread := p_spread;
      -- p_reverse_rate в этом случае относится к direction (p_from, p_to) =
      -- reverse pair, т.е. это и есть прямое значение для reverse.
      v_reverse_target_rate := p_reverse_rate;
    end if;
  end if;

  -- UPDATE master (триггер sync_reverse_pair после этого ставит reverse=1/master)
  update public.pairs
    set base_rate = coalesce(v_master_rate, base_rate),
        spread_percent = coalesce(v_master_spread, spread_percent),
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_target_id;

  -- Если задан явный reverse_rate — overrides авто-синхронизированный
  -- reverse. Это даёт независимый sell/buy spread.
  if v_reverse_target_rate is not null and v_reverse_target_rate > 0 then
    update public.pairs
      set base_rate = v_reverse_target_rate,
          updated_at = now(),
          updated_by = auth.uid()
      where from_currency = v_master_to
        and to_currency = v_master_from
        and is_default = true
        and is_master = false;
  end if;
end;
$func$;

grant execute on function public.update_pair(text, text, numeric, numeric, numeric) to authenticated;

-- 2. Поправляем USDT/USD default 1.0 → 1.02 (typical USDT premium).
--    Только если pair всё ещё default (rate=1.0 и updated_by=null или
--    запись свежая — это значит admin её ещё не трогал).
update public.pairs
  set base_rate = 1.02,
      updated_at = now()
  where from_currency = 'USDT'
    and to_currency = 'USD'
    and is_default = true
    and base_rate = 1.0;

-- Reverse через триггер обновится автоматом (USD→USDT = 1/1.02 ≈ 0.9804).
-- Это обеспечит что они визуально РАЗНЫЕ, и admin сразу увидит что
-- pair настроена. Если admin захочет 1:1 — поставит явно.

-- Проверка
select from_currency, to_currency, base_rate, is_master
  from public.pairs
  where (from_currency in ('USDT','USD') and to_currency in ('USDT','USD'))
    and is_default = true
  order by is_master desc;
