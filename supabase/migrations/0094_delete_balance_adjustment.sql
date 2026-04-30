-- ============================================================================
-- CoinPlata · 0094_delete_balance_adjustment.sql
--
-- delete_balance_adjustment RPC — удаляет корректировку с откатом
-- эмитированного account_movement.
--
-- Контекст: balance_adjustment row содержит movement_id (ссылка на
-- эмитированный account_movement при create_balance_adjustment).
-- Удаление row + удаление movement → баланс возвращается к
-- исходному (доcorrection) состоянию.
--
-- Доступ: admin / owner.
-- ============================================================================

create or replace function public.delete_balance_adjustment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
  v_movement_id uuid;
begin
  select movement_id into v_movement_id
    from public.balance_adjustments where id = p_id;
  if not found then
    raise exception 'Balance adjustment % not found', p_id;
  end if;

  -- Откат: удаляем эмитированный movement (баланс восстанавливается)
  if v_movement_id is not null then
    delete from public.account_movements where id = v_movement_id;
  end if;

  -- Чистим accounting_audit
  delete from public.accounting_audits
   where entity_type = 'balance_adjustment' and entity_id = p_id::text;

  -- Удаляем balance_adjustment row
  delete from public.balance_adjustments where id = p_id;
end;
$func$;

grant execute on function public.delete_balance_adjustment(uuid) to authenticated;

-- Verify
select pg_get_function_identity_arguments(oid) as signature
  from pg_proc where proname = 'delete_balance_adjustment'
    and pronamespace = 'public'::regnamespace;
