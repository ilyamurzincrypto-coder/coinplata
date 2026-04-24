-- ============================================================================
-- CoinPlata · 0037_update_pair_rpc.sql
--
-- RPC update_pair — security-definer обёртка для UPDATE на public.pairs.
-- До этого фронт делал прямой .from("pairs").update().eq(...) через PostgREST,
-- что:
--   • упирается в RLS ref_update_admin policy (owner/admin only, accountant
--     не пускают — но фронт-permissions для accountant edit='edit');
--   • если PATCH падает сетью, нет серверной логики retry / clear error.
--
-- RPC обходит RLS, явно проверяет права caller'а, бросает понятные
-- exceptions.
-- ============================================================================

drop function if exists public.update_pair(text, text, numeric, numeric);

create function public.update_pair(
  p_from        text,
  p_to          text,
  p_base_rate   numeric default null,
  p_spread      numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text;
  v_from text := upper(trim(coalesce(p_from, '')));
  v_to   text := upper(trim(coalesce(p_to, '')));
  v_updated_rows int;
begin
  -- Caller auth
  select role into v_caller_role
    from public.users where id = auth.uid();
  if v_caller_role not in ('owner','admin','accountant') then
    raise exception 'Only owner/admin/accountant can update pairs (caller=%)',
      coalesce(v_caller_role, 'null')
      using errcode = '42501';
  end if;

  if v_from = '' or v_to = '' then
    raise exception 'from/to required' using errcode = '22000';
  end if;
  if p_base_rate is null and p_spread is null then
    raise exception 'Need at least one of base_rate or spread' using errcode = '22000';
  end if;
  if p_base_rate is not null and p_base_rate <= 0 then
    raise exception 'base_rate must be > 0' using errcode = '22000';
  end if;

  update public.pairs
    set base_rate      = coalesce(p_base_rate, base_rate),
        spread_percent = coalesce(p_spread, spread_percent),
        updated_at     = now(),
        updated_by     = auth.uid()
    where from_currency = v_from
      and to_currency   = v_to
      and is_default;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows = 0 then
    raise exception 'No default pair found for %→% — create it first', v_from, v_to
      using errcode = 'P0002';
  end if;
end;
$func$;

grant execute on function public.update_pair(text, text, numeric, numeric) to authenticated;
