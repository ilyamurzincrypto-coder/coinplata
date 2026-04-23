-- ============================================================================
-- CoinPlata · 0006_confirm_rates_hotfix.sql
-- Делаем confirm_rates защищённой от:
--   (1) auth.uid() не существует в public.users (пользователь аутентифицирован
--       но профиля нет) → FK violation в rate_snapshots.created_by
--   (2) office_id NULL или не UUID — RPC игнорирует некорректный office_id
--   (3) pairs пустой — пишем пустой snapshot (всё равно запись факта подтверждения)
-- ============================================================================

create or replace function public.confirm_rates(p_office_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_snapshot_id uuid;
  v_rates jsonb := '{}'::jsonb;
  v_user_id uuid;
  v_office_id uuid;
  v_pairs_count integer := 0;
  p record;
begin
  -- auth.uid() → только если есть запись в public.users (FK safety).
  -- Иначе created_by = NULL.
  v_user_id := auth.uid();
  if v_user_id is not null and not exists (
    select 1 from public.users where id = v_user_id
  ) then
    v_user_id := null;
  end if;

  -- office_id — только если существует (FK safety). Иначе NULL.
  v_office_id := null;
  if p_office_id is not null and exists (
    select 1 from public.offices where id = p_office_id
  ) then
    v_office_id := p_office_id;
  end if;

  -- Собираем снимок активных default-пар
  for p in select from_currency, to_currency, rate from public.pairs where is_default loop
    v_rates := v_rates || jsonb_build_object(p.from_currency || '_' || p.to_currency, p.rate);
    v_pairs_count := v_pairs_count + 1;
  end loop;

  insert into public.rate_snapshots (office_id, created_by, reason, rates, pairs_count)
  values (v_office_id, v_user_id, p_reason, v_rates, v_pairs_count)
  returning id into v_snapshot_id;

  return v_snapshot_id;
end;
$BODY$;

grant execute on function public.confirm_rates(uuid, text) to authenticated;
