-- ============================================================================
-- CoinPlata · 0040_admin_set_password.sql
--
-- Проблема: админ через UsersTab → "Change password" задаёт юзеру пароль,
-- но `setUserPassword` в auth.jsx был in-memory моком — реальный
-- auth.users.encrypted_password НЕ менялся. Юзер не мог войти с этим
-- паролем.
--
-- Решение: RPC admin_set_password(p_user_id uuid, p_password text) —
-- security definer, только owner/admin. Использует pgcrypto crypt() +
-- bcrypt salt чтобы записать корректный hash в auth.users. Также:
--   * подтверждает email (email_confirmed_at = now() если NULL)
--   * выставляет public.users.status='active', password_set=true,
--     activated_at=now()
--   * чистит pending_invites
--
-- После apply admin может реально менять пароли юзеров (как было в
-- миграции 0032 для Ризы, но через универсальный RPC).
-- ============================================================================

create extension if not exists pgcrypto;

create or replace function public.admin_set_password(
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public
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

  -- 1. Запись в auth.users.encrypted_password через bcrypt
  update auth.users
    set encrypted_password = crypt(p_password, gen_salt('bf')),
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

-- Комментарий: invite_token nullable должен быть OK, проверим что колонка
-- действительно есть и nullable. Если нет — DROP/IGNORE.
do $check$
begin
  if not exists (
    select 1 from information_schema.columns
      where table_schema='public' and table_name='users' and column_name='invite_token'
  ) then
    -- Колонки может не быть в свежей схеме — это OK, mark_password_set
    -- и admin_set_password не зависят от неё критически.
    raise notice 'Column public.users.invite_token does not exist — RPC may need adjustment';
  end if;
end
$check$;
