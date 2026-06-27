-- manager_orders — локальные заявки менеджера (клиент придёт позже).
-- НЕ ПРИМЕНЯТЬ без ревью. Код приложения работает за фиче-флагом
-- VITE_MANAGER_ORDERS_ENABLED — пока флаг/таблицы нет, касса не падает.
--
-- Нормализовано под будущие сайтовые заявки (CoinPoint bot_orders через прокси) —
-- лента и «Под заявки» работают с общим типом «заявка».
--
-- ВНИМАНИЕ (отклонение от спеки): deal_id ссылается на deals(id), а это BIGINT
-- (в спеке было uuid). Идемпотентность «провести» — через status (UPDATE только
-- из 'pending'); deal_id заполняется best-effort.

create table if not exists public.manager_orders (
  id            uuid primary key default gen_random_uuid(),
  office_id     uuid references public.offices(id),
  kind          text not null check (kind in ('exchange','visit')),
  contact       text,                              -- сырой контакт/имя как ввёл менеджер
  client_id     uuid references public.clients(id),-- если привязан контрагент
  from_currency text,
  from_amount   numeric,
  rate          text,
  to_currency   text,
  to_amount     numeric,                           -- расход (для обеспечения «Под заявки»)
  status        text not null default 'pending' check (status in ('pending','done','cancelled')),
  arrived_at    timestamptz,                       -- отметка «клиент пришёл»
  deal_id       bigint references public.deals(id),-- сделка, созданная при «провести»
  note          text,                              -- напр. «факт ≠ заявка»
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  meeting_at    timestamptz
);

create index if not exists manager_orders_office_status_idx
  on public.manager_orders (office_id, status);

alter table public.manager_orders enable row level security;

-- RLS — как у deals: owner/admin/accountant/manager (касса видит все офисы).
drop policy if exists manager_orders_read on public.manager_orders;
create policy manager_orders_read on public.manager_orders
  for select to authenticated
  using (public.f_role() = any (array['owner','admin','accountant','manager']));

drop policy if exists manager_orders_insert on public.manager_orders;
create policy manager_orders_insert on public.manager_orders
  for insert to authenticated
  with check (public.f_role() = any (array['owner','admin','accountant','manager']));

drop policy if exists manager_orders_update on public.manager_orders;
create policy manager_orders_update on public.manager_orders
  for update to authenticated
  using (public.f_role() = any (array['owner','admin','accountant','manager']));

-- Realtime: живое появление/изменение заявок в ленте и пересчёт «Под заявки».
alter publication supabase_realtime add table public.manager_orders;
