-- ============================================================================
-- CoinPlata · 0090_fix_delete_deal_partner_cleanup.sql
--
-- КРИТИЧЕСКИЙ ФИКС финансового ядра.
--
-- Проблема. delete_deal (написан в 0042, до OTC re-design в 0077+):
-- удаляет только public.account_movements, но не трогает:
--   - public.partner_account_movements (миграция 0077)
--   - public.deal_in_payments (0080)
--   - public.deal_leg_payments (0080)
--
-- Результат: после soft-delete OTC-сделки:
--   - Наши балансы корректны (account_movements удалены)
--   - Партнёрский баланс ВРЁТ (partner_account_movements висят)
--   - Payment-rows ссылаются на «удалённую» сделку → audit-feed inconsistency
--
-- Этот скрипт:
--   1. Переписывает delete_deal — добавляет cleanup partner_movements
--      + deal_in_payments + deal_leg_payments + accounting_audits.
--   2. Переписывает hard_delete_deal — то же.
--   3. Repair-функция repair_orphan_partner_movements — для существующих
--      повреждённых данных. Запускается вручную после применения миграции.
--   4. Detection view v_orphan_movements — для аудита расхождений.
--
-- Принцип: при удалении сделки ВСЕ связанные ledger-rows физически
-- удаляются, чтобы балансы (наши и партнёрские) восстанавливались до
-- состояния «как будто сделки не было». Audit trail сохраняется через
-- public.audit_log (отдельная таблица, не затрагивается).
-- ============================================================================

-- ============================================================================
-- 1. delete_deal — full cleanup
-- ============================================================================

drop function if exists public.delete_deal(bigint, text);

create or replace function public.delete_deal(
  p_deal_id bigint,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.deals where id = p_deal_id) then
    raise exception 'Deal % not found', p_deal_id;
  end if;

  -- 1. Наш ledger
  delete from public.account_movements where source_ref_id = p_deal_id::text;

  -- 2. Партнёрский ledger (миграция 0077) — ТОТ САМЫЙ БАГ
  delete from public.partner_account_movements where source_ref_id = p_deal_id::text;

  -- 3. Payment-rows (0080) — soft-delete сделки не каскадит, чистим вручную
  delete from public.deal_in_payments where deal_id = p_deal_id;
  delete from public.deal_leg_payments
    where deal_leg_id in (select id from public.deal_legs where deal_id = p_deal_id);

  -- 4. Obligations — отменяем (не удаляем, для аудита истории)
  update public.obligations
    set status = 'cancelled',
        closed_at = now(),
        closed_by = v_uid
    where deal_id = p_deal_id and status = 'open';

  -- 5. Accounting audit (если был approved/rejected — статус сбрасываем)
  delete from public.accounting_audits
    where entity_type = 'deal' and entity_id = p_deal_id::text;

  -- 6. Soft-delete deal row
  update public.deals
    set status = 'deleted',
        deleted_at = now(),
        comment = case
          when p_reason is null or length(trim(p_reason)) = 0 then comment
          else coalesce(comment, '') || ' [DELETED: ' || trim(p_reason) || ']'
        end
    where id = p_deal_id;
end;
$func$;

grant execute on function public.delete_deal(bigint, text) to authenticated;

-- ============================================================================
-- 2. hard_delete_deal — full physical removal
-- ============================================================================

drop function if exists public.hard_delete_deal(bigint);

create or replace function public.hard_delete_deal(p_deal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['owner']);
  v_status text;
begin
  select status into v_status from public.deals where id = p_deal_id;
  if v_status is null then
    raise exception 'Deal % not found', p_deal_id;
  end if;
  if v_status <> 'deleted' then
    raise exception 'Deal must be soft-deleted first (status=%). Use delete_deal first.', v_status;
  end if;

  -- 1. Наш ledger (на всякий, после soft-delete уже пусто)
  delete from public.account_movements where source_ref_id = p_deal_id::text;

  -- 2. Партнёрский ledger
  delete from public.partner_account_movements where source_ref_id = p_deal_id::text;

  -- 3. Payments (на всякий — ON DELETE CASCADE сработает при delete deals)
  delete from public.deal_in_payments where deal_id = p_deal_id;
  delete from public.deal_leg_payments
    where deal_leg_id in (select id from public.deal_legs where deal_id = p_deal_id);

  -- 4. Decouple blockchain_txs
  update public.blockchain_txs set matched_deal_id = null where matched_deal_id = p_deal_id;

  -- 5. Obligations — физически удаляем (был cancelled-row, можно убрать совсем)
  delete from public.obligations where deal_id = p_deal_id;

  -- 6. Accounting audit
  delete from public.accounting_audits
    where entity_type = 'deal' and entity_id = p_deal_id::text;

  -- 7. Deal (CASCADE удалит deal_legs → CASCADE deal_leg_payments)
  delete from public.deals where id = p_deal_id;
