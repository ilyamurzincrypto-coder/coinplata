-- ============================================================================
-- CoinPlata · 0032_hardcode_cpakseltom_user.sql
--
-- Одноразовая миграция — жёстко заводит конкретного юзера:
--   Name:     Риза
--   Email:    cpakseltom@gmail.com
--   Role:     manager
--   Status:   active
--   Password: 123456789
--
-- auth.users уже существует (id=6d7f3dcb-4352-422f-b023-b50b623d65a4),
-- email уже confirmed. Добиваем:
--   • public.users row (status=active, role=manager, full_name=Риза)
--   • auth.users.encrypted_password через pgcrypto crypt() + bcrypt salt
--   • чистим pending_invites
--
-- NB: пароль в plaintext в коде — не идеально. Это разовый fix потому
-- что invite-flow застрял. После применения юзер может войти через
-- email+password и поменять пароль через UI.
-- ============================================================================

-- pgcrypto extension (обычно уже включена в Supabase)
create extension if not exists pgcrypto;

do $fix$
declare
  v_auth_id uuid := '6d7f3dcb-4352-422f-b023-b50b623d65a4';
  v_email text := 'cpakseltom@gmail.com';
  v_pass text := '123456789';
begin
  -- Верифицируем auth.users существует с этим id/email
  if not exists (
    select 1 from auth.users
    where id = v_auth_id and lower(email) = lower(v_email)
  ) then
    raise exception 'auth.users row % / % not found', v_auth_id, v_email;
  end if;

  -- 1. public.users row — create or revive
  insert into public.users (id, full_name, email, role, status, activated_at)
  values (v_auth_id, 'Риза', v_email, 'manager', 'active', now())
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        status = 'active',
        activated_at = coalesce(public.users.activated_at, now());

  -- 2. Удаляем pending_invite если болтается
  delete from public.pending_invites where lower(email) = lower(v_email);

  -- 3. auth.users.encrypted_password — bcrypt hash.
  --    email_confirmed_at уже стоит, но на всякий случай coalesce.
  update auth.users
    set encrypted_password = crypt(v_pass, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_auth_id;

  raise notice 'User Риза (%) set: status=active, role=manager, password set',
    v_email;
end
$fix$;

-- Проверка
select u.id, u.full_name, u.email, u.role, u.status,
       (au.encrypted_password is not null) as has_password,
       au.email_confirmed_at
  from public.users u
  join auth.users au on au.id = u.id
  where lower(u.email) = 'cpakseltom@gmail.com';
