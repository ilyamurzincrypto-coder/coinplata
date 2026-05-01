-- ============================================================================
-- CoinPlata · 0100_participants_v3_backfill_partners.sql
-- ============================================================================
-- ФАЗА 3: backfill clients + partners + partner_accounts +
-- partner_account_movements в новые таблицы. Идемпотентно.
--
-- НАШИ accounts/account_movements (self-side) — НЕ трогаются.
-- Они получат свою backfill-миграцию (фаза 4) после валидации.
--
-- ПРЕД-УСЛОВИЕ: пользователь сделал take_balance_snapshot('pre_backfill').
-- Миграция предупредит если за последние 24 часа такого snapshot не было.
--
-- ОТКАТ: фаза 3 обратима через
--   delete from public.participant_movements where source_kind='migration';
--   delete from public.participant_accounts where legacy_partner_account_id is not null;
--   delete from public.participants where legacy_client_id is not null
--                                     or legacy_partner_id is not null;
-- (self singleton при этом останется — он отдельной фазой удаляется).
-- ============================================================================

-- ─── Step 0: предупреждение если нет pre_backfill snapshot ────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from public.balance_snapshots
   where scope = 'pre_backfill' and taken_at > now() - interval '1 day';
  if v_n = 0 then
    raise warning 'No recent pre_backfill snapshot. Recommended: SELECT take_balance_snapshot(''pre_backfill'') first.';
  else
    raise notice 'Found % pre_backfill snapshot(s) in last 24h — proceeding.', v_n;
  end if;
end $$;

-- ─── Step 1: self singleton ────────────────────────────────────────────────
insert into public.participants (display_name, roles, created_at)
select 'Coinplata', array['self']::text[], now()
where not exists (
  select 1 from public.participants where 'self' = any(roles)
);

-- ─── Step 2: clients → participants ────────────────────────────────────────
-- Roles: 'client' всегда. Если clients.is_otc_partner=true — добавляем 'partner'.
-- Колонка is_otc_partner добавлена миграцией 0091 — если её нет, миграция
-- ниже не упадёт (CASE через information_schema).
do $$
declare v_has_otc bool;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='clients'
       and column_name='is_otc_partner'
  ) into v_has_otc;

  if v_has_otc then
    execute $sql$
      insert into public.participants (
        display_name, full_name, telegram,
        roles, legacy_client_id, created_at, created_by
      )
      select
        coalesce(nullif(trim(c.nickname),''), nullif(trim(c.full_name),''),
                 'client #' || left(c.id::text, 8)),
        c.full_name,
        c.telegram,
        case when c.is_otc_partner then array['client','partner']::text[]
             else array['client']::text[] end,
        c.id,
        c.created_at,
        c.created_by
      from public.clients c
      where not exists (
        select 1 from public.participants p where p.legacy_client_id = c.id
      );
    $sql$;
  else
    execute $sql$
      insert into public.participants (
        display_name, full_name, telegram,
        roles, legacy_client_id, created_at, created_by
      )
      select
        coalesce(nullif(trim(c.nickname),''), nullif(trim(c.full_name),''),
                 'client #' || left(c.id::text, 8)),
        c.full_name,
        c.telegram,
        array['client']::text[],
        c.id,
        c.created_at,
        c.created_by
      from public.clients c
      where not exists (
        select 1 from public.participants p where p.legacy_client_id = c.id
      );
    $sql$;
  end if;
end $$;

-- ─── Step 3: partners → participants ──────────────────────────────────────
insert into public.participants (
  display_name, telegram, phone, notes,
  roles, active, legacy_partner_id, created_at, created_by
)
select
  pt.name,
  pt.telegram,
  pt.phone,
  pt.note,
  array['partner']::text[],
  pt.active,
  pt.id,
  pt.created_at,
  pt.created_by
from public.partners pt
where not exists (
  select 1 from public.participants p where p.legacy_partner_id = pt.id
);

-- ─── Step 4: partner_accounts → participant_accounts ──────────────────────
insert into public.participant_accounts (
  participant_id, name, currency_code, channel, network_id,
  address, notes, active, created_at, created_by,
  legacy_partner_account_id
)
select
  p.id,
  pa.name,
  pa.currency_code,
  pa.type,                  -- 'cash'|'bank'|'crypto' → channel
  pa.network_id,
  pa.address,
  pa.note,
  pa.active,
  pa.created_at,
  pa.created_by,
  pa.id
from public.partner_accounts pa
join public.participants p on p.legacy_partner_id = pa.partner_id
where not exists (
  select 1 from public.participant_accounts ppa
   where ppa.legacy_partner_account_id = pa.id
);

