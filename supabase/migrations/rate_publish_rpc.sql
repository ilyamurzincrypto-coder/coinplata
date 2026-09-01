-- rate_publish_rpc.sql — публикация версии прайса (фаза 2а, PR-A).
--
-- ТЕНЕВОЙ РЕЖИМ: функция пишет настоящие версии в rate_publications, но НИКУДА
-- их не отправляет. Моста ещё нет, каналы читают старый путь. Снятие тени —
-- отдельная работа фазы 2.
--
-- Порядок ровно такой и не меняется:
--   1. границы band_pct против последней публикации → нарушения списком,
--      НИЧЕГО не пишется;
--   2. свежесть external_rates для auto-блоков (порог 2 часа) → протухшие
--      провайдеры перечисляются в ошибке;
--   3. расчёт (клиент прислал уже посчитанный prices тем же rateEngine);
--   4. insert с version + 1.
--
-- Почему расчёт не дублируется в SQL: единственный источник формул —
-- src/lib/rateEngine.js. Вторая реализация на plpgsql разошлась бы с первой
-- в первый же месяц. RPC проверяет ГРАНИЦЫ и СВЕЖЕСТЬ (это данные, а не
-- формулы) и фиксирует результат атомарно.

create or replace function public.get_published_rates()
returns jsonb
language sql
stable
as $$
  select case when p.id is null then null else jsonb_build_object(
    'version', p.version,
    'published_at', p.published_at,
    'prices', p.prices,
    'inputs', p.inputs,
    'source_meta', p.source_meta
  ) end
  from (select * from public.rate_publications order by version desc limit 1) p;
$$;

comment on function public.get_published_rates is
  'Последняя опубликованная версия: {version, published_at, prices, inputs, source_meta}. inputs — введённые значения и замки, от них стартует черновик следующего дня. null — публикаций ещё нет.';

-- ВАЖНО: inputs добавлен 2026-09-01, после публикации v.1. Без него редактор
-- не видел вчерашних значений и на следующее утро показывал пустые поля —
-- наследование «не тронутое уходит вчерашним значением» держится на нём.

create or replace function public.publish_rates(
  p_inputs      jsonb,   -- сырые введённые значения (для «Было» и воспроизводимости)
  p_prices      jsonb,   -- плоский прайс от rateEngine: [{block,scope,from,to,rate}]
  p_source_meta jsonb default '{}'::jsonb,
  p_max_age_min integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user      uuid := auth.uid();
  v_prev      public.rate_publications%rowtype;
  v_prev_map  jsonb := '{}'::jsonb;
  v_viol      jsonb := '[]'::jsonb;
  v_stale     jsonb := '[]'::jsonb;
  v_next      integer;
  v_id        uuid;
  r           record;
  v_key       text;
  v_prev_rate numeric;
  v_dev       numeric;
begin
  if v_user is not null and not exists (select 1 from public.users where id = v_user) then
    v_user := null;
  end if;

  if p_prices is null or jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) = 0 then
    return jsonb_build_object('ok', false, 'error', 'prices пуст — публиковать нечего');
  end if;

  -- ── 1. Границы band_pct против последней публикации ────────────────────
  select * into v_prev from public.rate_publications order by version desc limit 1;

  if found then
    select coalesce(jsonb_object_agg(
             (e->>'block') || '|' || coalesce(e->>'scope','') || '|' || (e->>'from') || '|' || (e->>'to'),
             (e->>'rate')::numeric), '{}'::jsonb)
      into v_prev_map
    from jsonb_array_elements(v_prev.prices) e;
  end if;

  for r in
    select (e->>'block') as block, e->>'scope' as scope,
           (e->>'from') as from_ccy, (e->>'to') as to_ccy,
           (e->>'rate')::numeric as rate
    from jsonb_array_elements(p_prices) e
  loop
    v_key := r.block || '|' || coalesce(r.scope,'') || '|' || r.from_ccy || '|' || r.to_ccy;
    v_prev_rate := nullif(v_prev_map ->> v_key, '')::numeric;

    -- Первая публикация строки границу не нарушает: сравнивать не с чем.
    if v_prev_rate is not null and v_prev_rate <> 0 then
      v_dev := (r.rate / v_prev_rate - 1) * 100;
      if abs(v_dev) > coalesce((
            select rr.band_pct from public.rate_rows rr
            join public.rate_blocks bb on bb.id = rr.block_id
            where bb.code = r.block
              and coalesce(rr.scope,'') = coalesce(r.scope,'')
              and rr.from_ccy = r.from_ccy and rr.to_ccy = r.to_ccy
            limit 1), 5) then
        v_viol := v_viol || jsonb_build_object(
          'key', v_key, 'block', r.block, 'scope', r.scope,
          'from', r.from_ccy, 'to', r.to_ccy,
          'rate', r.rate, 'previous', v_prev_rate,
          'deviation_pct', round(v_dev, 4));
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_viol) > 0 then
    return jsonb_build_object('ok', false, 'error', 'границы нарушены', 'violations', v_viol);
  end if;

  -- ── 2. Свежесть источников для auto-блоков ─────────────────────────────
  -- Протухшее молча не берём: цена вчерашнего ЦБ выглядит как сегодняшняя.
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', x.provider,
           'fetched_at', x.fetched_at,
           'age_min', round(extract(epoch from (now() - x.fetched_at)) / 60))), '[]'::jsonb)
    into v_stale
  from (
    select b.config->>'provider' as provider,
           (select max(er.fetched_at) from public.external_rates er
             where er.source = b.config->>'provider') as fetched_at
    from public.rate_blocks b
    where b.enabled and b.kind = 'auto' and b.config ? 'provider'
      and exists (select 1 from jsonb_array_elements(p_prices) e where e->>'block' = b.code)
  ) x
  where x.fetched_at is null
     or x.fetched_at < now() - make_interval(mins => p_max_age_min);

  if jsonb_array_length(v_stale) > 0 then
    return jsonb_build_object('ok', false, 'error', 'источник устарел', 'stale', v_stale);
  end if;

  -- ── 3. Версия и запись ─────────────────────────────────────────────────
  select coalesce(max(version), 0) + 1 into v_next from public.rate_publications;

  insert into public.rate_publications (version, inputs, prices, source_meta, created_by)
  values (v_next, coalesce(p_inputs, '{}'::jsonb), p_prices, coalesce(p_source_meta, '{}'::jsonb), v_user)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_next,
                            'prices_count', jsonb_array_length(p_prices));
end;
$$;

comment on function public.publish_rates is
  'Публикация версии прайса. Порядок: границы band_pct → свежесть external_rates (auto-блоки) → insert version+1. При нарушении возвращает {ok:false} со списком и НЕ пишет. ТЕНЕВОЙ РЕЖИМ: наружу ничего не уходит, моста нет.';

revoke all on function public.publish_rates(jsonb, jsonb, jsonb, integer) from public;
grant execute on function public.publish_rates(jsonb, jsonb, jsonb, integer) to authenticated;
grant execute on function public.get_published_rates() to authenticated, anon;
