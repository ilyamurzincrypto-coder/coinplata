-- ============================================================================
-- CoinPlata · 0031_create_pair_rpc.sql
--
-- RPC create_pair для надёжного добавления pair из UI (Coverage panel
-- quick-add, Edit rates → Add pair). Раньше фронтенд делал прямой
-- INSERT в public.pairs, но RLS policy ref_write_admin (0001) требует
-- f_role() in ('owner','admin'). Если session user'а по какой-то причине
-- не резолвится в public.users.role (например stale auth token или
-- недоприменённая миграция users table) — INSERT молча фейлился,
-- frontend warn'ил в console, pair оставался только в local state →
-- после refresh loadPairs() возвращал из БД без этой пары → пара
-- "пропадала" при обновлении страницы.
--
-- Fix: security-definer RPC обходит RLS, явно проверяет права caller'а
-- и бросает понятные exceptions (frontend покажет toast).
-- Также allow'им accountant (финансовая роль, логично).
-- ============================================================================

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
  v_caller_role text;
  v_from text := upper(trim(coalesce(p_from, '')));
  v_to   text := upper(trim(coalesce(p_to, '')));
  v_pair_id uuid;
  v_existing_default boolean;
begin
  -- Caller auth
  select role into v_caller_role
    from public.users where id = auth.uid();
  if v_caller_role not in ('owner','admin','accountant') then
    raise exception 'Only owner/admin/accountant can create pairs (caller=%)',
      coalesce(v_caller_role, 'null')
      using errcode = '42501';
  end if;

  if v_from = '' or v_to = '' then
    raise exception 'from/to currencies required' using errcode = '22000';
  end if;
  if v_from = v_to then
    raise exception 'from and to must differ' using errcode = '22000';
  end if;
  if p_base_rate is null or p_base_rate <= 0 then
    raise exception 'base_rate must be > 0' using errcode = '22000';
  end if;

  -- Validate currencies exist
  if not exists (select 1 from public.currencies where code = v_from) then
    raise exception 'Unknown currency: %', v_from using errcode = '22000';
  end if;
  if not exists (select 1 from public.currencies where code = v_to) then
    raise exception 'Unknown currency: %', v_to using errcode = '22000';
  end if;

  -- Если default pair (from,to) уже есть — вставляем как non-default
  select exists(
    select 1 from public.pairs
    where from_currency = v_from and to_currency = v_to and is_default
  ) into v_existing_default;

  insert into public.pairs (
    from_currency, to_currency, base_rate, spread_percent,
    is_default, priority, updated_by
  ) values (
    v_from, v_to, p_base_rate, coalesce(p_spread, 0),
    not v_existing_default, coalesce(p_priority, 50), auth.uid()
  )
  returning id into v_pair_id;

  return v_pair_id;
end;
$func$;

grant execute on function public.create_pair(text, text, numeric, numeric, smallint) to authenticated;
