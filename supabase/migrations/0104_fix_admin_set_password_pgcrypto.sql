-- ============================================================================
-- CoinPlata · 0104_fix_admin_set_password_pgcrypto.sql
--
-- Баг: Settings → Users → Change password падал с
--   "function gen_salt(unknown) does not exist · No function matches the
--    given name and argument types. You might need to add explicit type casts."
--
-- Root cause:
--   В миграции 0040 функция admin_set_password объявлена с
--     SET search_path = public
--   В Supabase pgcrypto по дефолту устанавливается в схему `extensions`,
--   не в `public`. Внутри тела функции search_path = public + pg_catalog,
--   поэтому gen_salt / crypt из extensions невидимы → RPC падал.
--   (Сравн. с миграцией 0032: там pgcrypto вызывался из DO-блока, у которого
--    search_path берётся из роли — там `extensions` присутствует, поэтому
--    однократный fix для Ризы прошёл, а универсальный RPC — нет.)
--
-- Fix: квалифицируем вызовы pgcrypto через `extensions.` явно. Это
--   рекомендованный Supabase подход для security-definer функций —
--   не зависит от того, что лежит в search_path, и не требует широкого
--   search_path. Тело функции в остальном идентично 0040.
-- ============================================================================

-- На случай свежего env: убеждаемся что pgcrypto установлен именно в extensions.
-- В Supabase это default — но миграция должна быть идемпотентной.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_set_password(
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  v_caller_role text;
  v_target_email text;
begin
  -- Caller role check
  select role into v_caller_role
    from public.users where id = auth.uid();
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only owner/admin can set passwords (caller=%)',
      coalesce(v_caller_role, 'null')
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'user_id required' using errcode = '22000';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters'
      using errcode = '22000';
  end if;

  -- Target должен существовать в auth.users
  select email into v_target_email
    from auth.users where id = p_user_id;
  if v_target_email is null then
    raise exception 'auth.users row % not found', p_user_id
      using errcode = '22000';
  end if;

  -- 1. Запись в auth.users.encrypted_password через bcrypt.
  --    Квалификация extensions.crypt/extensions.gen_salt — главный фикс
  --    этой миграции (см. шапку).
  update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = p_user_id;

  -- 2. public.users — отмечаем что пароль установлен и юзер активен
  update public.users
    set status = case when status = 'disabled' then status else 'active' end,
        password_set = true,
        activated_at = coalesce(activated_at, now()),
        invite_token = null
    where id = p_user_id;

  -- 3. Чистим pending_invites
  delete from public.pending_invites
    where lower(email) = lower(v_target_email);
end;
$func$;

grant execute on function public.admin_set_password(uuid, text) to authenticated;
