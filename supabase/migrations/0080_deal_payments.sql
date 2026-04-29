-- ============================================================================
-- CoinPlata · 0080_deal_payments.sql
--
-- ФАЗА 7 OTC re-design: payments-таблицы для частичных/отложенных платежей.
--
-- Зачем нужно. Раньше каждая сделка имела ровно одно поступление (in_actual_amount,
-- in_completed_at) и ровно одну выдачу на каждую leg (actual_amount, completed_at).
-- Этого недостаточно для OTC: клиент может занести часть сегодня, остаток через
-- два дня; партнёр может выдать клиенту в три транша.
--
-- Решение. Две новые таблицы:
--   deal_in_payments     — payments на IN-сторону (всё что приходит за amount_in)
--   deal_leg_payments    — payments на OUT-сторону каждой leg
--
-- Каждая запись = один физический money-movement.
--   kind = 'ours_now'    → пришло/ушло через наш account_id
--   kind = 'partner_now' → через partner_account_id
--   kind = 'adjustment'  → ручная корректировка без movement (редко)
--
-- Никаких 'ours_later' / 'partner_later' тут нет — _later = «ещё не платили,
-- payment не существует, есть obligation». Появление payment-строки = факт
-- денежного перемещения.
--
-- Backfill. Все existing completed/partial-сделки получают по одной payment-строке
-- из соответствующего account_movement / partner_account_movement (источник
-- идентифицируется по source_ref_id = deal_id::text + source_kind).
--
-- Status views:
--   v_deal_in_status   — paid_total, remaining, in_status ∈ {pending, partial, completed}
--   v_deal_leg_status  — то же per leg
--
-- НИЧЕГО НЕ ЛОМАЕТ: старые поля in_actual_amount / actual_amount остаются и
-- продолжают писаться в create_deal/update_deal (refactor — Фаза 8).
-- ============================================================================

-- ============================================================================
-- 1. deal_in_payments
-- ============================================================================

create table if not exists public.deal_in_payments (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             bigint not null references public.deals(id) on delete cascade,
  amount              numeric(20,8) not null check (amount > 0),
  currency_code       text not null references public.currencies(code),
  paid_at             timestamptz not null default now(),
  kind                text not null check (kind in ('ours_now','partner_now','adjustment')),
  account_id          uuid references public.accounts(id) on delete restrict,
  partner_account_id  uuid references public.partner_accounts(id) on delete restrict,
  movement_id         uuid,    -- ссылка на account_movements.id или partner_account_movements.id
  note                text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),

  constraint deal_in_payments_kind_account_consistency check (
    (kind = 'ours_now'    and account_id is not null and partner_account_id is null)
    or (kind = 'partner_now' and partner_account_id is not null and account_id is null)
    or (kind = 'adjustment'  and account_id is null and partner_account_id is null)
  )
);

create index if not exists deal_in_payments_deal_idx
  on public.deal_in_payments(deal_id);
create index if not exists deal_in_payments_paid_at_idx
  on public.deal_in_payments(paid_at);
create index if not exists deal_in_payments_account_idx
  on public.deal_in_payments(account_id) where account_id is not null;
create index if not exists deal_in_payments_partner_idx
  on public.deal_in_payments(partner_account_id) where partner_account_id is not null;
create index if not exists deal_in_payments_movement_idx
  on public.deal_in_payments(movement_id) where movement_id is not null;

alter table public.deal_in_payments enable row level security;

drop policy if exists "deal_in_payments_read" on public.deal_in_payments;
create policy "deal_in_payments_read" on public.deal_in_payments
  for select to authenticated using (true);

drop policy if exists "deal_in_payments_write" on public.deal_in_payments;
create policy "deal_in_payments_write" on public.deal_in_payments
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('manager','accountant','admin','owner'))
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('manager','accountant','admin','owner'))
  );

-- ============================================================================
-- 2. deal_leg_payments
-- ============================================================================

create table if not exists public.deal_leg_payments (
  id                  uuid primary key default gen_random_uuid(),
  deal_leg_id         uuid not null references public.deal_legs(id) on delete cascade,
  amount              numeric(20,8) not null check (amount > 0),
  currency_code       text not null references public.currencies(code),
  paid_at             timestamptz not null default now(),
  kind                text not null check (kind in ('ours_now','partner_now','adjustment')),
  account_id          uuid references public.accounts(id) on delete restrict,
  partner_account_id  uuid references public.partner_accounts(id) on delete restrict,
  movement_id         uuid,
  note                text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),

  constraint deal_leg_payments_kind_account_consistency check (
    (kind = 'ours_now'    and account_id is not null and partner_account_id is null)
    or (kind = 'partner_now' and partner_account_id is not null and account_id is null)
    or (kind = 'adjustment'  and account_id is null and partner_account_id is null)
  )
);

