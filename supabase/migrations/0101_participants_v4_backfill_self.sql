-- ============================================================================
-- CoinPlata · 0101_participants_v4_backfill_self.sql
-- ============================================================================
-- ФАЗА 4: backfill наших accounts + account_movements в self-participant.
-- Идемпотентно. Старые таблицы не трогаются.
--
-- ПРЕД-УСЛОВИЕ: 0100 успешно применена (есть self singleton + partners).
-- Снапшот pre_backfill уже сделан до 0100 — повторно не нужен.
--
-- ОТКАТ: миграция обратима через
--   delete from public.participant_movements
--    where source_kind='migration' and legacy_account_movement_id is not null;
--   delete from public.participant_accounts where legacy_account_id is not null;
-- ============================================================================

-- ─── Step 1: accounts → participant_accounts (self) ───────────────────────
-- Вычисляем self-participant_id один раз, используем во всех вставках.
do $$
declare
  v_self_id uuid;
begin
  select id into v_self_id from public.participants where 'self' = any(roles) limit 1;
  if v_self_id is null then
    raise exception 'self-participant не найден. Запусти 0100 сначала.';
  end if;

  -- accounts не имеет note и created_by — оба поля в новой остаются null.
  insert into public.participant_accounts (
    participant_id, name, currency_code, channel, network_id,
    address, office_id, active, created_at,
    legacy_account_id
  )
  select
    v_self_id,
    a.name,
    a.currency_code,
    a.type,
    a.network_id,
    a.address,
    a.office_id,
    a.active,
    a.created_at,
    a.id
  from public.accounts a
  where not exists (
    select 1 from public.participant_accounts ppa
     where ppa.legacy_account_id = a.id
  );
end $$;

-- ─── Step 2: account_movements → participant_movements ───────────────────
-- Маппинг source_kind → movement_type:
--   'opening'      → 'opening'
--   'topup'        → 'settlement_in'    (пополнение кассы)
--   'transfer_in'  → 'transfer_in'
--   'transfer_out' → 'transfer_out'
--   'exchange_in'  → 'deal_in'
--   'exchange_out' → 'deal_out'
--   'income'       → 'adjustment'       (нет точного типа — adjustment ближе всего)
--   'expense'      → 'adjustment'
--   'adjustment'   → 'adjustment'
--   'settle'+in    → 'settlement_in'
--   'settle'+out   → 'settlement_out'
--
-- deal_id через LEFT JOIN на public.deals (orphan-safe).
insert into public.participant_movements (
  participant_account_id, amount, direction, currency_code,
  movement_type, source_kind,
  deal_id, movement_group_id,
  source_ref_type, source_ref_id, note,
  reserved, created_by, created_at,
  legacy_account_movement_id
)
select
  ppa.id,
  am.amount,
  am.direction,
  am.currency_code,
  case
    when am.source_kind = 'opening'                              then 'opening'
    when am.source_kind = 'topup'                                then 'settlement_in'
    when am.source_kind = 'transfer_in'                          then 'transfer_in'
    when am.source_kind = 'transfer_out'                         then 'transfer_out'
    when am.source_kind = 'exchange_in'                          then 'deal_in'
    when am.source_kind = 'exchange_out'                         then 'deal_out'
    when am.source_kind in ('income','expense','adjustment')     then 'adjustment'
    when am.source_kind = 'settle' and am.direction = 'in'       then 'settlement_in'
    when am.source_kind = 'settle' and am.direction = 'out'      then 'settlement_out'
    else 'adjustment'
  end as movement_type,
  'migration' as source_kind,
  d.id as deal_id,
  am.movement_group_id,
  case
    when am.source_kind in ('exchange_in','exchange_out') then 'deal'
    when am.source_kind = 'settle'                        then 'settlement'
    when am.source_kind in ('income','expense')           then 'expense_entry'
    when am.source_kind in ('transfer_in','transfer_out') then 'transfer'
    else null
  end as source_ref_type,
  am.source_ref_id,
  am.note,
  coalesce(am.reserved, false),
  am.created_by,
  am.created_at,
  am.id
from public.account_movements am
join public.participant_accounts ppa
  on ppa.legacy_account_id = am.account_id
left join public.deals d
  on am.source_kind in ('exchange_in','exchange_out')
 and d.id = case
              when am.source_ref_id ~ '^\d+$'
                then am.source_ref_id::bigint
              else null
            end
