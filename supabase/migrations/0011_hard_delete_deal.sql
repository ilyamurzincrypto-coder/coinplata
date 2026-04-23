-- ============================================================================
-- CoinPlata · 0011_hard_delete_deal.sql
-- Hard-delete сделки: физическое удаление row из deals + дочерних таблиц.
-- Работает только на уже soft-deleted сделках (status='deleted'), чтобы не
-- позволить случайное стирание активной записи.
-- ============================================================================

create or replace function public.hard_delete_deal(p_deal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_status text;
begin
  select status into v_status from public.deals where id = p_deal_id;
  if v_status is null then
    raise exception 'Deal % not found', p_deal_id;
  end if;
  if v_status <> 'deleted' then
    raise exception 'Deal must be soft-deleted first (current status: %). Use delete_deal before hard_delete_deal.', v_status;
  end if;

  -- Пересчитаем. Дочерние записи (deal_legs, obligations, blockchain_txs.matched_deal_id,
  -- account_movements.source_ref_id, audit_log) по схеме:
  --   deal_legs: on delete cascade → уйдут сами
  --   obligations: on delete set null (deal_id/deal_leg_id) → останутся как "orphan"
  --   blockchain_txs.matched_deal_id: нет FK? Проверим явно
  --   account_movements: source_ref_id текст, нет FK — останется если есть
  --   audit_log: нет FK — останется как след истории
  --
  -- Для чистоты: удаляем movements вручную (их уже нет после delete_deal, но на
  -- всякий случай).
  delete from public.account_movements where source_ref_id = p_deal_id::text;

  -- Unset matched_deal_id в blockchain_txs чтобы не осталось dangling int
  update public.blockchain_txs set matched_deal_id = null where matched_deal_id = p_deal_id;

  -- Cancel/remove obligations по этой сделке (на всякий случай)
  delete from public.obligations where deal_id = p_deal_id;

  -- Сами deal + deal_legs (через cascade)
  delete from public.deals where id = p_deal_id;
end;
$func$;

grant execute on function public.hard_delete_deal(bigint) to authenticated;
