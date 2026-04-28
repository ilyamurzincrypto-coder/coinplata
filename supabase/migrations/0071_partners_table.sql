-- ============================================================================
-- CoinPlata · 0071_partners_table.sql
--
-- Таблица контрагентов (партнёров) для OTC сделок. Аналог clients, но для
-- внешних обменных партнёров (через них конвертируем валюту).
--
-- CRUD доступен через Settings → Партнёры (admin/owner может всё, manager —
-- читать и создавать).
-- ============================================================================

create table if not exists public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  telegram    text,
  phone       text,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id),
  updated_at  timestamptz not null default now()
);

create index if not exists partners_name_idx on public.partners(lower(name));
create index if not exists partners_active_idx on public.partners(active) where active = true;

alter table public.partners enable row level security;

-- Все authenticated юзеры могут читать
drop policy if exists "partners_read" on public.partners;
create policy "partners_read" on public.partners for select to authenticated using (true);

-- Manager+ могут создавать
drop policy if exists "partners_insert" on public.partners;
create policy "partners_insert" on public.partners for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('manager','accountant','admin','owner')
    )
  );

-- Только admin/owner могут update/delete
drop policy if exists "partners_update_admin" on public.partners;
create policy "partners_update_admin" on public.partners for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin','owner')
    )
  );

drop policy if exists "partners_delete_admin" on public.partners;
create policy "partners_delete_admin" on public.partners for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin','owner')
    )
  );
