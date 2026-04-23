-- ============================================================================
-- CoinPlata · 0001_init.sql
-- Initial schema + RLS + RPC + views + seed.
-- Idempotent-ish: safe to re-run on an EMPTY project; will error if tables exist.
--
-- How to apply:
--   Supabase Dashboard → SQL Editor → New query → paste → Run.
--
-- After this migration:
--   1. Authentication → Users → Add user (email + password, Auto Confirm User ✓).
--   2. Run the "link-owner" snippet printed at the end (or below).
-- ============================================================================

-- ============================================================================
-- 1. Extensions
-- ============================================================================
create extension if not exists pgcrypto;

-- ============================================================================
-- 2. Reference tables (must be before users because users.office_id → offices)
-- ============================================================================

create table public.offices (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  city           text,
  timezone       text not null default 'Europe/Istanbul',
  working_days   smallint[] not null default '{1,2,3,4,5,6}',
  working_hours  jsonb not null default '{"start":"09:00","end":"21:00"}',
  min_fee_usd    numeric(12,2) not null default 10,
  fee_percent    numeric(8,4)  not null default 0,
  status         text not null default 'active' check (status in ('active','closed')),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.currencies (
  code        text primary key,
  type        text not null check (type in ('fiat','crypto')),
  symbol      text,
  name        text,
  decimals    smallint not null default 2,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.networks (
  id                        text primary key,
  name                      text not null,
  native_currency           text,
  explorer_url              text,
  required_confirmations    smallint not null default 12,
  created_at                timestamptz not null default now()
);

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null check (type in ('income','expense')),
  group_name  text check (group_name in ('operational','financial','other')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index categories_name_type_idx on public.categories(type, lower(name));

create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ============================================================================
-- 3. Users (extends auth.users)
-- ============================================================================

create table public.users (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  email          text unique,
  role           text not null default 'manager'
                 check (role in ('owner','admin','accountant','manager')),
  office_id      uuid references public.offices(id),
  status         text not null default 'active'
                 check (status in ('invited','active','disabled')),
  invite_token   text,
  invited_at     timestamptz,
  activated_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index users_office_idx on public.users(office_id);
create index users_role_idx on public.users(role);

alter table public.system_settings
  add constraint system_settings_updated_by_fkey
  foreign key (updated_by) references public.users(id) on delete set null;

-- ============================================================================
-- 4. Helper functions (used by RLS, must come before policies)
--    security definer + explicit search_path = safe read of own role/office.
-- ============================================================================

create or replace function public.f_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.f_office()
returns uuid language sql stable security definer set search_path = public as $$
  select office_id from public.users where id = auth.uid()
$$;

create or replace function public.get_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.system_settings where key = p_key
$$;

-- ============================================================================
-- 5. Accounts + clients + wallets
-- ============================================================================

create table public.accounts (
  id                   uuid primary key default gen_random_uuid(),
  office_id            uuid not null references public.offices(id),
  currency_code        text not null references public.currencies(code),
  type                 text not null check (type in ('cash','bank','crypto')),
  name                 text not null,
  bank_ref             text,
  address              text,
  network_id           text references public.networks(id),
  is_deposit           boolean default false,
  is_withdrawal        boolean default false,
  last_checked_block   bigint default 0,
  last_checked_at      timestamptz,
  active               boolean not null default true,
  opening_balance      numeric(20,8) not null default 0,
  created_at           timestamptz not null default now(),
  constraint accounts_unique_crypto_address
    unique nulls not distinct (network_id, address)
);
create index accounts_office_idx on public.accounts(office_id);
create index accounts_currency_idx on public.accounts(currency_code);
create index accounts_deposit_idx on public.accounts(is_deposit) where is_deposit = true;

create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  nickname    text not null unique,
  full_name   text,
  telegram    text,
  tag         text check (tag in ('VIP','Regular','New','Risky')),
  note        text,
  risk_score  smallint,
  risk_level  text check (risk_level in ('low','medium','high')),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id)
);
create index clients_nickname_lower on public.clients(lower(nickname));
create index clients_telegram_lower on public.clients(lower(telegram));

create table public.client_wallets (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  address         text not null,
  network_id      text not null references public.networks(id),
  first_seen_at   timestamptz not null default now(),
  last_used_at    timestamptz not null default now(),
  usage_count     integer not null default 1,
  risk_score      smallint,
  risk_level      text check (risk_level in ('low','medium','high')),
  risk_flags      text[],
  constraint client_wallets_unique unique (network_id, address)
);
create index client_wallets_client_idx on public.client_wallets(client_id);

-- ============================================================================
-- 6. Rates
-- ============================================================================

create table public.pairs (
  id               uuid primary key default gen_random_uuid(),
  from_currency    text not null references public.currencies(code),
  to_currency      text not null references public.currencies(code),
  base_rate        numeric(20,10) not null,
  spread_percent   numeric(8,4) not null default 0,
  rate             numeric(20,10) generated always as
                   (base_rate * (1 + spread_percent / 100)) stored,
  is_default       boolean not null default false,
  priority         smallint default 50,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.users(id),
  check (from_currency <> to_currency)
);
create unique index pairs_default_unique
  on public.pairs(from_currency, to_currency) where is_default;

create table public.rate_snapshots (
  id            uuid primary key default gen_random_uuid(),
  office_id     uuid references public.offices(id),
  created_by    uuid references public.users(id),
  reason        text,
  rates         jsonb not null,
  pairs_count   integer not null,
  created_at    timestamptz not null default now()
);
create index rate_snapshots_ts_idx on public.rate_snapshots(created_at desc);

-- ============================================================================
-- 7. Deals + legs
-- ============================================================================

create table public.deals (
  id                    bigserial primary key,
  office_id             uuid not null references public.offices(id),
  manager_id            uuid not null references public.users(id),
  client_id             uuid references public.clients(id),
  client_nickname       text,
  type                  text not null default 'EXCHANGE'
                        check (type in ('EXCHANGE','IN','OUT')),
  currency_in           text not null references public.currencies(code),
  amount_in             numeric(20,8) not null check (amount_in >= 0),
  in_account_id         uuid references public.accounts(id),
  in_tx_hash            text,
  fee_usd               numeric(12,2) not null default 0,
  min_fee_applied       boolean not null default false,
  profit_usd            numeric(12,2) not null default 0,
  referral              boolean not null default false,
  status                text not null default 'completed'
                        check (status in ('pending','checking','completed','flagged','deleted')),
  confirmed_at          timestamptz,
  confirmed_tx_hash     text,
  checking_started_at   timestamptz,
  checking_by           uuid references public.users(id),
  flagged_at            timestamptz,
  flagged_by            uuid references public.users(id),
  flagged_reason        text,
  deleted_at            timestamptz,
  comment               text,
  pinned                boolean not null default false,
  risk_score            smallint,
  risk_level            text check (risk_level in ('low','medium','high')),
  risk_flags            text[],
  rate_snapshot_id      uuid references public.rate_snapshots(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index deals_office_idx     on public.deals(office_id);
create index deals_status_idx     on public.deals(status);
create index deals_client_idx     on public.deals(client_id);
create index deals_manager_idx    on public.deals(manager_id);
create index deals_created_desc   on public.deals(created_at desc);
create index deals_pinned_idx     on public.deals(pinned) where pinned = true;

create table public.deal_legs (
  id            uuid primary key default gen_random_uuid(),
  deal_id       bigint not null references public.deals(id) on delete cascade,
  leg_index     smallint not null,
  currency      text not null references public.currencies(code),
  amount        numeric(20,8) not null check (amount >= 0),
  rate          numeric(20,10) not null,
  account_id    uuid references public.accounts(id),
  address       text,
  network_id    text references public.networks(id),
  send_status   text check (send_status in ('pending_send','sent','checking','confirmed')),
  send_tx_hash  text,
  is_internal   boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (deal_id, leg_index)
);
create index deal_legs_send_status_idx on public.deal_legs(send_status)
  where send_status is not null;
create index deal_legs_internal_idx on public.deal_legs(is_internal)
  where is_internal = true;

-- ============================================================================
-- 8. Account movements (ledger)
-- ============================================================================

create table public.account_movements (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id),
  amount               numeric(20,8) not null check (amount >= 0),
  direction            text not null check (direction in ('in','out')),
  currency_code        text not null references public.currencies(code),
  reserved             boolean not null default false,
  source_kind          text not null check (source_kind in (
    'opening','topup','transfer_in','transfer_out',
    'exchange_in','exchange_out','expense','income','adjustment','settle'
  )),
  source_ref_id        text,
  source_leg_index     smallint,
  movement_group_id    uuid,
  note                 text,
  created_by           uuid references public.users(id),
  created_at           timestamptz not null default now()
);
create index movements_account_idx   on public.account_movements(account_id);
create index movements_ref_idx       on public.account_movements(source_ref_id);
create index movements_group_idx     on public.account_movements(movement_group_id);
create index movements_reserved_idx  on public.account_movements(account_id) where reserved = true;

-- ============================================================================
-- 9. Obligations
-- ============================================================================

create table public.obligations (
  id                      uuid primary key default gen_random_uuid(),
  office_id               uuid not null references public.offices(id),
  deal_id                 bigint references public.deals(id) on delete set null,
  deal_leg_id             uuid references public.deal_legs(id) on delete set null,
  client_id               uuid references public.clients(id),
  currency_code           text not null references public.currencies(code),
  amount                  numeric(20,8) not null check (amount > 0),
  direction               text not null check (direction in ('we_owe','they_owe')),
  status                  text not null default 'open'
                          check (status in ('open','closed','cancelled')),
  note                    text,
  created_by              uuid references public.users(id),
  created_at              timestamptz not null default now(),
  closed_by               uuid references public.users(id),
  closed_at               timestamptz,
  closed_movement_group   uuid
);
create index obligations_office_idx      on public.obligations(office_id);
create index obligations_status_idx      on public.obligations(status) where status = 'open';
create index obligations_deal_idx        on public.obligations(deal_id);
create index obligations_office_ccy_idx  on public.obligations(office_id, currency_code)
  where status = 'open';

-- ============================================================================
-- 10. Transfers · Expenses · Blockchain · Audit
-- ============================================================================

create table public.transfers (
  id                uuid primary key default gen_random_uuid(),
  from_account_id   uuid not null references public.accounts(id),
  to_account_id     uuid not null references public.accounts(id),
  from_amount       numeric(20,8) not null check (from_amount > 0),
  to_amount         numeric(20,8) not null check (to_amount > 0),
  from_currency     text not null references public.currencies(code),
  to_currency       text not null references public.currencies(code),
  rate              numeric(20,10),
  note              text,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in ('income','expense')),
  office_id       uuid references public.offices(id),
  account_id      uuid references public.accounts(id),
  category_id     uuid references public.categories(id),
  amount          numeric(20,8) not null check (amount > 0),
  currency_code   text not null references public.currencies(code),
  entry_date      date not null default current_date,
  note            text,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now()
);
create index expenses_date_idx      on public.expenses(entry_date desc);
create index expenses_office_idx    on public.expenses(office_id);
create index expenses_category_idx  on public.expenses(category_id);

create table public.blockchain_txs (
  id                 uuid primary key default gen_random_uuid(),
  tx_hash            text not null,
  network_id         text not null references public.networks(id),
  direction          text not null check (direction in ('incoming','outgoing')),
  from_address       text,
  to_address         text,
  amount             numeric(38,18) not null,
  token_symbol       text,
  block_number       bigint,
  block_timestamp    timestamptz,
  confirmations      integer default 0,
  status             text not null default 'pending'
                     check (status in ('pending','confirmed','failed','reorg')),
  matched_deal_id    bigint references public.deals(id),
  matched_leg_id     uuid references public.deal_legs(id),
  our_account_id     uuid references public.accounts(id),
  first_seen_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (network_id, tx_hash)
);
create index bt_hash_idx          on public.blockchain_txs(tx_hash);
create index bt_matched_deal_idx  on public.blockchain_txs(matched_deal_id);
create index bt_status_idx        on public.blockchain_txs(status);

create table public.audit_log (
  id            bigserial primary key,
  user_id       uuid references public.users(id),
  user_name     text,
  action        text not null,
  entity        text not null,
  entity_id     text,
  summary       text,
  metadata      jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);
create index audit_log_entity_idx      on public.audit_log(entity, entity_id);
create index audit_log_user_idx        on public.audit_log(user_id);
create index audit_log_created_at_idx  on public.audit_log(created_at desc);

-- ============================================================================
-- 11. Views
-- ============================================================================

create or replace view public.v_account_balances as
select
  a.id as account_id,
  a.name,
  a.office_id,
  a.currency_code,
  a.opening_balance
    + coalesce(sum(case when m.direction = 'in'  and not m.reserved then m.amount end), 0)
    - coalesce(sum(case when m.direction = 'out' and not m.reserved then m.amount end), 0)
    as total,
  coalesce(sum(case when m.direction = 'out' and m.reserved then m.amount end), 0)
    as reserved
from public.accounts a
left join public.account_movements m on m.account_id = a.id
group by a.id, a.name, a.office_id, a.currency_code, a.opening_balance;

create or replace view public.v_office_currency_available as
select
  a.office_id,
  a.currency_code,
  coalesce(sum(b.total), 0) as balance,
  coalesce(sum(b.reserved), 0) as reserved,
  coalesce((
    select sum(amount) from public.obligations o
    where o.office_id = a.office_id
      and o.currency_code = a.currency_code
      and o.direction = 'we_owe'
      and o.status = 'open'
  ), 0) as obligations,
  coalesce(sum(b.total), 0)
    - coalesce(sum(b.reserved), 0)
    - coalesce((
        select sum(amount) from public.obligations o
        where o.office_id = a.office_id
          and o.currency_code = a.currency_code
          and o.direction = 'we_owe'
          and o.status = 'open'
      ), 0) as available
from public.accounts a
left join public.v_account_balances b on b.account_id = a.id
where a.active
group by a.office_id, a.currency_code;

-- ============================================================================
-- 12. RPC functions
-- ============================================================================

-- --- create_deal ------------------------------------------------------------
-- Atomically creates deal + legs + movements. Computes fee from:
--   max(margin_from_rates, office.min_fee_usd).
-- For legs with insufficient available → creates we_owe obligation, skips
-- OUT movement. Forces status='pending' if any obligation was created.
-- Client NEVER passes fee_usd; always computed server-side.
create or replace function public.create_deal(
  p_office_id uuid,
  p_manager_id uuid,
  p_client_id uuid,
  p_client_nickname text,
  p_currency_in text,
  p_amount_in numeric,
  p_in_account_id uuid,
  p_in_tx_hash text,
  p_referral boolean,
  p_comment text,
  p_status text,
  p_legs jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id bigint;
  v_office record;
  v_leg jsonb;
  v_idx smallint := 0;
  v_referral_pct numeric := coalesce((get_setting('referral_pct'))::numeric, 0.1);
  v_market_rate numeric;
  v_margin_usd numeric := 0;
  v_margin_in_curIn numeric;
  v_to_usd numeric;
  v_fee_usd numeric;
  v_min_fee_applied boolean;
  v_profit_usd numeric;
  v_referral_bonus numeric := 0;
  v_amt_in_usd numeric;
  v_mov_group uuid := gen_random_uuid();
  v_is_reserved boolean;
  v_has_obligation boolean := false;
  v_leg_office uuid;
  v_is_internal boolean;
  v_available numeric;
  v_leg_id uuid;
  v_final_status text;
  v_snapshot_id uuid;
begin
  select id, min_fee_usd, fee_percent into v_office
    from public.offices where id = p_office_id;
  if not found then raise exception 'Office % not found', p_office_id; end if;

  -- Margin (USD) — сумма по legs
  for v_leg in select * from jsonb_array_elements(p_legs) loop
    select rate into v_market_rate
      from public.pairs
      where from_currency = p_currency_in
        and to_currency = (v_leg->>'currency')
        and is_default
      limit 1;
    if v_market_rate is null or v_market_rate <= 0 then continue; end if;
    v_margin_in_curIn :=
      ((v_leg->>'amount')::numeric / nullif((v_leg->>'rate')::numeric, 0)) -
      ((v_leg->>'amount')::numeric / v_market_rate);
    if p_currency_in = 'USD' then
      v_margin_usd := v_margin_usd + v_margin_in_curIn;
    else
      select rate into v_to_usd
        from public.pairs
        where from_currency = p_currency_in and to_currency = 'USD' and is_default
        limit 1;
      if v_to_usd is not null and v_to_usd > 0 then
        v_margin_usd := v_margin_usd + v_margin_in_curIn * v_to_usd;
      end if;
    end if;
  end loop;
  v_margin_usd := round(v_margin_usd, 2);

  v_fee_usd := greatest(v_margin_usd, v_office.min_fee_usd);
  v_min_fee_applied := v_margin_usd < v_office.min_fee_usd;

  if p_referral then
    if p_currency_in = 'USD' then
      v_amt_in_usd := p_amount_in;
    else
      select rate into v_to_usd
        from public.pairs
        where from_currency = p_currency_in and to_currency = 'USD' and is_default
        limit 1;
      v_amt_in_usd := p_amount_in * coalesce(v_to_usd, 0);
    end if;
    v_referral_bonus := round(v_amt_in_usd * v_referral_pct / 100, 2);
  end if;
  v_profit_usd := v_fee_usd - v_referral_bonus;

  select id into v_snapshot_id
    from public.rate_snapshots order by created_at desc limit 1;

  v_final_status := coalesce(p_status, 'completed');
  v_is_reserved := v_final_status in ('pending','checking');

  insert into public.deals (
    office_id, manager_id, client_id, client_nickname,
    currency_in, amount_in, in_account_id, in_tx_hash,
    fee_usd, profit_usd, min_fee_applied, referral, comment, status,
    checking_started_at, checking_by, rate_snapshot_id
  ) values (
    p_office_id, p_manager_id, p_client_id, p_client_nickname,
    p_currency_in, p_amount_in, p_in_account_id, p_in_tx_hash,
    v_fee_usd, v_profit_usd, v_min_fee_applied, p_referral, p_comment, v_final_status,
    case when v_final_status = 'checking' then now() else null end,
    case when v_final_status = 'checking' then p_manager_id else null end,
    v_snapshot_id
  ) returning id into v_deal_id;

  if p_in_account_id is not null then
    insert into public.account_movements (
      account_id, amount, direction, currency_code, reserved,
      source_kind, source_ref_id, movement_group_id, note, created_by
    ) values (
      p_in_account_id, p_amount_in, 'in', p_currency_in, v_is_reserved,
      'exchange_in', v_deal_id::text, v_mov_group,
      'Deal #' || v_deal_id, p_manager_id
    );
  end if;

  for v_leg in select * from jsonb_array_elements(p_legs) loop
    v_is_internal := false;
    v_leg_office := null;
    if (v_leg->>'account_id') is not null and (v_leg->>'account_id') <> '' then
      select office_id into v_leg_office
        from public.accounts where id = (v_leg->>'account_id')::uuid;
      v_is_internal := v_leg_office is not null and v_leg_office <> p_office_id;
    end if;

    insert into public.deal_legs (
      deal_id, leg_index, currency, amount, rate,
      account_id, address, network_id, send_status, is_internal
    ) values (
      v_deal_id, v_idx,
      v_leg->>'currency',
      (v_leg->>'amount')::numeric,
      (v_leg->>'rate')::numeric,
      nullif(v_leg->>'account_id','')::uuid,
      nullif(v_leg->>'address',''),
      nullif(v_leg->>'network_id',''),
      case when (v_leg->>'address') is not null and (v_leg->>'network_id') is not null
           then 'pending_send' else null end,
      v_is_internal
    ) returning id into v_leg_id;

    if (v_leg->>'account_id') is not null and (v_leg->>'account_id') <> '' then
      select
        coalesce(b.total, 0) - coalesce(b.reserved, 0) -
        coalesce((
          select sum(amount) from public.obligations ob
          where ob.office_id = a.office_id
            and ob.currency_code = a.currency_code
            and ob.direction = 'we_owe' and ob.status = 'open'
        ), 0)
      into v_available
      from public.accounts a
      left join public.v_account_balances b on b.account_id = a.id
      where a.id = (v_leg->>'account_id')::uuid;
      if v_available is null then v_available := 0; end if;

      if v_available >= (v_leg->>'amount')::numeric then
        insert into public.account_movements (
          account_id, amount, direction, currency_code, reserved,
          source_kind, source_ref_id, source_leg_index, movement_group_id,
          note, created_by
        ) values (
          (v_leg->>'account_id')::uuid,
          (v_leg->>'amount')::numeric,
          'out',
          v_leg->>'currency',
          v_is_reserved or ((v_leg->>'address') is not null),
          'exchange_out', v_deal_id::text, v_idx, v_mov_group,
          'Deal #' || v_deal_id || ' · leg ' || (v_idx+1), p_manager_id
        );
      else
        insert into public.obligations (
          office_id, deal_id, deal_leg_id, client_id,
          currency_code, amount, direction, note, created_by
        ) values (
          p_office_id, v_deal_id, v_leg_id, p_client_id,
          v_leg->>'currency', (v_leg->>'amount')::numeric, 'we_owe',
          'Auto-created: insufficient balance at deal submit',
          p_manager_id
        );
        v_has_obligation := true;
      end if;
    end if;

    v_idx := v_idx + 1;
  end loop;

  if v_has_obligation then
    update public.deals set status = 'pending' where id = v_deal_id;
  end if;

  return v_deal_id;
end;
$$;

-- --- complete_deal ----------------------------------------------------------
create or replace function public.complete_deal(p_deal_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.deals set status = 'completed', confirmed_at = now()
    where id = p_deal_id and status in ('pending','checking');
  update public.account_movements set reserved = false
    where source_ref_id = p_deal_id::text;
end;
$$;

-- --- delete_deal ------------------------------------------------------------
create or replace function public.delete_deal(p_deal_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.account_movements where source_ref_id = p_deal_id::text;
  update public.obligations set status = 'cancelled', closed_at = now()
    where deal_id = p_deal_id and status = 'open';
  update public.deals set status = 'deleted', deleted_at = now()
    where id = p_deal_id;
end;
$$;

-- --- confirm_deal_leg -------------------------------------------------------
create or replace function public.confirm_deal_leg(p_deal_id bigint, p_leg_index smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.deal_legs set send_status = 'confirmed'
    where deal_id = p_deal_id and leg_index = p_leg_index;
  update public.account_movements set reserved = false
    where source_ref_id = p_deal_id::text
      and source_leg_index = p_leg_index
      and source_kind = 'exchange_out';
end;
$$;

-- --- mark_deal_sent ---------------------------------------------------------
create or replace function public.mark_deal_sent(
  p_deal_id bigint, p_leg_index smallint, p_tx_hash text, p_network text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.deal_legs
  set send_status = 'sent',
      send_tx_hash = p_tx_hash,
      network_id = coalesce(p_network, network_id)
  where deal_id = p_deal_id and leg_index = p_leg_index;
end;
$$;

-- --- settle_obligation ------------------------------------------------------
create or replace function public.settle_obligation(
  p_obligation_id uuid, p_account_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ob record;
  v_balance numeric;
  v_mov_group uuid := gen_random_uuid();
  v_user_id uuid := auth.uid();
begin
  select * into v_ob from public.obligations where id = p_obligation_id;
  if v_ob is null then raise exception 'Obligation not found'; end if;
  if v_ob.status <> 'open' then raise exception 'Obligation not open'; end if;

  select coalesce(b.total, 0) - coalesce(b.reserved, 0) into v_balance
    from public.v_account_balances b where b.account_id = p_account_id;

  if v_balance < v_ob.amount then
    raise exception 'Insufficient balance: % available, % required',
      v_balance, v_ob.amount;
  end if;

  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, source_leg_index, movement_group_id, note, created_by
  ) values (
    p_account_id, v_ob.amount, 'out', v_ob.currency_code, false,
    'settle', v_ob.deal_id::text,
    (select leg_index from public.deal_legs where id = v_ob.deal_leg_id),
    v_mov_group,
    'Settle obligation ' || v_ob.id, v_user_id
  );

  update public.obligations set
    status = 'closed',
    closed_at = now(),
    closed_by = v_user_id,
    closed_movement_group = v_mov_group
  where id = p_obligation_id;

  if v_ob.deal_id is not null
     and not exists (
       select 1 from public.obligations
       where deal_id = v_ob.deal_id and status = 'open'
     ) then
    update public.deals set status = 'completed', confirmed_at = now()
      where id = v_ob.deal_id and status = 'pending';
  end if;
end;
$$;

-- --- cancel_obligation ------------------------------------------------------
create or replace function public.cancel_obligation(p_obligation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.obligations set
    status = 'cancelled',
    closed_at = now(),
    closed_by = auth.uid()
  where id = p_obligation_id and status = 'open';
end;
$$;

-- --- create_transfer --------------------------------------------------------
create or replace function public.create_transfer(
  p_from_account_id uuid, p_to_account_id uuid,
  p_from_amount numeric, p_to_amount numeric,
  p_rate numeric, p_note text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_transfer_id uuid := gen_random_uuid();
  v_mov_group uuid := gen_random_uuid();
  v_from record; v_to record;
  v_user_id uuid := auth.uid();
begin
  select * into v_from from public.accounts where id = p_from_account_id;
  select * into v_to   from public.accounts where id = p_to_account_id;
  if v_from is null or v_to is null then raise exception 'Account not found'; end if;
  if v_from.id = v_to.id then raise exception 'Same account transfer'; end if;

  insert into public.transfers (
    id, from_account_id, to_account_id, from_amount, to_amount,
    from_currency, to_currency, rate, note, created_by
  ) values (
    v_transfer_id, p_from_account_id, p_to_account_id, p_from_amount, p_to_amount,
    v_from.currency_code, v_to.currency_code, p_rate, p_note, v_user_id
  );

  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, movement_group_id, note, created_by
  )
  values
  (p_from_account_id, p_from_amount, 'out', v_from.currency_code, false,
   'transfer_out', v_transfer_id::text, v_mov_group, p_note, v_user_id),
  (p_to_account_id,   p_to_amount,   'in',  v_to.currency_code,   false,
   'transfer_in',  v_transfer_id::text, v_mov_group, p_note, v_user_id);

  return v_transfer_id;
end;
$$;

-- --- topup_account ----------------------------------------------------------
create or replace function public.topup_account(
  p_account_id uuid, p_amount numeric, p_note text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mov_group uuid := gen_random_uuid();
  v_acc record;
begin
  select * into v_acc from public.accounts where id = p_account_id;
  if v_acc is null then raise exception 'Account not found'; end if;
  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, movement_group_id, note, created_by
  ) values (
    p_account_id, p_amount, 'in', v_acc.currency_code, false,
    'topup', v_mov_group, p_note, auth.uid()
  );
  return v_mov_group;
end;
$$;

-- --- upsert_client_wallet ---------------------------------------------------
create or replace function public.upsert_client_wallet(
  p_client_id uuid, p_address text, p_network_id text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.client_wallets (client_id, address, network_id, usage_count)
  values (p_client_id, p_address, p_network_id, 1)
  on conflict (network_id, address) do update
    set last_used_at = now(),
        usage_count = public.client_wallets.usage_count + 1
  returning id into v_id;
  return v_id;
end;
$$;

-- --- confirm_rates ----------------------------------------------------------
create or replace function public.confirm_rates(p_office_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_snapshot_id uuid;
  v_rates jsonb := '{}'::jsonb;
  p record;
begin
  for p in select from_currency, to_currency, rate from public.pairs where is_default loop
    v_rates := v_rates || jsonb_build_object(p.from_currency || '_' || p.to_currency, p.rate);
  end loop;
  insert into public.rate_snapshots (office_id, created_by, reason, rates, pairs_count)
  values (p_office_id, auth.uid(), p_reason, v_rates, jsonb_object_length(v_rates))
  returning id into v_snapshot_id;
  return v_snapshot_id;
end;
$$;

-- --- try_match_incoming -----------------------------------------------------
create or replace function public.try_match_incoming(p_blockchain_tx_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_tx record;
  v_deal record;
  v_tolerance numeric := 0.005;
  v_window interval := '2 hours';
begin
  select bt.*, a.currency_code, a.network_id as acc_network, a.office_id as acc_office
    into v_tx
    from public.blockchain_txs bt
    join public.accounts a on a.id = bt.our_account_id
    where bt.id = p_blockchain_tx_id;
  if v_tx is null or v_tx.matched_deal_id is not null then return null; end if;

  select d.* into v_deal
    from public.deals d
    where d.status in ('checking','pending')
      and d.in_account_id = v_tx.our_account_id
      and d.currency_in = v_tx.currency_code
      and abs(d.amount_in - v_tx.amount) <= greatest(d.amount_in * v_tolerance, 0.01)
      and d.created_at between (v_tx.block_timestamp - v_window) and (v_tx.block_timestamp + v_window)
    order by d.created_at asc
    limit 1;
  if v_deal is null then return null; end if;

  update public.deals set status='completed', confirmed_at=now(), confirmed_tx_hash=v_tx.tx_hash
    where id = v_deal.id;
  update public.account_movements set reserved=false
    where source_ref_id = v_deal.id::text;
  update public.blockchain_txs set matched_deal_id=v_deal.id where id = v_tx.id;

  if v_deal.client_id is not null and v_tx.from_address is not null then
    perform public.upsert_client_wallet(v_deal.client_id, v_tx.from_address, v_tx.network_id);
  end if;

  return v_deal.id;
end;
$$;

-- ============================================================================
-- 13. Row Level Security
-- ============================================================================

alter table public.offices             enable row level security;
alter table public.users               enable row level security;
alter table public.currencies          enable row level security;
alter table public.networks            enable row level security;
alter table public.categories          enable row level security;
alter table public.system_settings     enable row level security;
alter table public.accounts            enable row level security;
alter table public.clients             enable row level security;
alter table public.client_wallets      enable row level security;
alter table public.pairs               enable row level security;
alter table public.rate_snapshots      enable row level security;
alter table public.deals               enable row level security;
alter table public.deal_legs           enable row level security;
alter table public.account_movements   enable row level security;
alter table public.obligations         enable row level security;
alter table public.transfers           enable row level security;
alter table public.expenses            enable row level security;
alter table public.blockchain_txs      enable row level security;
alter table public.audit_log           enable row level security;

-- Reference tables: read by any authenticated, modify by admin+
create policy "ref_read" on public.offices         for select to authenticated using (true);
create policy "ref_read" on public.currencies      for select to authenticated using (true);
create policy "ref_read" on public.networks        for select to authenticated using (true);
create policy "ref_read" on public.categories      for select to authenticated using (true);
create policy "ref_read" on public.system_settings for select to authenticated using (true);
create policy "ref_read" on public.pairs           for select to authenticated using (true);
create policy "ref_read" on public.rate_snapshots  for select to authenticated using (true);

create policy "ref_write_admin" on public.offices for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "ref_update_admin" on public.offices for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));
create policy "ref_delete_admin" on public.offices for delete to authenticated
  using (public.f_role() in ('owner','admin'));

create policy "ref_write_admin" on public.currencies for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "ref_update_admin" on public.currencies for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));
create policy "ref_delete_admin" on public.currencies for delete to authenticated
  using (public.f_role() in ('owner','admin'));

create policy "ref_write_admin" on public.networks for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "ref_update_admin" on public.networks for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));
create policy "ref_delete_admin" on public.networks for delete to authenticated
  using (public.f_role() in ('owner','admin'));

create policy "ref_write_admin" on public.categories for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "ref_update_admin" on public.categories for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));
create policy "ref_delete_admin" on public.categories for delete to authenticated
  using (public.f_role() in ('owner','admin'));

create policy "ref_write_admin" on public.system_settings for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "ref_update_admin" on public.system_settings for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));

create policy "ref_write_admin" on public.pairs for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "ref_update_admin" on public.pairs for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));
create policy "ref_delete_admin" on public.pairs for delete to authenticated
  using (public.f_role() in ('owner','admin'));

