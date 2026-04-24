-- ============================================================================
-- CoinPlata · 0027_crypto_wallets_seed.sql
--
-- Точечная заливка 3х USDT кошельков (после того как 0025 их не вставил
-- из-за ошибки в DO-block или ненайденных офисов). Изолированный DO, чтобы
-- одна проблема не откатывала остальное.
--
-- Wallets:
--   Mark     · W88 Mark · TRC20 · TXyRrMNwYjmGBoK2ZhoH7L2eoyztdEpps9
--   TeraCity · W89 Lara · TRC20 · TYKNoAnZnXxz2EWwFwrK4HLVv8ct2CQtwc
--   TeraCity · W89 Lara · ERC20 · 0x59F2EcA1D8D2413FcA3F7E7D560CeE9C487F3101
-- ============================================================================

-- Диагностика: перед вставкой посмотри какие офисы найдены
do $diag$
declare
  r record;
begin
  raise notice '--- Offices matching mark/tera/lara ---';
  for r in
    select id, name, active from public.offices
    where name ilike 'mark%' or name ilike '%tera%' or name ilike '%lara%'
    order by name
  loop
    raise notice 'id=% name=% active=%', r.id, r.name, r.active;
  end loop;
end
$diag$;

-- Убедимся что constraint — partial (если 0025 не прошёл, constraint мог
-- остаться в старом виде `unique nulls not distinct`).
alter table public.accounts drop constraint if exists accounts_unique_crypto_address;
drop index if exists accounts_unique_crypto_address;
create unique index if not exists accounts_unique_crypto_address
  on public.accounts (network_id, address)
  where network_id is not null and address is not null;

-- Вставка трёх кошельков, каждый в отдельном блоке чтобы ошибка в одном
-- не откатывала остальные.
do $w88$
declare v_office uuid;
declare v_rows int := 0;
begin
  select id into v_office from public.offices
    where name ilike 'mark%' and active = true
    order by created_at limit 1;
  if v_office is null then
    raise notice 'W88 Mark: SKIP — office "Mark%%" not found';
    return;
  end if;
  insert into public.accounts
    (office_id, currency_code, type, name, network_id, address,
     is_deposit, is_withdrawal, active, opening_balance)
  values
    (v_office, 'USDT', 'crypto', 'W88 Mark', 'TRC20',
     'TXyRrMNwYjmGBoK2ZhoH7L2eoyztdEpps9',
     true, true, true, 0)
  on conflict (network_id, address)
    where network_id is not null and address is not null
    do nothing;
  get diagnostics v_rows = row_count;
  raise notice 'W88 Mark TRC20: inserted=%', v_rows;
end
$w88$;

do $w89_trc$
declare v_office uuid;
declare v_rows int := 0;
begin
  select id into v_office from public.offices
    where (name ilike '%tera%' or name ilike '%lara%') and active = true
    order by created_at limit 1;
  if v_office is null then
    raise notice 'W89 Lara TRC20: SKIP — office matching "tera|lara" not found';
    return;
  end if;
  insert into public.accounts
    (office_id, currency_code, type, name, network_id, address,
     is_deposit, is_withdrawal, active, opening_balance)
  values
    (v_office, 'USDT', 'crypto', 'W89 Lara', 'TRC20',
     'TYKNoAnZnXxz2EWwFwrK4HLVv8ct2CQtwc',
     true, true, true, 0)
  on conflict (network_id, address)
    where network_id is not null and address is not null
    do nothing;
  get diagnostics v_rows = row_count;
  raise notice 'W89 Lara TRC20: inserted=%', v_rows;
end
$w89_trc$;

do $w89_erc$
declare v_office uuid;
declare v_rows int := 0;
begin
  select id into v_office from public.offices
    where (name ilike '%tera%' or name ilike '%lara%') and active = true
    order by created_at limit 1;
  if v_office is null then
    raise notice 'W89 Lara ERC20: SKIP — office matching "tera|lara" not found';
    return;
  end if;
  insert into public.accounts
    (office_id, currency_code, type, name, network_id, address,
     is_deposit, is_withdrawal, active, opening_balance)
  values
    (v_office, 'USDT', 'crypto', 'W89 Lara', 'ERC20',
     '0x59F2EcA1D8D2413FcA3F7E7D560CeE9C487F3101',
     true, true, true, 0)
  on conflict (network_id, address)
    where network_id is not null and address is not null
    do nothing;
  get diagnostics v_rows = row_count;
  raise notice 'W89 Lara ERC20: inserted=%', v_rows;
end
$w89_erc$;

-- Финальная проверка: покажи что лежит
select o.name as office, a.name as wallet, a.network_id, a.address
from public.accounts a
join public.offices o on o.id = a.office_id
where a.currency_code = 'USDT' and a.type = 'crypto' and a.active = true
order by o.name, a.name, a.network_id;