create index if not exists deal_leg_payments_leg_idx
  on public.deal_leg_payments(deal_leg_id);
create index if not exists deal_leg_payments_paid_at_idx
  on public.deal_leg_payments(paid_at);
create index if not exists deal_leg_payments_account_idx
  on public.deal_leg_payments(account_id) where account_id is not null;
create index if not exists deal_leg_payments_partner_idx
  on public.deal_leg_payments(partner_account_id) where partner_account_id is not null;
create index if not exists deal_leg_payments_movement_idx
  on public.deal_leg_payments(movement_id) where movement_id is not null;

alter table public.deal_leg_payments enable row level security;

drop policy if exists "deal_leg_payments_read" on public.deal_leg_payments;
create policy "deal_leg_payments_read" on public.deal_leg_payments
  for select to authenticated using (true);

drop policy if exists "deal_leg_payments_write" on public.deal_leg_payments;
create policy "deal_leg_payments_write" on public.deal_leg_payments
  for all to authenticated
  using (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('manager','accountant','admin','owner'))
  )
  with check (
    exists (select 1 from public.users u
            where u.id = auth.uid() and u.role in ('manager','accountant','admin','owner'))
  );

-- ============================================================================
-- 3. Backfill из existing movements
--
-- account_movements.source_kind = 'exchange_in' / 'exchange_out' с
-- source_ref_id = deal_id::text → создают deal_in_payments / deal_leg_payments.
-- partner_account_movements.source_kind = 'otc_in' / 'otc_out' → то же.
--
-- Дедупликация по movement_id — повторный запуск миграции не задвоит.
-- ============================================================================

-- IN side: наши счета (exchange_in)
insert into public.deal_in_payments (
  deal_id, amount, currency_code, paid_at, kind,
  account_id, partner_account_id, movement_id, note, created_by, created_at
)
select
  d.id,
  m.amount,
  m.currency_code,
  m.created_at,
  'ours_now',
  m.account_id,
  null,
  m.id,
  'backfilled from account_movements',
  m.created_by,
  m.created_at
from public.account_movements m
join public.deals d on d.id::text = m.source_ref_id
where m.source_kind = 'exchange_in'
  and m.direction = 'in'
  and not exists (
    select 1 from public.deal_in_payments p
    where p.movement_id = m.id
  );

-- IN side: партнёрские счета (otc_in)
insert into public.deal_in_payments (
  deal_id, amount, currency_code, paid_at, kind,
  account_id, partner_account_id, movement_id, note, created_by, created_at
)
select
  d.id,
  m.amount,
  m.currency_code,
  m.created_at,
  'partner_now',
  null,
  m.partner_account_id,
  m.id,
  'backfilled from partner_account_movements',
  m.created_by,
  m.created_at
from public.partner_account_movements m
join public.deals d on d.id::text = m.source_ref_id
where m.source_kind = 'otc_in'
  and m.direction = 'in'
  and not exists (
    select 1 from public.deal_in_payments p
    where p.movement_id = m.id
  );

-- OUT side: наши счета (exchange_out, source_leg_index → leg)
insert into public.deal_leg_payments (
  deal_leg_id, amount, currency_code, paid_at, kind,
  account_id, partner_account_id, movement_id, note, created_by, created_at
)
select
  l.id,
  m.amount,
  m.currency_code,
  m.created_at,
  'ours_now',
  m.account_id,
  null,
  m.id,
  'backfilled from account_movements',
  m.created_by,
  m.created_at
from public.account_movements m
join public.deals d on d.id::text = m.source_ref_id
join public.deal_legs l
       on l.deal_id = d.id and l.leg_index = m.source_leg_index
where m.source_kind = 'exchange_out'
  and m.direction = 'out'
  and m.source_leg_index is not null
  and not exists (
    select 1 from public.deal_leg_payments p
    where p.movement_id = m.id
  );

-- OUT side: партнёрские счета (otc_out)
insert into public.deal_leg_payments (
  deal_leg_id, amount, currency_code, paid_at, kind,
  account_id, partner_account_id, movement_id, note, created_by, created_at
)
select
  l.id,
  m.amount,
  m.currency_code,
  m.created_at,
  'partner_now',
  null,
  m.partner_account_id,
  m.id,
  'backfilled from partner_account_movements',
  m.created_by,
  m.created_at