where not exists (
  select 1 from public.participant_movements pmm
   where pmm.legacy_account_movement_id = am.id
);

-- ─── Step 3: расширение v_dual_balance_check на наши accounts ────────────
-- Теперь view покрывает обе стороны: partner_accounts И accounts.
-- DROP+CREATE — структура колонок меняется (legacy_id вместо
-- partner_account_id), CREATE OR REPLACE такое не позволяет.
drop view if exists public.v_dual_balance_check;
create view public.v_dual_balance_check as
with old_partner as (
  select
    pa.id           as legacy_id,
    'partner'::text as side,
    pa.currency_code,
    coalesce(sum(case when pm.direction='in'  then pm.amount end), 0)
    - coalesce(sum(case when pm.direction='out' then pm.amount end), 0)
    as old_balance
  from public.partner_accounts pa
  left join public.partner_account_movements pm on pm.partner_account_id = pa.id
  group by pa.id, pa.currency_code
),
old_self as (
  -- account_balances вычисляем напрямую (не через v_account_balances —
  -- тот считает opening_balance + non-reserved movements; для сверки нам
  -- нужна та же формула как в новой таблице: Σ in − Σ out, без opening_balance
  -- т.к. opening_balance уже эмитирован как 'opening' movement в seed/миграциях).
  select
    a.id            as legacy_id,
    'self'::text    as side,
    a.currency_code,
    coalesce(sum(case when am.direction='in'  and not coalesce(am.reserved, false) then am.amount end), 0)
    - coalesce(sum(case when am.direction='out' and not coalesce(am.reserved, false) then am.amount end), 0)
    as old_balance
  from public.accounts a
  left join public.account_movements am on am.account_id = a.id
  group by a.id, a.currency_code
),
old_balances as (
  select * from old_partner union all select * from old_self
),
new_balances as (
  select
    coalesce(ppa.legacy_partner_account_id, ppa.legacy_account_id) as legacy_id,
    case when ppa.legacy_partner_account_id is not null then 'partner'
         when ppa.legacy_account_id is not null         then 'self'
         else 'unknown' end as side,
    ppa.id as participant_account_id,
    ppa.currency_code,
    coalesce(sum(case when pmm.direction='in'  and not coalesce(pmm.reserved, false) then pmm.amount end), 0)
    - coalesce(sum(case when pmm.direction='out' and not coalesce(pmm.reserved, false) then pmm.amount end), 0)
    as new_balance
  from public.participant_accounts ppa
  left join public.participant_movements pmm on pmm.participant_account_id = ppa.id
  where ppa.legacy_partner_account_id is not null
     or ppa.legacy_account_id is not null
  group by ppa.id, ppa.legacy_partner_account_id, ppa.legacy_account_id, ppa.currency_code
)
select
  o.legacy_id,
  n.participant_account_id,
  o.side,
  pa_n.name              as account_name,
  o.currency_code,
  o.old_balance,
  coalesce(n.new_balance, 0) as new_balance,
  o.old_balance - coalesce(n.new_balance, 0) as diff,
  case when abs(o.old_balance - coalesce(n.new_balance, 0)) < 1e-8
       then 'OK' else 'MISMATCH' end as status
from old_balances o
left join new_balances n
  on n.legacy_id = o.legacy_id and n.side = o.side
left join public.participant_accounts pa_n on pa_n.id = n.participant_account_id;

grant select on public.v_dual_balance_check to authenticated, anon;

-- ─── Step 4: post_backfill snapshot ──────────────────────────────────────
select public.take_balance_snapshot('post_backfill', 'after migration 0101 (self side)');

-- ─── Verify ──────────────────────────────────────────────────────────────
select
  (select count(*) from public.participants where 'self' = any(roles)) as self_p,
  (select count(*) from public.participant_accounts where legacy_account_id is not null) as self_accounts,
  (select count(*) from public.participant_accounts where legacy_partner_account_id is not null) as partner_accounts,
  (select count(*) from public.participant_movements where legacy_account_movement_id is not null) as self_movements,
  (select count(*) from public.participant_movements where legacy_partner_movement_id is not null) as partner_movements,
  (select count(*) from public.v_dual_balance_check) as checks_total,
  (select count(*) from public.v_dual_balance_check where status='OK') as checks_ok,
  (select count(*) from public.v_dual_balance_check where status='MISMATCH') as checks_mismatch;