create policy "ref_write_acc" on public.rate_snapshots for insert to authenticated
  with check (public.f_role() in ('owner','admin','accountant'));

-- Users: self + admin
create policy "users_read" on public.users for select to authenticated using (
  id = auth.uid() or public.f_role() in ('owner','admin','accountant')
);
create policy "users_insert_admin" on public.users for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "users_update_self_or_admin" on public.users for update to authenticated using (
  id = auth.uid() or public.f_role() in ('owner','admin')
) with check (
  id = auth.uid() or public.f_role() in ('owner','admin')
);

-- Accounts: office-scoped for managers; read-all for admin+
create policy "accounts_read" on public.accounts for select to authenticated using (
  public.f_role() in ('owner','admin','accountant') or office_id = public.f_office()
);
create policy "accounts_write_admin" on public.accounts for insert to authenticated
  with check (public.f_role() in ('owner','admin'));
create policy "accounts_update_admin" on public.accounts for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));

-- Clients / wallets: read+write by any authenticated
create policy "clients_read" on public.clients for select to authenticated using (true);
create policy "clients_write" on public.clients for insert to authenticated with check (true);
create policy "clients_update" on public.clients for update to authenticated using (true) with check (true);

create policy "wallets_read" on public.client_wallets for select to authenticated using (true);
create policy "wallets_write" on public.client_wallets for insert to authenticated with check (true);