-- ─── Step 5: partner_account_movements → participant_movements ────────────
-- Маппинг source_kind → movement_type:
--   'opening'     → 'opening'
--   'adjustment'  → 'adjustment'
--   'otc_in'      → 'deal_in'
--   'otc_out'     → 'deal_out'
--   'settle'+in   → 'settlement_in'
--   'settle'+out  → 'settlement_out'
--
-- deal_id: если source_kind='otc_*' и source_ref_id содержит чисто цифры —
-- парсим как bigint. Иначе null.
insert into public.participant_movements (
  participant_account_id, amount, direction, currency_code,
  movement_type, source_kind,
  deal_id, movement_group_id,
  source_ref_type, source_ref_id, note,
  reserved, created_by, created_at,
  legacy_partner_movement_id
)
select
  ppa.id,
  pm.amount,
  pm.direction,
  pm.currency_code,
  case
    when pm.source_kind = 'opening'                          then 'opening'
    when pm.source_kind = 'adjustment'                       then 'adjustment'
    when pm.source_kind = 'otc_in'                           then 'deal_in'
    when pm.source_kind = 'otc_out'                          then 'deal_out'
    when pm.source_kind = 'settle' and pm.direction = 'in'   then 'settlement_in'
    when pm.source_kind = 'settle' and pm.direction = 'out'  then 'settlement_out'
    else 'adjustment'
  end as movement_type,
  'migration' as source_kind,
  case
    when pm.source_kind in ('otc_in','otc_out')
         and pm.source_ref_id ~ '^\d+$'
      then pm.source_ref_id::bigint
    else null
  end as deal_id,
  pm.movement_group_id,
  case
    when pm.source_kind in ('otc_in','otc_out') then 'deal'
    when pm.source_kind = 'settle'              then 'settlement'
    else null
  end as source_ref_type,
  pm.source_ref_id,
  pm.note,
  false as reserved,
  pm.created_by,
  pm.created_at,
  pm.id
from public.partner_account_movements pm
join public.participant_accounts ppa
  on ppa.legacy_partner_account_id = pm.partner_account_id
where not exists (
  select 1 from public.participant_movements pmm
   where pmm.legacy_partner_movement_id = pm.id
);

-- ─── Step 6: v_dual_balance_check ─────────────────────────────────────────
-- Сравнение балансов СТАРОЙ системы (partner_accounts) vs НОВОЙ
-- (participant_accounts с legacy ref'ом). Status='OK' если баланс
-- совпадает с tolerance 1e-8. Иначе 'MISMATCH'.
create or replace view public.v_dual_balance_check as
with old_balances as (
  select
    pa.id           as partner_account_id,
    pa.partner_id,
    pa.currency_code,
    coalesce(sum(case when pm.direction='in'  then pm.amount end), 0)
    - coalesce(sum(case when pm.direction='out' then pm.amount end), 0)
    as old_balance
  from public.partner_accounts pa
  left join public.partner_account_movements pm on pm.partner_account_id = pa.id
  group by pa.id, pa.partner_id, pa.currency_code
),
new_balances as (
  select
    ppa.legacy_partner_account_id as partner_account_id,
    ppa.id                        as participant_account_id,
    ppa.currency_code,
    coalesce(sum(case when pmm.direction='in'  then pmm.amount end), 0)
    - coalesce(sum(case when pmm.direction='out' then pmm.amount end), 0)
    as new_balance
  from public.participant_accounts ppa
  left join public.participant_movements pmm
    on pmm.participant_account_id = ppa.id
  where ppa.legacy_partner_account_id is not null
  group by ppa.legacy_partner_account_id, ppa.id, ppa.currency_code
)
select
  o.partner_account_id,
  n.participant_account_id,
  pa_n.name              as account_name,
  o.currency_code,
  o.old_balance,
  coalesce(n.new_balance, 0) as new_balance,
  o.old_balance - coalesce(n.new_balance, 0) as diff,
  case when abs(o.old_balance - coalesce(n.new_balance, 0)) < 1e-8
       then 'OK' else 'MISMATCH' end as status
from old_balances o
left join new_balances n on n.partner_account_id = o.partner_account_id
left join public.participant_accounts pa_n on pa_n.id = n.participant_account_id;

grant select on public.v_dual_balance_check to authenticated, anon;

-- ─── Step 7: post_backfill snapshot ────────────────────────────────────────
-- Делаем автоматически — нужно для сверки. Не падает если уже был.
select public.take_balance_snapshot('post_backfill', 'after migration 0100');

-- ─── Verify ────────────────────────────────────────────────────────────────
select
  (select count(*) from public.participants where 'self' = any(roles)) as self,
  (select count(*) from public.participants where 'client' = any(roles)) as clients,
  (select count(*) from public.participants where 'partner' = any(roles)) as partners,
  (select count(*) from public.participant_accounts) as accounts,
  (select count(*) from public.participant_movements) as movements,
  (select count(*) from public.v_dual_balance_check) as checks_total,
  (select count(*) from public.v_dual_balance_check where status='OK') as checks_ok,
  (select count(*) from public.v_dual_balance_check where status='MISMATCH') as checks_mismatch;
