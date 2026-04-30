-- ============================================================================
-- CoinPlata · 0092_invalidation_triggers_and_legacy_cleanup.sql
--
-- Решает H-3 + M-4 из аудита.
--
-- 1. Расширение invalidation триггеров (H-3)
--    _invalidate_accounting_audit срабатывает на UPDATE deals/transfers/...,
--    но НЕ на изменения вложенных entities — deal_legs, deal_in_payments,
--    deal_leg_payments. После approve бухгалтером менеджер мог:
--      - изменить leg amount/account
--      - добавить / отменить payment
--    → audit статус не сбрасывался → "approved" но данные изменились.
--    Фикс: новый триггер _invalidate_audit_via_deal_id который из NEW/OLD
--    тащит deal_id и инвалидирует audit для этого deal.
--
-- 2. Cleanup legacy client_nickname (M-4)
--    До f9f3150 OtcDealWizard писал partnerName в client_nickname через
--    fallback. Это засоряло counterparties UI. Сейчас фикс — но старые
--    deals остались. Чистим: для kind='otc'/'broker' где client_id IS NULL
--    И client_nickname матчит активный partner.name → NULL.
-- ============================================================================

-- ============================================================================
-- 1. Trigger function для invalidation через deal_id
-- ============================================================================

create or replace function public._invalidate_audit_via_deal_id()
returns trigger
language plpgsql
as $$
declare
  v_deal_id bigint;
begin
  -- TG_TABLE_NAME помогает понять откуда пришёл вызов
  if TG_TABLE_NAME = 'deal_legs' then
    v_deal_id := coalesce(NEW.deal_id, OLD.deal_id);
  elsif TG_TABLE_NAME = 'deal_in_payments' then
    v_deal_id := coalesce(NEW.deal_id, OLD.deal_id);
  elsif TG_TABLE_NAME = 'deal_leg_payments' then
    -- Через leg → deal
    select l.deal_id into v_deal_id
      from public.deal_legs l
      where l.id = coalesce(NEW.deal_leg_id, OLD.deal_leg_id);
  end if;

  if v_deal_id is not null then
    update public.accounting_audits
      set status = 'pending_review',
          rejection_reason = null,
          approved_by = null,
          approved_at = null,
          underlying_updated_at = now(),
          updated_at = now()
     where entity_type = 'deal'
       and entity_id = v_deal_id::text
       and status in ('approved','rejected');
  end if;

  return coalesce(NEW, OLD);
end;
$$;

-- deal_legs: any change → invalidate
drop trigger if exists deal_legs_invalidate_audit on public.deal_legs;
create trigger deal_legs_invalidate_audit
  after insert or update or delete on public.deal_legs
  for each row execute function public._invalidate_audit_via_deal_id();

-- deal_in_payments: any change → invalidate
drop trigger if exists deal_in_payments_invalidate_audit on public.deal_in_payments;
create trigger deal_in_payments_invalidate_audit
  after insert or update or delete on public.deal_in_payments
  for each row execute function public._invalidate_audit_via_deal_id();

-- deal_leg_payments: any change → invalidate
drop trigger if exists deal_leg_payments_invalidate_audit on public.deal_leg_payments;
create trigger deal_leg_payments_invalidate_audit
  after insert or update or delete on public.deal_leg_payments
  for each row execute function public._invalidate_audit_via_deal_id();

-- ============================================================================
-- 2. Cleanup legacy client_nickname
-- ============================================================================

-- Pre-check: посмотреть сколько строк затронем
select 'before_cleanup' as snapshot, count(*) as deals_with_partner_nickname
from public.deals d
where d.kind in ('otc','broker')
  and d.client_id is null
  and d.client_nickname is not null
  and lower(d.client_nickname) in (
    select lower(p.name) from public.partners p
  );

-- Cleanup
update public.deals d
   set client_nickname = null
 where d.kind in ('otc','broker')
   and d.client_id is null
   and d.client_nickname is not null
   and lower(d.client_nickname) in (
     select lower(p.name) from public.partners p
   );

-- Post-check
select 'after_cleanup' as snapshot, count(*) as deals_with_partner_nickname
from public.deals d
where d.kind in ('otc','broker')
  and d.client_id is null
  and d.client_nickname is not null
  and lower(d.client_nickname) in (
    select lower(p.name) from public.partners p
  );
-- ожидаем 0

-- ============================================================================
-- 3. Verify triggers
-- ============================================================================

select tgname, tgrelid::regclass as table, tgenabled
  from pg_trigger
 where tgname like '%invalidate_audit%'
 order by tgrelid::regclass::text, tgname;
