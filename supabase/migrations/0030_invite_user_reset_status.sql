-- ============================================================================
-- CoinPlata · 0030_invite_user_reset_status.sql
--
-- Обновление invite_user (0022): при re-invite существующего public.users
-- сбрасываем status в 'invited' и activated_at в NULL. Раньше мы только
-- синкали role/full_name/office_id — если юзер был status='active' от
-- предыдущей регистрации, после нового invite он сразу попадал в
-- приложение (AuthGate видел profileStatus='active' → Root, а не
-- SetPasswordPage).
--
-- disabled юзеров не трогаем — invite для disabled не предусмотрен
-- (UsersTab этого не допустит UI-слоем).
-- ============================================================================

drop function if exists public.invite_user(text, text, text, uuid);

create function public.invite_user(
  p_email     text,
  p_full_name text,
  p_role      text default 'manager',
  p_office_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text;
  v_existing_id uuid;
  v_existing_status text;
  v_email_lower text := lower(trim(coalesce(p_email, '')));
  v_full_name   text := trim(coalesce(p_full_name, ''));
begin
  if v_email_lower = '' then
    raise exception 'Email is required' using errcode = '22000';
  end if;
  if v_full_name = '' then
    raise exception 'Full name is required' using errcode = '22000';
  end if;

  select role into v_caller_role
    from public.users where id = auth.uid();
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only owner/admin can invite users (caller=%)',
      coalesce(v_caller_role, 'null')
      using errcode = '42501';
  end if;

  if p_role not in ('owner','admin','accountant','manager') then
    raise exception 'Invalid role: %', p_role using errcode = '22000';
  end if;
  if p_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'Only owner can promote to owner' using errcode = '42501';
  end if;

  insert into public.pending_invites (email, full_name, role, office_id, invited_by)
  values (v_email_lower, v_full_name, p_role, p_office_id, auth.uid())
  on conflict (email) do update
    set full_name  = excluded.full_name,
        role       = excluded.role,
        office_id  = excluded.office_id,
        invited_by = excluded.invited_by;

  -- Существующий public.users — синкаем role/name/office + сбрасываем
  -- status='invited' и activated_at=null (если не disabled), чтобы
  -- AuthGate показал SetPasswordPage при следующем click по magic-link.
  select id, status into v_existing_id, v_existing_status
    from public.users
    where lower(email) = v_email_lower
    limit 1;

  if v_existing_id is not null then
    update public.users
      set role      = p_role,
          full_name = v_full_name,
          office_id = case when p_office_id is not null
                           then p_office_id else office_id end,
          status = case when v_existing_status = 'disabled'
                        then v_existing_status
                        else 'invited' end,
          activated_at = case when v_existing_status = 'disabled'
                              then activated_at
                              else null end
      where id = v_existing_id;
  end if;

  return v_existing_id;
end;
$func$;

grant execute on function public.invite_user(text, text, text, uuid) to authenticated;
