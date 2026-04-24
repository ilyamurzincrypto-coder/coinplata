-- ============================================================================
-- CoinPlata · 0018_admin_user_update_rpc.sql
--
-- Security-definer RPC для смены role / office_id / full_name у пользователя.
-- Обходит RLS policies (которые из-за кэша f_role() могли silently отбивать
-- update'ы), явно проверяет права caller'а и даёт понятные ошибки.
--
-- Симптом который чинит: owner/admin меняет role юзера → UI показывает
-- новое значение → refresh → role откатывается к старому. Теперь UPDATE
-- идёт через RPC с явными raise exception, если что-то не так — frontend
-- покажет toast с реальной причиной.
-- ============================================================================

drop function if exists public.admin_update_user(uuid, text, uuid, text);

create function public.admin_update_user(
  p_user_id uuid,
  p_role    text default null,
  p_office_id uuid default null,
  p_full_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text;
  v_target_role text;
begin
  -- 1. Права caller'а — только owner/admin могут менять других.
  select role into v_caller_role
    from public.users where id = auth.uid();
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only owner/admin can update users (caller=%)', coalesce(v_caller_role, 'null')
      using errcode = '42501';
  end if;

  -- 2. Target существует
  select role into v_target_role from public.users where id = p_user_id;
  if not found then
    raise exception 'User % not found', p_user_id using errcode = 'P0002';
  end if;

  -- 3. Promote to owner — только действующий owner имеет это право.
  if p_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'Only owner can promote to owner' using errcode = '42501';
  end if;

  -- 4. Role validation
  if p_role is not null and p_role not in ('owner','admin','accountant','manager') then
    raise exception 'Invalid role: %', p_role using errcode = '22000';
  end if;

  -- 5. Apply updates (coalesce — null значит "не менять")
  update public.users set
    role      = coalesce(p_role, role),
    office_id = case when p_office_id is not null then p_office_id
                     else office_id end,
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name)
  where id = p_user_id;
end;
$func$;

grant execute on function public.admin_update_user(uuid, text, uuid, text) to authenticated;

-- Тесты (manual):
--   select role from public.users where email='8989580@gmail.com';  -- было
--   select public.admin_update_user('<uuid>', 'owner', null, null);
--   select role from public.users where email='8989580@gmail.com';  -- теперь 'owner'
