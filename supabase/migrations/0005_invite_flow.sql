-- ============================================================================
-- CoinPlata · 0005_invite_flow.sql
-- Admin может инвайтить пользователей по email через UI без service_role.
--
-- Flow:
--   1. Admin в UsersTab жмёт "Invite" → frontend upsert'ит pending_invites
--      (email, full_name, role) + вызывает supabase.auth.signInWithOtp
--      с shouldCreateUser=true.
--   2. Supabase создаёт auth.users + шлёт magic-link на email.
--   3. Trigger on_auth_user_created срабатывает на INSERT в auth.users:
--      смотрит pending_invites по email → создаёт public.users с ролью.
--   4. При клике по magic-link → активная сессия, кассир попадает в систему.
-- ============================================================================

-- 1. Таблица отложенных приглашений
create table if not exists public.pending_invites (
  email          text primary key,
  full_name      text not null,
  role           text not null default 'manager'
                 check (role in ('owner','admin','accountant','manager')),
  office_id      uuid references public.offices(id),
  invited_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists pending_invites_created_idx
  on public.pending_invites(created_at desc);

-- 2. RLS: admin/owner могут писать/читать приглашения
alter table public.pending_invites enable row level security;

drop policy if exists "pending_invites_read" on public.pending_invites;
create policy "pending_invites_read"
  on public.pending_invites for select
  to authenticated
  using (public.f_role() in ('owner','admin'));

drop policy if exists "pending_invites_insert" on public.pending_invites;
create policy "pending_invites_insert"
  on public.pending_invites for insert
  to authenticated
  with check (public.f_role() in ('owner','admin'));

drop policy if exists "pending_invites_update" on public.pending_invites;
create policy "pending_invites_update"
  on public.pending_invites for update
  to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));

drop policy if exists "pending_invites_delete" on public.pending_invites;
create policy "pending_invites_delete"
  on public.pending_invites for delete
  to authenticated
  using (public.f_role() in ('owner','admin'));

-- 3. Trigger-функция: при insert в auth.users создаёт public.users.
--    Если email есть в pending_invites — использует роль оттуда и удаляет invite.
--    Если нет — создаёт profile как 'manager' без office (безопасный default;
--    admin может потом обновить через UsersTab).
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
    insert into public.users (id, full_name, email, role, office_id, status, activated_at)
    values (
      new.id,
      v_invite.full_name,
      new.email,
      v_invite.role,
      v_invite.office_id,
      'active',
      now()
    )
    on conflict (id) do update
      set full_name = excluded.full_name,
          role = excluded.role,
          office_id = excluded.office_id,
          status = 'active',
          activated_at = now();

    delete from public.pending_invites where lower(email) = lower(new.email);
  else
    -- Нет pending_invite: создаём профиль как 'manager' без office.
    -- Admin может поменять роль через UsersTab.
    insert into public.users (id, full_name, email, role, status, activated_at)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', new.email),
      new.email,
      'manager',
      'active',
      now()
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$BODY$;

-- 4. Ставим trigger на auth.users INSERT.
--    Удаляем старый если был.
drop trigger if exists auth_user_created_trigger on auth.users;
create trigger auth_user_created_trigger
  after insert on auth.users
  for each row execute procedure public.on_auth_user_created();
