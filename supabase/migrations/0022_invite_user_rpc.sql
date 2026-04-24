-- ============================================================================
-- CoinPlata · 0022_invite_user_rpc.sql
--
-- Фикс критического бага: кого бы admin ни инвайтил, в public.users роль
-- оказывалась manager.
--
-- Причина — поломка срабатывала в двух сценариях:
--   (a) Повторный инвайт: email уже есть в auth.users → signInWithOtp
--       (shouldCreateUser:true) НЕ делает INSERT → trigger 0007
--       on_auth_user_created не срабатывает → роль в public.users остаётся
--       какой была при первом создании (обычно default 'manager').
--   (b) Legacy юзеры: создавались до 0005/0007 или напрямую в auth.users
--       (например через Supabase Dashboard → Invite) — public.users row
--       уже есть с role='manager' default'ом, и никакой apsert из
--       pending_invites её не перезаписывал.
--
-- Fix: security-definer RPC invite_user. Атомарно делает ДВЕ вещи:
--   1. upsert pending_invites (на случай first-time — триггер 0007 прочитает)
--   2. если public.users для email УЖЕ существует — update role/name/office
--      прямо сейчас (обходит RLS, работает для всех cases).
--
-- Плюс одноразовый backfill: синкаем уже созданных public.users с
-- непогашенными pending_invites (чинит уже застрявших юзеров).
-- ============================================================================

-- 1. RPC invite_user -----------------------------------------------------------

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
  v_email_lower text := lower(trim(coalesce(p_email, '')));
  v_full_name   text := trim(coalesce(p_full_name, ''));
begin
  if v_email_lower = '' then
    raise exception 'Email is required' using errcode = '22000';
  end if;
  if v_full_name = '' then
    raise exception 'Full name is required' using errcode = '22000';
  end if;

  -- Caller — только owner/admin могут инвайтить
  select role into v_caller_role
    from public.users where id = auth.uid();
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only owner/admin can invite users (caller=%)',
      coalesce(v_caller_role, 'null')
      using errcode = '42501';
  end if;

  -- Role validation
  if p_role not in ('owner','admin','accountant','manager') then
    raise exception 'Invalid role: %', p_role using errcode = '22000';
  end if;
  if p_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'Only owner can promote to owner' using errcode = '42501';
  end if;

  -- (1) Upsert pending_invites — для first-time flow. Triger 0007 при
  --     первом INSERT в auth.users прочитает роль отсюда.
  insert into public.pending_invites (email, full_name, role, office_id, invited_by)
  values (v_email_lower, v_full_name, p_role, p_office_id, auth.uid())
  on conflict (email) do update
    set full_name  = excluded.full_name,
        role       = excluded.role,
        office_id  = excluded.office_id,
        invited_by = excluded.invited_by;

  -- (2) Если public.users row для email уже существует — синкаем роль
  --     прямо сейчас. Это решает случай когда auth.users уже был создан
  --     (повторный инвайт / legacy) и trigger не сработает.
  select id into v_existing_id
    from public.users
    where lower(email) = v_email_lower
    limit 1;

  if v_existing_id is not null then
    update public.users
      set role      = p_role,
          full_name = v_full_name,
          office_id = case when p_office_id is not null
                           then p_office_id else office_id end
      where id = v_existing_id;
  end if;

  return v_existing_id;
end;
$func$;

grant execute on function public.invite_user(text, text, text, uuid) to authenticated;

-- 2. Одноразовый backfill ------------------------------------------------------
-- Синкаем любых уже созданных public.users у которых есть pending_invite.
-- Не удаляем pending_invites — триггер 0007 удалит их при successful signup
-- (или они останутся безобидной историей, email-PK дедуплицирует повторные
-- инвайты).

update public.users u
   set role      = pi.role,
       full_name = pi.full_name,
       office_id = coalesce(pi.office_id, u.office_id)
  from public.pending_invites pi
 where lower(u.email) = lower(pi.email)
   and (u.role      is distinct from pi.role
     or u.full_name is distinct from pi.full_name);