-- Deals / legs / movements — read office-scoped; writes through RPC (security definer)
create policy "deals_read" on public.deals for select to authenticated using (
  public.f_role() in ('owner','admin','accountant') or office_id = public.f_office()
);
create policy "deals_write" on public.deals for insert to authenticated
  with check (public.f_role() in ('owner','admin','manager'));
create policy "deals_update" on public.deals for update to authenticated
  using (public.f_role() in ('owner','admin','manager'))
  with check (public.f_role() in ('owner','admin','manager'));

create policy "legs_read" on public.deal_legs for select to authenticated using (
  public.f_role() in ('owner','admin','accountant')
  or deal_id in (select id from public.deals where office_id = public.f_office())
);
create policy "legs_write" on public.deal_legs for insert to authenticated
  with check (public.f_role() in ('owner','admin','manager'));
create policy "legs_update" on public.deal_legs for update to authenticated
  using (public.f_role() in ('owner','admin','manager'))
  with check (public.f_role() in ('owner','admin','manager'));

create policy "movements_read" on public.account_movements for select to authenticated using (
  public.f_role() in ('owner','admin','accountant')
  or account_id in (select id from public.accounts where office_id = public.f_office())
);
create policy "movements_write" on public.account_movements for insert to authenticated
  with check (public.f_role() in ('owner','admin','manager','accountant'));
