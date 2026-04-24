-- ============================================================================
-- CoinPlata · 0028_crypto_wallets_terra_and_accountant_rls.sql
--
-- Две вещи:
--   1. Добиваем W89 Lara кошельки в Terra City (0025/0027 не нашли — ilike
--      '%tera%' не матчит 'Terra' с двойным RR; используем '%terra%').
--   2. RLS relax: accounts_write / accounts_update теперь разрешают
--      accountant (было: только owner/admin). Раньше UI accountant'а
--      показывал "Add account" / "Deactivate", но бэк отбивал на RLS.
-- ============================================================================

-- 1. W89 Lara crypto wallets (Terra City) ------------------------------------

do $diag$
declare r record;
begin
  raise notice '--- Terra-like offices ---';
  for r in
    select id, name, active from public.offices
    where name ilike '%terra%' or name ilike '%tera%'
    order by name
  loop
    raise notice 'id=% name=% active=%', r.id, r.name, r.active;
  end loop;
end
$diag$;

do $w89$
declare
  v_office uuid;
  v_rows int := 0;
begin
  select id into v_office from public.offices
    where name ilike '%terra%' and active = true
    order by created_at limit 1;
  if v_office is null then
    -- fallback на tera (без двойной r) на всякий случай
    select id into v_office from public.offices
      where name ilike '%tera%' and active = true
      order by created_at limit 1;
  end if;
  if v_office is null then
    raise notice 'W89 Lara: SKIP — no office matching terra/tera';
    return;
  end if;

  insert into public.accounts
    (office_id, currency_code, type, name, network_id, address,
     is_deposit, is_withdrawal, active, opening_balance)
  values
    (v_office, 'USDT', 'crypto', 'W89 Lara', 'TRC20',
     'TYKNoAnZnXxz2EWwFwrK4HLVv8ct2CQtwc',
     true, true, true, 0),
    (v_office, 'USDT', 'crypto', 'W89 Lara', 'ERC20',
     '0x59F2EcA1D8D2413FcA3F7E7D560CeE9C487F3101',
     true, true, true, 0)
  on conflict (network_id, address)
    where network_id is not null and address is not null
    do nothing;
  get diagnostics v_rows = row_count;
  raise notice 'W89 Lara (TRC20+ERC20): inserted=%', v_rows;
end
$w89$;

-- 2. RLS relax: accountant может insert/update accounts ----------------------

drop policy if exists "accounts_write_admin" on public.accounts;
create policy "accounts_write_admin" on public.accounts
  for insert to authenticated
  with check (public.f_role() in ('owner','admin','accountant'));

drop policy if exists "accounts_update_admin" on public.accounts;
create policy "accounts_update_admin" on public.accounts
  for update to authenticated
  using (public.f_role() in ('owner','admin','accountant'))
  with check (public.f_role() in ('owner','admin','accountant'));

-- Финальная проверка — все USDT crypto и их офисы
select o.name as office, a.name as wallet, a.network_id, a.address
from public.accounts a
join public.offices o on o.id = a.office_id
where a.currency_code = 'USDT' and a.type = 'crypto' and a.active = true
order by o.name, a.name, a.network_id;
