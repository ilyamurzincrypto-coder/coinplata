-- ============================================================================
-- CoinPlata · 0004_client_archive.sql
-- Мягкое удаление клиента (архивация) + безопасный hard-delete.
-- ============================================================================

-- 1. Новая колонка для архивации
alter table public.clients
  add column if not exists archived_at timestamptz;

create index if not exists clients_archived_idx
  on public.clients(archived_at)
  where archived_at is not null;

-- 2. Archive / unarchive RPC
-- Архивация — мягкое "удаление": клиент остаётся в таблице, но фильтруется
-- из active списка в UI. Может быть восстановлен в любой момент.
create or replace function public.archive_client(
  p_client_id uuid,
  p_archive boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $BODY$
begin
  update public.clients
    set archived_at = case when p_archive then coalesce(archived_at, now()) else null end
    where id = p_client_id;
  if not found then
    raise exception 'Client % not found', p_client_id;
  end if;
end;
$BODY$;

-- 3. Hard-delete RPC с защитой от удаления клиентов имеющих историю
-- Запрещено удалять если есть любая сделка (кроме уже удалённых).
-- Также удаляем привязанные wallets (cascade на clients FK set delete cascade).
create or replace function public.delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_deal_count integer;
begin
  select count(*) into v_deal_count
    from public.deals
    where client_id = p_client_id
      and status <> 'deleted';

  if v_deal_count > 0 then
    raise exception
      'Client has % active deal(s) and cannot be hard-deleted. Archive instead.',
      v_deal_count;
  end if;

  -- Wallets удалятся автоматически через ON DELETE CASCADE (см. 0001).
  delete from public.clients where id = p_client_id;
  if not found then
    raise exception 'Client % not found', p_client_id;
  end if;
end;
$BODY$;

grant execute on function public.archive_client(uuid, boolean) to authenticated;
grant execute on function public.delete_client(uuid) to authenticated;

-- 4. Обновляем RLS — явно разрешаем delete для admin/owner/manager
-- (старые policies не покрывали delete on clients)
drop policy if exists "clients_delete" on public.clients;
create policy "clients_delete" on public.clients for delete to authenticated
  using (public.f_role() in ('owner','admin'));