create policy "movements_update" on public.account_movements for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));

create policy "obligations_read" on public.obligations for select to authenticated using (
  public.f_role() in ('owner','admin','accountant') or office_id = public.f_office()
);
create policy "obligations_write" on public.obligations for insert to authenticated
  with check (public.f_role() in ('owner','admin','manager'));
create policy "obligations_update" on public.obligations for update to authenticated
  using (public.f_role() in ('owner','admin','manager'))
  with check (public.f_role() in ('owner','admin','manager'));

create policy "transfers_read" on public.transfers for select to authenticated using (
  public.f_role() in ('owner','admin','accountant')
  or from_account_id in (select id from public.accounts where office_id = public.f_office())
  or to_account_id   in (select id from public.accounts where office_id = public.f_office())
);
create policy "transfers_write" on public.transfers for insert to authenticated
  with check (public.f_role() in ('owner','admin','manager','accountant'));

create policy "expenses_read" on public.expenses for select to authenticated using (
  public.f_role() in ('owner','admin','accountant') or office_id = public.f_office()
);
create policy "expenses_write" on public.expenses for insert to authenticated
  with check (public.f_role() in ('owner','admin','accountant'));
create policy "expenses_delete" on public.expenses for delete to authenticated
  using (public.f_role() in ('owner','admin','accountant'));

