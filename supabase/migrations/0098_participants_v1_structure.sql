-- ============================================================================
-- CoinPlata · 0098_participants_v1_structure.sql
-- ============================================================================
-- ФАЗА 1 рефакторинга «единая модель участников».
--
-- ЦЕЛЬ: создать новые таблицы рядом со старыми. Никаких триггеров, RPC,
-- backfill или dual-write. Фронт пока не читает и не пишет в эти таблицы.
-- Полностью обратимо: drop четырёх объектов возвращает в исходное.
--
-- СТАРЫЕ ТАБЛИЦЫ (clients / partners / partner_accounts /
-- partner_account_movements / accounts / account_movements) НЕ ТРОГАЮТСЯ.
--
-- Решения по фидбеку:
--   1. participant_movements.deal_id — связь со сделками (nullable).
--   2. participant.roles содержит 'self' — наша компания тоже участник;
--      все наши кассы со временем переедут в participant_accounts.
--   3. movement_type (бизнес) отделён от source_kind (техника записи).
--   4. partial unique index на participant_accounts защищает от дублей.
--   5. balance_snapshots — таблица для сверки до/после backfill.
-- ============================================================================

-- ─── 1. participants ────────────────────────────────────────────────────────
create table if not exists public.participants (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null check (length(trim(display_name)) > 0),
  full_name     text,
  telegram      text,
  phone         text,
  notes         text,
  -- Доступные роли. 'self' — наша компания (касса/наши счета).
  -- 'counterparty' оставлена как алиас 'partner' для UI-обратной совместимости;
  -- по факту backend использует 'partner' и 'client'.
  roles         text[] not null default '{}'
                check (roles <@ array['self','client','partner','counterparty']::text[]),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.users(id),
  -- Legacy refs — для dual-period (фазы 3-7). После полного перехода можно
  -- сделать nullable→дропнуть.
  legacy_client_id   uuid,
  legacy_partner_id  uuid
);

create index if not exists participants_display_name_idx
  on public.participants (lower(display_name));
create index if not exists participants_telegram_idx
  on public.participants (lower(telegram)) where telegram is not null;
create index if not exists participants_legacy_client_idx
  on public.participants (legacy_client_id) where legacy_client_id is not null;
create index if not exists participants_legacy_partner_idx
  on public.participants (legacy_partner_id) where legacy_partner_id is not null;
-- Один participant с ролью 'self' — singleton нашей компании; backfill
-- создаст ровно одного. Гарантируем index'ом.
create unique index if not exists participants_self_singleton_idx
  on public.participants ((true)) where 'self' = any(roles);

-- ─── 2. participant_accounts ────────────────────────────────────────────────
create table if not exists public.participant_accounts (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null references public.participants(id) on delete restrict,
  -- Имя счёта для UI (например "Mark cash USD" или "Sheriff USDT TRC20")
  name            text,
  currency_code   text not null references public.currencies(code),
  -- 'cash' | 'bank' | 'crypto' | 'sepa' | 'swift' | null
  channel         text,
  network_id      text references public.networks(id),
  address         text,
  -- Привязка к офису — только для счетов с role 'self'. Для partner/client null.
  office_id       uuid references public.offices(id),
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id),
  -- Legacy refs
  legacy_partner_account_id  uuid,
  legacy_account_id          uuid     -- ← наш account из public.accounts если 'self'
);

create index if not exists pacc_participant_idx
  on public.participant_accounts (participant_id);
create index if not exists pacc_office_idx
  on public.participant_accounts (office_id) where office_id is not null;
create index if not exists pacc_legacy_partner_idx
  on public.participant_accounts (legacy_partner_account_id)
  where legacy_partner_account_id is not null;
create index if not exists pacc_legacy_account_idx
  on public.participant_accounts (legacy_account_id)
  where legacy_account_id is not null;

-- Защита от дублей: один активный счёт на (participant, currency, channel,
-- network, address). NULL'ы нормализуем через coalesce → пустая строка.
-- Только active=true — деактивированные дубли разрешены (история).
create unique index if not exists pacc_unique_active_idx on public.participant_accounts (
  participant_id,
  currency_code,
  coalesce(channel, ''),
  coalesce(network_id, ''),
  coalesce(lower(trim(address)), '')
) where active = true;

