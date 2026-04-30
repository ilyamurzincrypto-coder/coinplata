-- ============================================================================
-- CoinPlata · 0091_clients_separation_and_audit_cleanup.sql
--
-- Решает две проблемы:
--
-- 1. Разделение клиентов и OTC контрагентов
--    До этой миграции имена партнёров утекали в clients (через
--    fallback `|| partnerName` в OtcDealWizard, исправлен в коде).
--    Здесь — добавляем флаг clients.is_otc_partner для классификации
--    + backfill для существующих записей.
--
-- 2. Очистка orphan accounting_audits
--    Audit-строки от уже удалённых entities остаются висеть. Удаляем.
-- ============================================================================

-- ============================================================================
-- 1. clients.is_otc_partner — флаг для разделения от обычных клиентов
-- ============================================================================

alter table public.clients
  add column if not exists is_otc_partner boolean not null default false;

create index if not exists clients_is_otc_partner_idx
  on public.clients(is_otc_partner) where is_otc_partner = true;

-- Backfill: помечаем как otc_partner всех клиентов чьё имя совпадает с
-- именем активного партнёра (case-insensitive) И у этого клиента нет ни
-- одной обычной regular-сделки (только OTC, или вообще ни одной).
update public.clients c
   set is_otc_partner = true
 where lower(c.nickname) in (
         select lower(p.name) from public.partners p where p.active = true
       )
   and not exists (
     select 1 from public.deals d
      where d.client_id = c.id
        and d.kind in ('regular','otc')   -- если есть OBYЧНЫЕ сделки — не маркируем
        and d.kind = 'regular'
        and d.status <> 'deleted'
   );

-- ============================================================================
-- 2. Очистка orphan accounting_audits — для уже удалённых deals/transfers/...
-- ============================================================================

-- 2.1. Audit на deal которого нет / soft-deleted
delete from public.accounting_audits
 where entity_type = 'deal'
   and (
     entity_id not in (select id::text from public.deals)
     or entity_id in (select id::text from public.deals where status = 'deleted')
   );

-- 2.2. Audit на transfer которого нет
delete from public.accounting_audits
 where entity_type = 'transfer'
   and entity_id not in (select id::text from public.transfers);

-- 2.3. Audit на expense которого нет
delete from public.accounting_audits
 where entity_type = 'expense'
   and entity_id not in (select id::text from public.expenses);

-- 2.4. Audit на balance_adjustment
delete from public.accounting_audits
 where entity_type = 'balance_adjustment'
   and entity_id not in (select id::text from public.balance_adjustments);

-- 2.5. Audit на cash_closure (исключаем cancelled тоже)
delete from public.accounting_audits
 where entity_type = 'cash_closure'
   and (
     entity_id not in (select id::text from public.cash_closures)
     or entity_id in (select id::text from public.cash_closures where cancelled_at is not null)
   );

-- ============================================================================
-- 3. Расширяем repair_orphan_movements чтобы включал accounting_audits
--
-- DROP перед CREATE — потому что меняем return-type signature
-- (из 0090 было 3 OUT columns, теперь 4). PostgreSQL не разрешает
-- CREATE OR REPLACE с разным набором колонок.
-- ============================================================================

drop function if exists public.repair_orphan_movements();

create or replace function public.repair_orphan_movements()
returns table (deal_id bigint, partner_movements_deleted int, payments_deleted int, audits_deleted int)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['owner']);
  v_deal record;
  v_pm_count int;
  v_p_count int;
  v_a_count int;
begin
  for v_deal in
    select id from public.deals where status = 'deleted'
  loop
    select count(*) into v_pm_count from public.partner_account_movements
      where source_ref_id = v_deal.id::text;
    select
      (select count(*) from public.deal_in_payments where deal_id = v_deal.id)
      + (select count(*) from public.deal_leg_payments p
           join public.deal_legs l on l.id = p.deal_leg_id where l.deal_id = v_deal.id)
      into v_p_count;
    select count(*) into v_a_count from public.accounting_audits
      where entity_type = 'deal' and entity_id = v_deal.id::text;

    if v_pm_count > 0 or v_p_count > 0 or v_a_count > 0 then
      delete from public.partner_account_movements where source_ref_id = v_deal.id::text;
      delete from public.deal_in_payments where deal_id = v_deal.id;
      delete from public.deal_leg_payments
        where deal_leg_id in (select id from public.deal_legs where deal_id = v_deal.id);
      delete from public.accounting_audits
        where entity_type = 'deal' and entity_id = v_deal.id::text;
      deal_id := v_deal.id;
      partner_movements_deleted := v_pm_count;
      payments_deleted := v_p_count;
      audits_deleted := v_a_count;
      return next;
    end if;
  end loop;
end;
$func$;

grant execute on function public.repair_orphan_movements() to authenticated;

-- ============================================================================
-- 4. Verify
-- ============================================================================

select 'clients_total' as t, count(*) from public.clients
union all
select 'clients_otc_partners', count(*) from public.clients where is_otc_partner = true
union all
select 'partners_active', count(*) from public.partners where active = true
union all
select 'audits_total', count(*) from public.accounting_audits
union all
select 'orphan_partner_movements', count(*) from public.partner_account_movements
  where source_ref_id::bigint in (select id from public.deals where status = 'deleted');

-- Sample отмеченных как OTC partner
select id, nickname, full_name, is_otc_partner, created_at::date
  from public.clients where is_otc_partner = true
  order by created_at desc
  limit 20;