create policy "bt_read" on public.blockchain_txs for select to authenticated using (
  public.f_role() in ('owner','admin','accountant')
  or our_account_id in (select id from public.accounts where office_id = public.f_office())
);
create policy "bt_write" on public.blockchain_txs for insert to authenticated
  with check (public.f_role() in ('owner','admin'));

create policy "audit_read" on public.audit_log for select to authenticated using (
  public.f_role() in ('owner','admin','accountant')
);
create policy "audit_write" on public.audit_log for insert to authenticated with check (true);

-- ============================================================================
-- 14. Realtime publication
-- ============================================================================

alter publication supabase_realtime add table public.deals;
alter publication supabase_realtime add table public.deal_legs;
alter publication supabase_realtime add table public.account_movements;
alter publication supabase_realtime add table public.obligations;
alter publication supabase_realtime add table public.blockchain_txs;

-- ============================================================================
-- 15. Seed data
-- ============================================================================

insert into public.system_settings (key, value) values
  ('referral_pct',  to_jsonb(0.1::numeric)),
  ('base_currency', to_jsonb('USD'::text));

insert into public.currencies (code, type, symbol, name, decimals) values
  ('USD',  'fiat',   '$', 'US Dollar',    2),
  ('EUR',  'fiat',   '€', 'Euro',         2),
  ('TRY',  'fiat',   '₺', 'Turkish Lira', 2),
  ('GBP',  'fiat',   '£', 'British Pound',2),
  ('USDT', 'crypto', '₮', 'Tether USD',   2);

