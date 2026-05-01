-- ============================================================================
-- CoinPlata · 0099a_take_snapshot_dashboard_safe.sql
-- ============================================================================
-- Патч take_balance_snapshot: разрешаем вызов из SQL Editor (Supabase
-- Dashboard, роль postgres, auth.uid()=null). Без этого юзер не может
-- сделать pre_backfill snapshot до фазы 3.
--
-- Логика:
--   • auth.uid() not null → стандартный guard (admin/owner через JWT)
--   • auth.uid() is null  → системный вызов (postgres/service_role).
--                           У них и так выше прав, чем у admin — пропускаем.
-- ============================================================================

create or replace function public.take_balance_snapshot(
  p_scope text default 'manual',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid := auth.uid();
  v_data jsonb;
  v_accounts jsonb;
  v_partner jsonb;
  v_id uuid;
begin
  if p_scope not in ('pre_backfill','post_backfill','periodic','manual','dual_check') then
    raise exception 'unknown scope: %', p_scope using errcode = '22000';
  end if;

  -- Auth guard: только если вызвано через JWT-сессию (фронт).
  -- Из SQL Editor / системных RPC auth.uid()=null — пропускаем.
  if v_uid is not null then
    perform public._require_role(array['admin','owner']);
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', b.account_id,
      'currency',   b.currency_code,
      'balance',    b.total,
      'reserved',   b.reserved
    )), '[]'::jsonb)
    into v_accounts
    from public.v_account_balances b;
  exception when undefined_table then
    v_accounts := '[]'::jsonb;
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'partner_account_id', pa.id,
      'currency',           pa.currency_code,
      'balance',            t.bal
    )), '[]'::jsonb)
    into v_partner
    from public.partner_accounts pa
    join (
      select partner_account_id,
             coalesce(sum(case when direction='in' then amount end),0)
             - coalesce(sum(case when direction='out' then amount end),0) as bal
        from public.partner_account_movements
        group by partner_account_id
    ) t on t.partner_account_id = pa.id;
  exception when undefined_table then
    v_partner := '[]'::jsonb;
  end;

  v_data := jsonb_build_object(
    'accounts',         v_accounts,
    'partner_accounts', v_partner
  );

  insert into public.balance_snapshots (taken_by, scope, notes, data)
  values (v_uid, p_scope, nullif(trim(coalesce(p_notes,'')),''), v_data)
  returning id into v_id;

  return v_id;
end;
$func$;

-- Verify
select pg_get_function_identity_arguments(oid) as args, prosecdef as is_security_definer
  from pg_proc
  where proname = 'take_balance_snapshot' and pronamespace = 'public'::regnamespace;