-- ─── 3. participant_movements ──────────────────────────────────────────────
create table if not exists public.participant_movements (
  id                       uuid primary key default gen_random_uuid(),
  participant_account_id   uuid not null references public.participant_accounts(id) on delete restrict,
  amount                   numeric(20,8) not null check (amount > 0),
  direction                text not null check (direction in ('in','out')),
  -- Семантика баланса: balance = Σ in − Σ out
  --   + → он должен нам;  − → мы должны ему.
  --   Для 'self' счетов: + = у нас деньги; − = овердрафт.
  currency_code            text not null references public.currencies(code),
  -- БИЗНЕС-тип: что это за операция семантически.
  movement_type            text not null check (movement_type in (
    'opening',          -- первоначальный остаток
    'deal_in',          -- IN-сторона сделки
    'deal_out',         -- OUT-сторона сделки
    'settlement_in',    -- партнёр вернул долг / клиент пополнил
    'settlement_out',   -- мы выдали партнёру / выплатили клиенту
    'transfer_in',      -- внутренний перевод между нашими счетами
    'transfer_out',
    'adjustment',       -- ручная корректировка
    'fee',              -- комиссия
    'gas'               -- блокчейн-комиссия
  )),
  -- ТЕХНИЧЕСКИЙ источник: откуда физически попало в БД.
  source_kind              text not null default 'manual' check (source_kind in (
    'manual','rpc','migration','trigger','seed','import'
  )),
  -- Связь со сделкой (если есть). Nullable — settlements / topups без deal.
  -- public.deals.id типа bigint, не uuid.
  deal_id                  bigint references public.deals(id) on delete set null,
  -- Универсальная ссылка для не-deal источников (settlement_group, etc.)
  source_ref_type          text,
  source_ref_id            text,
  -- Связь парных движений в одной операции (deal с двумя ногами, transfer и т.п.)
  movement_group_id        uuid,
  note                     text,
  reserved                 boolean not null default false,
  created_by               uuid references public.users(id),
  created_at               timestamptz not null default now(),
  -- Legacy ref
  legacy_partner_movement_id uuid,
  legacy_account_movement_id uuid
);

create index if not exists pmov_acc_idx on public.participant_movements (participant_account_id);
create index if not exists pmov_deal_idx on public.participant_movements (deal_id) where deal_id is not null;
create index if not exists pmov_group_idx on public.participant_movements (movement_group_id) where movement_group_id is not null;
create index if not exists pmov_type_idx on public.participant_movements (movement_type);
create index if not exists pmov_legacy_partner_idx on public.participant_movements (legacy_partner_movement_id) where legacy_partner_movement_id is not null;
create index if not exists pmov_legacy_account_idx on public.participant_movements (legacy_account_movement_id) where legacy_account_movement_id is not null;