insert into public.networks (id, name, native_currency, explorer_url, required_confirmations) values
  ('TRC20', 'Tron (TRC20)',     'TRX', 'https://tronscan.org/#/transaction/', 19),
  ('ERC20', 'Ethereum (ERC20)', 'ETH', 'https://etherscan.io/tx/',            12),
  ('BEP20', 'BNB Chain (BEP20)','BNB', 'https://bscscan.com/tx/',             15);

insert into public.categories (name, type, group_name) values
  ('Office rent',      'expense','operational'),
  ('Salary',           'expense','operational'),
  ('Utilities',        'expense','operational'),
  ('Marketing',        'expense','operational'),
  ('Tax',              'expense','financial'),
  ('Equipment',        'expense','operational'),
  ('Other',            'expense','other'),
  ('Capital injection','income', 'financial'),
  ('Interest',         'income', 'financial'),
  ('Other income',     'income', 'other'),
  ('Partner deposit',  'income', 'financial');

insert into public.offices (name, city, timezone, working_days, working_hours, min_fee_usd, fee_percent) values
  ('Mark Antalya', 'Antalya',  'Europe/Istanbul', '{1,2,3,4,5,6}', '{"start":"09:00","end":"21:00"}', 10, 0),
  ('Terra City',   'Antalya',  'Europe/Istanbul', '{1,2,3,4,5,6}', '{"start":"09:00","end":"21:00"}', 10, 0),
  ('Istanbul',     'Istanbul', 'Europe/Istanbul', '{1,2,3,4,5,6}', '{"start":"09:00","end":"21:00"}', 10, 0);

