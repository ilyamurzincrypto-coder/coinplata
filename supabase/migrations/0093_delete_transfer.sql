-- ============================================================================
-- CoinPlata · 0093_delete_transfer.sql
--
-- RPC delete_transfer — удаление перемещения с откатом обоих movements.
--
-- create_transfer создаёт 1 transfer-row + 2 account_movements (transfer_out
-- из source + transfer_in в target). source_ref_id = transfer_id::text.
--
-- delete_transfer:
--   1. Удаляет оба movements (балансы откатываются)
--   2. Удаляет accounting_audit для этого transfer (если был approve)
--   3. Удаляет transfer row
--
-- Доступ: admin / owner.
-- ============================================================================

create or replace function public.delete_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
begin
  if not exists (select 1 from public.transfers where id = p_transfer_id) then
    raise exception 'Transfer % not found', p_transfer_id;
  end if;

  -- Откатываем movements (balance recovers)
  delete from public.account_movements where source_ref_id = p_transfer_id::text;

  -- Чистим accounting_audit
  delete from public.accounting_audits
   where entity_type = 'transfer' and entity_id = p_transfer_id::text;

  -- Удаляем transfer row
  delete from public.transfers where id = p_transfer_id;
end;
$func$;

grant execute on function public.delete_transfer(uuid) to authenticated;

-- Verify
select pg_get_function_identity_arguments(oid) as signature
  from pg_proc where proname = 'delete_transfer'
    and pronamespace = 'public'::regnamespace;
