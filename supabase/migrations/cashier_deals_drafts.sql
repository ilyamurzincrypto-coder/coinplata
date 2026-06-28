-- Черновики сделок кассира. Кассир записывает → черновик (без проводок).
-- Бухгалтер подтверждает → create_deal_v2 + ledger_tx_id + status=confirmed.
-- Применено через apply_migration.
create table if not exists public.cashier_deals (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id),
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  party_label text, client_id uuid references public.clients(id),
  in_currency text, in_amount numeric, rate text,
  out_currency text, out_amount numeric,
  effective_at timestamptz default now(), ledger_tx_id uuid, note text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  confirmed_by uuid, confirmed_at timestamptz
);
create index if not exists cashier_deals_office_status_idx on public.cashier_deals (office_id, status);
alter table public.cashier_deals enable row level security;
drop policy if exists cashier_deals_read on public.cashier_deals;
create policy cashier_deals_read on public.cashier_deals for select to authenticated using (public.f_role()=any(array['owner','admin','accountant','manager']));
drop policy if exists cashier_deals_insert on public.cashier_deals;
create policy cashier_deals_insert on public.cashier_deals for insert to authenticated with check (public.f_role()=any(array['owner','admin','accountant','manager']));
drop policy if exists cashier_deals_update on public.cashier_deals;
create policy cashier_deals_update on public.cashier_deals for update to authenticated using (public.f_role()=any(array['owner','admin','accountant','manager']));
do $$ begin begin alter publication supabase_realtime add table public.cashier_deals; exception when duplicate_object then null; end; end $$;
