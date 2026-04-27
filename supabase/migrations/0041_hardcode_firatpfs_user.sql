-- ============================================================================
-- CoinPlata · 0041_hardcode_firatpfs_user.sql
--
-- Юзер firatpfs@gmail.com был зареган в забагованной версии (до фиксов
-- invite-flow / password gating). admin_set_password из UsersTab не
-- помогает, magic-link тоже не залогинивает корректно.
--
-- Жёстко выставляем:
--   • auth.users.encrypted_password = bcrypt('123456789')
--   • auth.users.email_confirmed_at = now() (если ещё NULL)
--   • public.users: status='active', password_set=true, activated_at=now()
--   • удаляем pending_invites (если осталась запись)
--
-- После apply юзер логинится: email = firatpfs@gmail.com, password = 123456789.
-- При первом входе он МОЖЕТ сменить пароль через ProfileMenu → Change password.
-- (password_set=true, поэтому SetPasswordPage не форсится — это сознательно,
-- юзер должен иметь возможность спокойно войти).
-- ============================================================================

create extension if not exists pgcrypto;

do $fix$
declare
  v_email text := 'firatpfs@gmail.com';
  v_pass  text := '123456789';
  v_auth_id uuid;
  v_full_name text;
  v_role text;
begin
  -- Находим auth.users row по email
  select id, raw_user_meta_data->>'full_name'
    into v_auth_id, v_full_name
    from auth.users
    where lower(email) = lower(v_email)
    limit 1;

  if v_auth_id is null then
    raise exception 'auth.users row для % не найдена — юзер ещё ни разу не подтверждал email', v_email;
  end if;

  -- Достаём role из public.users / pending_invites (priority: existing public.users)
  select role into v_role
    from public.users
    where id = v_auth_id
    limit 1;

  if v_role is null then
    select role, full_name into v_role, v_full_name
      from public.pending_invites
      where lower(email) = lower(v_email)
      limit 1;
  end if;

  v_role := coalesce(v_role, 'manager');
  v_full_name := coalesce(nullif(trim(v_full_name), ''), 'Firat');

  -- 1. Обновляем encrypted_password + confirm email
  update auth.users
    set encrypted_password = crypt(v_pass, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_auth_id;

  -- 2. public.users — create or update
  insert into public.users (id, full_name, email, role, status, activated_at, password_set)
  values (v_auth_id, v_full_name, v_email, v_role, 'active', now(), true)
  on conflict (id) do update
    set full_name = coalesce(nullif(excluded.full_name, ''), public.users.full_name),
        email = excluded.email,
        role = coalesce(public.users.role, excluded.role),
        status = 'active',
        activated_at = coalesce(public.users.activated_at, now()),
        password_set = true,
        invite_token = null;

  -- 3. Чистим pending_invites
  delete from public.pending_invites where lower(email) = lower(v_email);

  raise notice 'firatpfs@gmail.com: auth_id=%, role=%, password set, status=active, password_set=true',
    v_auth_id, v_role;
end
$fix$;

-- Проверка
select u.id, u.full_name, u.email, u.role, u.status, u.password_set,
       (au.encrypted_password is not null and au.encrypted_password <> '') as has_password,
       au.email_confirmed_at
  from public.users u
  join auth.users au on au.id = u.id
  where lower(u.email) = 'firatpfs@gmail.com';
