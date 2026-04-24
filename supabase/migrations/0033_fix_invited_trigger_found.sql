-- ============================================================================
-- CoinPlata · 0033_fix_invited_trigger_found.sql
--
-- Коренной баг в 0007_invited_status.sql on_auth_user_created():
--
--   select * into v_invite from public.pending_invites where ...;
--   if v_invite is not null then ...
--
-- На RECORD-типах `IS NOT NULL` возвращает TRUE только если ВСЕ поля
-- non-null. pending_invites имеет nullable office_id и invited_by —
-- значит v_invite с office_id=NULL всегда даёт IS NOT NULL=FALSE,
-- даже когда SELECT реально нашёл row. Функция уходит в else-ветку
-- и создаёт юзера с role='manager' (default fallback) вместо
-- использования роли из pending_invites.
--
-- Fix: используем FOUND — стандартный PL/pgSQL индикатор "SELECT INTO
-- нашёл хотя бы одну строку". Правильный и надёжный способ.
--
-- После apply: новые invite'ы корректно создают public.users с той
-- ролью, которая была указана в pending_invites.
-- ============================================================================

create or replace function public.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_invite record;
begin
  select * into v_invite
    from public.pending_invites
    where lower(email) = lower(new.email);

  -- FOUND правильно индицирует "нашли row", независимо от null-полей
  if FOUND then
    insert into public.users (id, full_name, email, role, office_id, status, activated_at)
    values (
      new.id,
      v_invite.full_name,
      new.email,
      v_invite.role,
      v_invite.office_id,
      'invited',
      null
    )
    on conflict (id) do update
      set full_name = excluded.full_name,
          role = excluded.role,
          office_id = excluded.office_id,
          status = 'invited',
          activated_at = null;

    delete from public.pending_invites where lower(email) = lower(new.email);
  else
    -- Не приглашённый (не должно случаться при invite-only flow) —
    -- создаём с безопасным default'ом.
    insert into public.users (id, full_name, email, role, status, activated_at)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', new.email),
      new.email,
      'manager',
      'invited',
      null
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$BODY$;
