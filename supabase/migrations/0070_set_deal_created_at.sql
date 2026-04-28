-- ============================================================================
-- CoinPlata · 0070_set_deal_created_at.sql
--
-- RPC для оформления сделки задним числом. Frontend (CashierPage) после
-- rpcCreateDeal вызывает этот RPC чтобы выставить deal.created_at на
-- указанную дату. Также синхронно обновляет created_at у связанных
-- account_movements и deal_legs (planned_at, completed_at) — баланс
-- пересчитается с учётом backdate.
--
-- Permission: manager может только свои сделки; admin/owner — любые.
-- ============================================================================

create or replace function public.set_deal_created_at(
  p_deal_id bigint,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_deal record;
begin
  if p_created_at is null then
    raise exception 'p_created_at required';
  end if;

  select id, manager_id, created_by_user_id, status
    into v_deal
    from public.deals where id = p_deal_id;
  if not found then
    raise exception 'Deal % not found', p_deal_id using errcode = 'P0002';
  end if;

  -- Manager может менять только свои сделки или те где он creator.
  if v_caller_role = 'manager'
     and v_deal.manager_id <> v_uid
     and v_deal.created_by_user_id <> v_uid then
    raise exception 'Manager can only backdate own deals' using errcode = '42501';
  end if;

  -- 1. deal.created_at + дополнительно in_planned_at, in_completed_at
  --    (для consistency, чтобы delta-расчёты работали корректно).
  update public.deals
    set created_at = p_created_at,
        updated_at = now(),
        in_planned_at = p_created_at,
        in_completed_at = case
          when status = 'completed' then p_created_at
          else in_completed_at
        end
    where id = p_deal_id;

  -- 2. deal_legs.planned_at + completed_at (для completed)
  update public.deal_legs
    set planned_at = p_created_at,
        completed_at = case
          when completed_at is not null then p_created_at
          else completed_at
        end
    where deal_id = p_deal_id;

  -- 3. account_movements.created_at — все movements этой сделки.
  --    source_ref_id = deal_id::text для exchange_in/out.
  update public.account_movements
    set created_at = p_created_at
    where source_ref_id = p_deal_id::text
      and source_kind in ('exchange_in', 'exchange_out');
end;
$func$;

grant execute on function public.set_deal_created_at(bigint, timestamptz) to authenticated;