from public.partner_account_movements m
join public.deals d on d.id::text = m.source_ref_id
join public.deal_legs l
       on l.deal_id = d.id and l.leg_index = m.source_leg_index
where m.source_kind = 'otc_out'
  and m.direction = 'out'
  and m.source_leg_index is not null
  and not exists (
    select 1 from public.deal_leg_payments p
    where p.movement_id = m.id
  );

-- ============================================================================
-- 4. Aggregation views
-- ============================================================================

-- Сумма IN-payments по сделке
create or replace view public.v_deal_in_paid as
select
  d.id as deal_id,
  d.amount_in as planned_amount,
  d.currency_in as planned_currency,
  coalesce(sum(p.amount), 0)::numeric(20,8) as paid_amount,
  count(p.id)::int as payment_count,
  max(p.paid_at) as last_paid_at,
  min(p.paid_at) as first_paid_at
from public.deals d
left join public.deal_in_payments p on p.deal_id = d.id
group by d.id, d.amount_in, d.currency_in;

-- Сумма OUT-payments по leg
create or replace view public.v_deal_leg_paid as
select
  l.id as deal_leg_id,
  l.deal_id,
  l.leg_index,
  l.amount as planned_amount,
  l.currency as planned_currency,
  coalesce(sum(p.amount), 0)::numeric(20,8) as paid_amount,
  count(p.id)::int as payment_count,
  max(p.paid_at) as last_paid_at,
  min(p.paid_at) as first_paid_at
from public.deal_legs l
left join public.deal_leg_payments p on p.deal_leg_id = l.id
group by l.id, l.deal_id, l.leg_index, l.amount, l.currency;

-- ============================================================================
-- 5. Status views
--
-- in_status / leg_status ∈ {pending, partial, completed}
--   pending   — paid_amount = 0 (ничего не пришло/ушло)
--   partial   — 0 < paid < planned
--   completed — paid >= planned
--
-- Допуск на округление 0.00000001 (8 знаков precision currency).
-- ============================================================================

create or replace view public.v_deal_in_status as
select
  v.deal_id,
  v.planned_amount,
  v.planned_currency,
  v.paid_amount,
  greatest(v.planned_amount - v.paid_amount, 0)::numeric(20,8) as remaining,
  v.payment_count,
  v.last_paid_at,
  v.first_paid_at,
  case
    when v.paid_amount <= 0                              then 'pending'
    when v.paid_amount + 0.00000001 < v.planned_amount   then 'partial'
    else 'completed'
  end as in_status
from public.v_deal_in_paid v;

create or replace view public.v_deal_leg_status as
select
  v.deal_leg_id,
  v.deal_id,
  v.leg_index,
  v.planned_amount,
  v.planned_currency,
  v.paid_amount,
  greatest(v.planned_amount - v.paid_amount, 0)::numeric(20,8) as remaining,
  v.payment_count,
  v.last_paid_at,
  v.first_paid_at,
  case
    when v.paid_amount <= 0                              then 'pending'
    when v.paid_amount + 0.00000001 < v.planned_amount   then 'partial'
    else 'completed'
  end as leg_status
from public.v_deal_leg_paid v;

-- ============================================================================
-- 6. Verify
-- ============================================================================

-- Колонки таблиц
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('deal_in_payments','deal_leg_payments')
order by table_name, ordinal_position;

-- Counts (должно быть >0 если есть completed-сделки)
select 'deal_in_payments' as t, count(*) from public.deal_in_payments
union all select 'deal_leg_payments', count(*) from public.deal_leg_payments
union all select 'deals', count(*) from public.deals
union all select 'deal_legs', count(*) from public.deal_legs;

-- Согласованность backfill: суммы должны совпадать с in_actual_amount
-- (для всех сделок, у которых in_actual_amount > 0).
select
  count(*) as deals_total,
  sum(case when abs(coalesce(s.paid_amount, 0) - d.in_actual_amount) > 0.01 then 1 else 0 end)
    as backfill_mismatch
from public.deals d
left join public.v_deal_in_paid s on s.deal_id = d.id
where d.in_actual_amount > 0;

-- Status distribution
select in_status, count(*) from public.v_deal_in_status group by in_status;
select leg_status, count(*) from public.v_deal_leg_status group by leg_status;
