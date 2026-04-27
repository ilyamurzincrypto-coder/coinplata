-- ============================================================================
-- CoinPlata · 0039_password_set_flag.sql
--
-- Задача: 100% гарантировать, что пользователь, попавший в систему через
-- magic-link / invite / recovery, ВСЕГДА проходит SetPasswordPage перед
-- получением доступа к приложению.
--
-- До этого мы полагались только на status='invited'. Этого недостаточно
-- если у юзера status='active' (legacy / прошлый вход), а пароль он не
-- ставил — magic-link даст ему session, и AuthGate пустит в приложение.
--
-- Добавляем явный флаг password_set boolean. SetPasswordPage устанавливает
-- его в true после успешного auth.updateUser({password}). AuthGate
-- проверяет: password_set=false → SetPasswordPage (независимо от status).
--
-- Существующих active юзеров считаем password_set=true (они УЖЕ работают
-- в системе с известным паролем), кроме тех у кого encrypted_password
-- пустое в auth.users — для них password_set=false.
-- ============================================================================

alter table public.users
  add column if not exists password_set boolean not null default false;

-- Backfill для существующих юзеров: если в auth.users есть encrypted_password
-- — считаем что пароль уже установлен.
update public.users u
   set password_set = true
  from auth.users au
  where au.id = u.id
    and au.encrypted_password is not null
    and au.encrypted_password <> ''
    and u.status = 'active';

-- Триггер on_auth_user_created (0033) уже создаёт row со status='invited',
-- password_set по default = false — менять триггер не нужно.

-- invite_user RPC (0030): при re-invite сбрасываем password_set=false,
-- чтобы юзер заново прошёл SetPasswordPage.
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
                              else null end,
          password_set = case when v_existing_status = 'disabled'
                              then password_set
                              else false end
      where id = v_existing_id;
  end if;

  return v_existing_id;
end;
$func$;

grant execute on function public.invite_user(text, text, text, uuid) to authenticated;

-- mark_password_set: SetPasswordPage вызывает после auth.updateUser({password}).
-- Атомарно ставит password_set=true, status='active', activated_at=now()
-- для текущего auth.uid(). RLS users_update_self_or_admin это покрывает,
-- но через RPC мы гарантируем правильную семантику + устойчивость к
-- расширению политик.
create or replace function public.mark_password_set()
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.users
    set password_set = true,
        status = case when status = 'disabled' then status else 'active' end,
        activated_at = coalesce(activated_at, now())
    where id = v_uid;
end;
$func$;

grant execute on function public.mark_password_set() to authenticated;

-- Проверка
select id, full_name, email, role, status, password_set
  from public.users
  order by created_at desc
  limit 20;