end;
$func$;

grant execute on function public.hard_delete_deal(bigint) to authenticated;

-- ============================================================================
-- 3. Detection view — где уже сломано
-- ============================================================================

create or replace view public.v_orphan_movements as
select
  d.id as deal_id,
  d.status as deal_status,
  d.kind, d.in_kind,
  d.deleted_at,
  (select count(*) from public.partner_account_movements m
    where m.source_ref_id = d.id::text) as partner_movements_count,
  (select coalesce(sum(m.amount), 0) from public.partner_account_movements m
    where m.source_ref_id = d.id::text and m.direction = 'in') as partner_in_total,
  (select coalesce(sum(m.amount), 0) from public.partner_account_movements m
    where m.source_ref_id = d.id::text and m.direction = 'out') as partner_out_total,
  (select count(*) from public.deal_in_payments p where p.deal_id = d.id) as orphan_in_payments,
  (select count(*) from public.deal_leg_payments p
     join public.deal_legs l on l.id = p.deal_leg_id where l.deal_id = d.id) as orphan_leg_payments
from public.deals d
where d.status = 'deleted';

-- ============================================================================
-- 4. Repair — починить уже повреждённые данные
--
-- Owner-only функция: проходит по всем soft-deleted сделкам, удаляет orphan
-- partner_account_movements и payment-rows. Не трогает obligations и audit_log.
--
-- Возвращает количество затронутых сделок.
-- ============================================================================

create or replace function public.repair_orphan_movements()
returns table (deal_id bigint, partner_movements_deleted int, payments_deleted int)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['owner']);
  v_deal record;
  v_pm_count int;
  v_p_count int;
begin
  for v_deal in
    select id from public.deals where status = 'deleted'
  loop
    -- Считаем сколько rows удалим (для отчёта)
    select count(*) into v_pm_count from public.partner_account_movements
      where source_ref_id = v_deal.id::text;
    select
      (select count(*) from public.deal_in_payments where deal_id = v_deal.id)
      + (select count(*) from public.deal_leg_payments p
           join public.deal_legs l on l.id = p.deal_leg_id where l.deal_id = v_deal.id)
      into v_p_count;

    if v_pm_count > 0 or v_p_count > 0 then
      delete from public.partner_account_movements where source_ref_id = v_deal.id::text;
      delete from public.deal_in_payments where deal_id = v_deal.id;
      delete from public.deal_leg_payments
        where deal_leg_id in (select id from public.deal_legs where deal_id = v_deal.id);
      deal_id := v_deal.id;
      partner_movements_deleted := v_pm_count;
      payments_deleted := v_p_count;
      return next;
    end if;
  end loop;
end;
$func$;

grant execute on function public.repair_orphan_movements() to authenticated;

-- ============================================================================
-- 5. Verify — что бы посмотреть после применения
-- ============================================================================

-- Сколько soft-deleted сделок имеют orphan-движения
select count(*) as broken_deals,
       sum(partner_movements_count) as orphan_partner_movements,
       sum(orphan_in_payments) as orphan_in_pays,
       sum(orphan_leg_payments) as orphan_leg_pays
from public.v_orphan_movements
where partner_movements_count > 0 or orphan_in_payments > 0 or orphan_leg_payments > 0;

-- Сигнатуры функций
select proname, pg_get_function_identity_arguments(oid) as signature
  from pg_proc where proname in ('delete_deal','hard_delete_deal','repair_orphan_movements')
    and pronamespace = 'public'::regnamespace
  order by proname;
