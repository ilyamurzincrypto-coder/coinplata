-- ============================================================================
-- CoinPlata · 0025_bulk_accounts_seed.sql
--
-- Массовая заливка счетов (ручной запуск в SQL Editor):
--   1. USDT crypto wallets с указанными адресами (W88/W89)
--   2. Cash accounts для всех активных fiat валют × все активные офисы
--   3. Bank accounts — только в International office, по одному на fiat
-- Все начальные балансы = 0 (без opening movements).
--
-- Офисы резолвим по имени: Mark → 'Mark%', Lara → 'Tera%' (Tera City),
-- International → '%International%'. Если что-то не найдено — RAISE NOTICE.
--
-- Бонус: чиним accounts_unique_crypto_address — было
-- `unique nulls not distinct (network_id, address)`, что на PG15+ блокирует
-- множественные fiat-счета (все с null/null). Конвертируем в partial unique
-- index, который применяется ТОЛЬКО к crypto (оба поля non-null).
-- ============================================================================

-- 1. Исправление unique constraint — partial index вместо full UNIQUE
alter table public.accounts drop constraint if exists accounts_unique_crypto_address;
drop index if exists accounts_unique_crypto_address;
create unique index if not exists accounts_unique_crypto_address
  on public.accounts (network_id, address)
  where network_id is not null and address is not null;

-- 2. Bulk insert
do $bulk$
declare
  v_mark uuid;
  v_lara uuid;
  v_intl uuid;
  v_cash_added int := 0;
  v_bank_added int := 0;
  v_crypto_added int := 0;
begin
  -- Resolve offices (case-insensitive, first match)
  select id into v_mark from public.offices
    where name ilike 'mark%' and active = true order by created_at limit 1;
  select id into v_lara from public.offices
    where (name ilike '%tera%' or name ilike '%lara%') and active = true
    order by created_at limit 1;
  select id into v_intl from public.offices
    where name ilike '%international%' and active = true
    order by created_at limit 1;

  raise notice 'Offices resolved: Mark=%, Lara/Tera=%, International=%',
    coalesce(v_mark::text, 'NOT FOUND'),
    coalesce(v_lara::text, 'NOT FOUND'),
    coalesce(v_intl::text, 'NOT FOUND');

  -- 2a. USDT crypto wallets (explicit addresses)
  -- W88 Mark · TRC20
  if v_mark is not null then
    insert into public.accounts
      (office_id, currency_code, type, name, network_id, address,
       is_deposit, is_withdrawal, active, opening_balance)
    values
      (v_mark, 'USDT', 'crypto', 'W88 Mark', 'TRC20',
       'TXyRrMNwYjmGBoK2ZhoH7L2eoyztdEpps9',
       true, true, true, 0)
    on conflict (network_id, address)
      where network_id is not null and address is not null
      do nothing;
    get diagnostics v_crypto_added = row_count;
  end if;

  -- W89 Lara · TRC20 + ERC20
  if v_lara is not null then
    insert into public.accounts
      (office_id, currency_code, type, name, network_id, address,
       is_deposit, is_withdrawal, active, opening_balance)
    values
      (v_lara, 'USDT', 'crypto', 'W89 Lara', 'TRC20',
       'TYKNoAnZnXxz2EWwFwrK4HLVv8ct2CQtwc',
       true, true, true, 0),
      (v_lara, 'USDT', 'crypto', 'W89 Lara', 'ERC20',
       '0x59F2EcA1D8D2413FcA3F7E7D560CeE9C487F3101',
       true, true, true, 0)
    on conflict (network_id, address)
      where network_id is not null and address is not null
      do nothing;
    get diagnostics v_cash_added = row_count;  -- temp reuse var
    v_crypto_added := v_crypto_added + v_cash_added;
    v_cash_added := 0;
  end if;

  -- 2b. Cash accounts для всех fiat × all active offices, КРОМЕ International
  -- (International — банковский офис, наличных там не держим). Skip existing.
  with inserted as (
    insert into public.accounts
      (office_id, currency_code, type, name,
       is_deposit, is_withdrawal, active, opening_balance)
    select o.id, c.code, 'cash', 'Cash · ' || c.code,
           false, false, true, 0
    from public.offices o
    cross join public.currencies c
    where o.active = true
      and o.id is distinct from v_intl
      and c.type = 'fiat'
      and c.active = true
      and not exists (
        select 1 from public.accounts a
        where a.office_id = o.id
          and a.currency_code = c.code
          and a.type = 'cash'
      )
    returning 1
  )
  select count(*) into v_cash_added from inserted;

  -- 2c. Bank accounts только в International, по одному на fiat
  if v_intl is not null then
    with inserted as (
      insert into public.accounts
        (office_id, currency_code, type, name,
         is_deposit, is_withdrawal, active, opening_balance)
      select v_intl, c.code, 'bank', 'Bank · ' || c.code,
             false, false, true, 0
      from public.currencies c
      where c.type = 'fiat'
        and c.active = true
        and not exists (
          select 1 from public.accounts a
          where a.office_id = v_intl
            and a.currency_code = c.code
            and a.type = 'bank'
        )
      returning 1
    )
    select count(*) into v_bank_added from inserted;
  end if;

  raise notice 'Accounts inserted: % crypto, % cash, % bank',
    v_crypto_added, v_cash_added, v_bank_added;
end
$bulk$;