insert into public.pairs (from_currency, to_currency, base_rate, is_default, priority) values
  ('USDT','TRY', 38.9,    true, 10),
  ('USDT','USD', 0.9985,  true, 10),
  ('USDT','EUR', 0.918,   true, 10),
  ('USDT','GBP', 0.787,   true, 10),
  ('USD', 'TRY', 38.95,   true, 10),
  ('USD', 'EUR', 0.9195,  true, 10),
  ('USD', 'GBP', 0.788,   true, 10),
  ('EUR', 'TRY', 42.35,   true, 10),
  ('EUR', 'USD', 1.0875,  true, 10),
  ('EUR', 'USDT',1.088,   true, 10),
  ('TRY', 'USD', 0.02567, true, 10),
  ('TRY', 'USDT',0.0257,  true, 10),
  ('TRY', 'EUR', 0.02362, true, 10),
  ('GBP', 'USD', 1.269,   true, 10),
  ('GBP', 'TRY', 49.45,   true, 10),
  ('GBP', 'USDT',1.271,   true, 10);

-- ============================================================================
-- 16. POST-MIGRATION STEPS (run by hand)
-- ============================================================================
--
-- After this migration succeeds:
--
-- (A) In Supabase Dashboard → Authentication → Users → Add user:
--     email: ilya.murzin.crypto@gmail.com
--     password: (pick a strong one; rotate later)
--     ✓ Auto Confirm User  (включи чекбокс)
--
-- (B) Run this snippet in SQL Editor to promote yourself to owner
--     (replace the name/email if different):
--
-- insert into public.users (id, full_name, email, role, office_id, status, activated_at)
-- select
--   au.id, 'Ilya Murzin', au.email, 'owner',
--   (select id from public.offices order by created_at limit 1), 'active', now()
-- from auth.users au where au.email = 'ilya.murzin.crypto@gmail.com'
-- on conflict (id) do update
--   set role = 'owner', status = 'active', activated_at = now();
