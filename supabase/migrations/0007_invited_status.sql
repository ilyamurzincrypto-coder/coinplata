-- ============================================================================
-- CoinPlata · 0007_invited_status.sql
-- Поправка к 0005: новый пользователь из pending_invites должен создаваться
-- со статусом 'invited' (а не 'active'), чтобы frontend мог показать ему
-- SetPasswordPage до пуска в систему.
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

  if v_invite is not null then
    -- Invited user → статус 'invited' + activated_at пока NULL.
    -- После клика по magic-link frontend показывает SetPasswordPage →
    -- после сохранения пароля статус переходит в 'active'.
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
    -- Не приглашённый (не должно случаться при invite-only) — создаём
    -- с безопасным default'ом.
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