-- ─── 4. balance_snapshots ──────────────────────────────────────────────────
-- Снимки балансов. Делаются ПЕРЕД backfill (фаза 2) и периодически.
-- Используются для проверки совпадения старого и нового состояний.
create table if not exists public.balance_snapshots (
  id            uuid primary key default gen_random_uuid(),
  taken_at      timestamptz not null default now(),
  taken_by      uuid references public.users(id),
  scope         text not null check (scope in (
    'pre_backfill','post_backfill','periodic','manual','dual_check'
  )),
  notes         text,
  -- Слепки в JSONB. Структура свободная, но согласованная: см. документацию
  -- ниже. Берётся из v_account_balances + agg по partner_account_movements.
  --   {
  --     "accounts": [{"account_id": uuid, "currency": text, "balance": numeric}],
  --     "partner_accounts": [{"partner_account_id": uuid, "currency": text, "balance": numeric}],
  --     "participants": [...]   // только в post_backfill / dual_check
  --   }
  data          jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists balance_snapshots_taken_at_idx
  on public.balance_snapshots (taken_at desc);
create index if not exists balance_snapshots_scope_idx
  on public.balance_snapshots (scope);

-- ─── 5. RLS ────────────────────────────────────────────────────────────────
alter table public.participants enable row level security;
alter table public.participant_accounts enable row level security;
alter table public.participant_movements enable row level security;
alter table public.balance_snapshots enable row level security;

drop policy if exists "participants_read" on public.participants;
create policy "participants_read" on public.participants
  for select to authenticated using (true);
drop policy if exists "participants_write" on public.participants;
create policy "participants_write" on public.participants
  for all to authenticated
  using (exists (select 1 from public.users u
                 where u.id = auth.uid() and u.role in ('manager','admin','owner')))
  with check (exists (select 1 from public.users u
                      where u.id = auth.uid() and u.role in ('manager','admin','owner')));

drop policy if exists "pacc_read" on public.participant_accounts;
create policy "pacc_read" on public.participant_accounts
  for select to authenticated using (true);
drop policy if exists "pacc_write" on public.participant_accounts;
create policy "pacc_write" on public.participant_accounts
  for all to authenticated
  using (exists (select 1 from public.users u
                 where u.id = auth.uid() and u.role in ('manager','admin','owner')))
  with check (exists (select 1 from public.users u
                      where u.id = auth.uid() and u.role in ('manager','admin','owner')));

drop policy if exists "pmov_read" on public.participant_movements;
create policy "pmov_read" on public.participant_movements
  for select to authenticated using (true);
drop policy if exists "pmov_write" on public.participant_movements;
create policy "pmov_write" on public.participant_movements
  for all to authenticated
  using (exists (select 1 from public.users u
                 where u.id = auth.uid() and u.role in ('manager','admin','owner')))
  with check (exists (select 1 from public.users u
                      where u.id = auth.uid() and u.role in ('manager','admin','owner')));

-- balance_snapshots — только admin/owner могут писать, читают все.
drop policy if exists "balance_snapshots_read" on public.balance_snapshots;
create policy "balance_snapshots_read" on public.balance_snapshots
  for select to authenticated using (true);
drop policy if exists "balance_snapshots_write" on public.balance_snapshots;
create policy "balance_snapshots_write" on public.balance_snapshots
  for all to authenticated
  using (exists (select 1 from public.users u
                 where u.id = auth.uid() and u.role in ('admin','owner')))
  with check (exists (select 1 from public.users u
                      where u.id = auth.uid() and u.role in ('admin','owner')));

-- ─── 6. Grants (помним баг 0095/0096) ──────────────────────────────────────
grant select on public.participants to authenticated, anon;
grant select on public.participant_accounts to authenticated, anon;
grant select on public.participant_movements to authenticated, anon;
grant select on public.balance_snapshots to authenticated, anon;

-- ─── 7. Sanity view для будущей валидации ──────────────────────────────────
create or replace view public.v_participant_balances as
select
  pa.id              as participant_account_id,
  pa.participant_id,
  pa.name            as account_name,
  pa.currency_code,
  pa.channel,
  pa.office_id,
  coalesce(sum(case when m.direction='in'  and not coalesce(m.reserved, false) then m.amount end), 0)
    - coalesce(sum(case when m.direction='out' and not coalesce(m.reserved, false) then m.amount end), 0)
    as balance,
  coalesce(sum(case when m.direction='out' and m.reserved then m.amount end), 0)
    as reserved
from public.participant_accounts pa
left join public.participant_movements m on m.participant_account_id = pa.id
where pa.active = true
group by pa.id, pa.participant_id, pa.name, pa.currency_code, pa.channel, pa.office_id;

grant select on public.v_participant_balances to authenticated, anon;

-- ─── 8. Verify (должно быть 0/0/0/0 — таблицы пустые) ──────────────────────
select
  (select count(*) from public.participants)         as participants,
  (select count(*) from public.participant_accounts) as accounts,
  (select count(*) from public.participant_movements) as movements,
  (select count(*) from public.balance_snapshots)    as snapshots;
