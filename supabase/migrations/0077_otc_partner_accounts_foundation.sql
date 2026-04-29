-- ============================================================================
-- CoinPlata · 0077_otc_partner_accounts_foundation.sql
--
-- ФАЗА 1 OTC refactor: DB foundations.
--
-- Создаёт фундамент для 4-х сценариев OTC сделок (A/B/C/D) без изменения
-- существующей логики. Все ALTER'ы — nullable columns с default NULL,
-- existing rows автоматически = scenario A (наш IN, наш OUT).
--
-- 1. partner_accounts — виртуальные счета контрагентов. ОТДЕЛЬНАЯ таблица.
--    Не смешиваются с accounts. В Balances/dashboard не учитываются.
--
-- 2. partner_account_movements — аудит виртуальных движений по счетам
--    партнёров. Создаются при OTC сделках в режимах B/C/D и при settle
--    obligations. Никогда не попадают в наш balance.
--
-- 3. ALTER obligations: + partner_id, + partner_account_id.
--    Связь obligation с конкретным партнёром (не только text-name).
--
-- 4. ALTER deals: + in_partner_account_id (если IN через партнёра)
--                + commission_usd (брокеридж за сведение).
--
-- 5. ALTER deal_legs: + partner_account_id (если OUT через партнёра).
--
-- 6. CHECK constraints — взаимоисключающие ours/partner на каждой стороне.
--
-- 7. RLS: read=authenticated; write=admin/owner.
--
-- НИЧЕГО НЕ ЛОМАЕТ существующие данные. Existing rows получают NULL
-- в новых полях → автоматически scenario A.
-- ============================================================================

-- ============================================================================
-- 1. partner_accounts
-- ============================================================================

create table if not exists public.partner_accounts (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete restrict,
  name            text not null,
  currency_code   text not null references public.currencies(code),
  type            text not null check (type in ('cash','bank','crypto')),
  network_id      text references public.networks(id),
  address         text,
  note            text,
  active          boolean not null default true,
  opening_balance numeric(20,8) not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id),
  updated_at      timestamptz not null default now()
);

create index if not exists partner_accounts_partner_idx
  on public.partner_accounts(partner_id);
create index if not exists partner_accounts_currency_idx
  on public.partner_accounts(currency_code);
create index if not exists partner_accounts_active_idx
  on public.partner_accounts(active) where active = true;

alter table public.partner_accounts enable row level security;

drop policy if exists "partner_accounts_read" on public.partner_accounts;
create policy "partner_accounts_read" on public.partner_accounts
  for select to authenticated using (true);

drop policy if exists "partner_accounts_write_admin" on public.partner_accounts;
create policy "partner_accounts_write_admin" on public.partner_accounts
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('admin','owner'))
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('admin','owner'))
  );

-- ============================================================================
-- 2. partner_account_movements
-- ============================================================================

create table if not exists public.partner_account_movements (
  id                  uuid primary key default gen_random_uuid(),
  partner_account_id  uuid not null references public.partner_accounts(id) on delete restrict,
  amount              numeric(20,8) not null check (amount >= 0),
  direction           text not null check (direction in ('in','out')),
  currency_code       text not null references public.currencies(code),
  source_kind         text not null check (source_kind in (
    'opening','adjustment','otc_in','otc_out','settle'
  )),
  source_ref_id       text,
  source_leg_index    smallint,
  movement_group_id   uuid,
  note                text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now()
);

create index if not exists partner_movements_acc_idx
  on public.partner_account_movements(partner_account_id);
create index if not exists partner_movements_ref_idx
  on public.partner_account_movements(source_ref_id);
create index if not exists partner_movements_group_idx
  on public.partner_account_movements(movement_group_id);

alter table public.partner_account_movements enable row level security;

drop policy if exists "partner_movements_read" on public.partner_account_movements;
create policy "partner_movements_read" on public.partner_account_movements
  for select to authenticated using (true);

drop policy if exists "partner_movements_write_admin" on public.partner_account_movements;
create policy "partner_movements_write_admin" on public.partner_account_movements
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('admin','owner','accountant','manager'))
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('admin','owner','accountant','manager'))
  );

-- ============================================================================
-- 3. v_partner_account_balances (aggregated)
-- ============================================================================

create or replace view public.v_partner_account_balances as
select
  a.id as partner_account_id,
  a.partner_id,
  a.name,
  a.currency_code,
  a.opening_balance
    + coalesce(sum(case when m.direction = 'in'  then m.amount end), 0)
    - coalesce(sum(case when m.direction = 'out' then m.amount end), 0)
    as total
from public.partner_accounts a
left join public.partner_account_movements m on m.partner_account_id = a.id
group by a.id, a.partner_id, a.name, a.currency_code, a.opening_balance;

-- ============================================================================
-- 4. ALTER obligations: + partner_id, + partner_account_id
-- ============================================================================

alter table public.obligations
  add column if not exists partner_id          uuid references public.partners(id) on delete set null,
  add column if not exists partner_account_id  uuid references public.partner_accounts(id) on delete set null;

create index if not exists obligations_partner_idx
  on public.obligations(partner_id) where partner_id is not null;

-- ============================================================================
-- 5. ALTER deals: + in_partner_account_id, + commission_usd
-- ============================================================================

alter table public.deals
  add column if not exists in_partner_account_id uuid references public.partner_accounts(id) on delete restrict,
  add column if not exists commission_usd        numeric(14,4) not null default 0;

create index if not exists deals_in_partner_idx
  on public.deals(in_partner_account_id) where in_partner_account_id is not null;

-- CHECK: либо наш, либо партнёрский, либо null (deferred IN). Не оба сразу.
alter table public.deals
  drop constraint if exists deals_in_account_xor_partner;
alter table public.deals
  add constraint deals_in_account_xor_partner
    check (
      in_account_id is null
      or in_partner_account_id is null
    );

-- ============================================================================
-- 6. ALTER deal_legs: + partner_account_id
-- ============================================================================

alter table public.deal_legs
  add column if not exists partner_account_id uuid references public.partner_accounts(id) on delete restrict;

create index if not exists deal_legs_partner_idx
  on public.deal_legs(partner_account_id) where partner_account_id is not null;

alter table public.deal_legs
  drop constraint if exists deal_legs_account_xor_partner;
alter table public.deal_legs
  add constraint deal_legs_account_xor_partner
    check (
      account_id is null
      or partner_account_id is null
    );

-- ============================================================================
-- 7. Backfill — НЕ ТРЕБУЕТСЯ
-- Все existing rows получают NULL в новых столбцах.
-- in_account_id остаётся как есть (наш счёт). in_partner_account_id = NULL.
-- deal_legs.account_id остаётся как есть. partner_account_id = NULL.
-- obligations.partner_id = NULL для legacy (используется только counterparty_name).
-- commission_usd = 0 default — не влияет на P&L existing сделок.
-- ============================================================================

-- ============================================================================
-- 8. Verify migration
-- ============================================================================

-- Структура partner_accounts
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='partner_accounts'
order by ordinal_position;

-- Constraints на deals
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.deals'::regclass
  and conname like '%partner%' or conname like '%account_xor%'
order by conname;

-- Constraints на deal_legs
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.deal_legs'::regclass
  and conname like '%partner%' or conname like '%account_xor%'
order by conname;

-- Counts (должны быть как pre-check)
select 'accounts' as t, count(*) from public.accounts
union all select 'deals', count(*) from public.deals
union all select 'obligations', count(*) from public.obligations
union all select 'partner_accounts (new)', count(*) from public.partner_accounts
union all select 'partner_account_movements (new)', count(*) from public.partner_account_movements;
