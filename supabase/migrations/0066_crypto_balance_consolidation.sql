-- ============================================================================
-- CoinPlata · 0066_crypto_balance_consolidation.sql
--
-- Временная консолидация крипто-баланса: всё USDT (228 538.65) кладётся на
-- один счёт — Mark Antalya / USDT / TRC20. Вечером планируется разбивка
-- через отдельную миграцию.
--
-- Логика:
--   1. Находим целевой счёт (office name LIKE '%Mark%Antalya%' OR
--      '%Mark%' OR '%Antalya%', currency='USDT', type='crypto', network='TRC20').
--   2. Если не существует — auto-create.
--   3. Удаляем opening/topup movements у ВСЕХ USDT crypto-счетов (чтобы
--      обнулить старые остатки, иначе total = old + new).
--   4. INSERT opening 228 538.65 на целевой счёт.
--
-- ВАЖНО: deal-movements (exchange_in/out, transfer_in/out) НЕ трогаем —
-- они часть бизнес-истории. Удаляются только seed-уровневые opening/topup.
-- ============================================================================

do $consolidation$
declare
  v_target_account_id uuid;
  v_office_id uuid;
  v_admin_id uuid;
  v_target_amount numeric := 228538.65;
  v_now timestamptz := now();
  v_deleted int;
begin
  -- 1. Находим Mark Antalya office
  select id into v_office_id
    from public.offices
    where lower(name) like '%mark%antalya%'
       or lower(name) like '%antalya%mark%'
    limit 1;

  if v_office_id is null then
    select id into v_office_id
      from public.offices
      where lower(name) like '%mark%' or lower(name) like '%antalya%'
      order by
        case
          when lower(name) like '%antalya%' then 1
          when lower(name) like '%mark%' then 2
          else 3
        end
      limit 1;
  end if;

  if v_office_id is null then
    raise exception 'Не найден офис Mark/Antalya. Проверь public.offices.';
  end if;

  -- 2. Любой owner/admin для updated_by
  select id into v_admin_id from public.users
    where role in ('owner', 'admin') and active = true limit 1;

  -- 3. Ищем USDT TRC20 счёт в найденном офисе
  select id into v_target_account_id
    from public.accounts
    where office_id = v_office_id
      and currency = 'USDT'
      and active = true
      and (
        upper(coalesce(network, '')) = 'TRC20'
        or upper(coalesce(name, '')) like '%TRC20%'
      )
    limit 1;

  -- 4. Если не существует — создаём
  if v_target_account_id is null then
    insert into public.accounts (
      id, office_id, name, type, currency, network, active, balance, created_by
    ) values (
      gen_random_uuid(), v_office_id, 'USDT TRC20', 'crypto', 'USDT', 'TRC20',
      true, 0, v_admin_id
    ) returning id into v_target_account_id;
    raise notice 'Created USDT TRC20 account in office %', v_office_id;
  end if;

  raise notice 'Target account: %', v_target_account_id;

  -- 5. Удаляем opening/topup movements для ВСЕХ USDT crypto-счетов
  --    (deals/transfers movements не трогаем — это бизнес-история).
  delete from public.account_movements
    where account_id in (
      select id from public.accounts
      where currency = 'USDT'
    )
    and source_kind in ('opening', 'topup');
  get diagnostics v_deleted = row_count;
  raise notice 'Deleted % opening/topup USDT movements', v_deleted;

  -- 6. INSERT opening на целевой счёт
  insert into public.account_movements (
    id, account_id, amount, direction, currency_code,
    source_kind, note, created_by, created_at
  ) values (
    gen_random_uuid(),
    v_target_account_id,
    v_target_amount,
    'in',
    'USDT',
    'opening',
    'Консолидированный крипто-остаток на ' || to_char(v_now, 'DD.MM.YYYY HH24:MI'),
    v_admin_id,
    v_now
  );

  -- 7. Обновляем accounts.balance (опц., balanceOf считается из movements)
  update public.accounts
    set balance = v_target_amount,
        updated_at = v_now
    where id = v_target_account_id;

  raise notice 'Crypto consolidation done: % USDT on account %', v_target_amount, v_target_account_id;
end
$consolidation$;

-- Проверка
select
  o.name as office,
  a.name as account,
  a.currency,
  a.network,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and not m.reserved
  ), 0) as balance,
  (
    select count(*)
    from public.account_movements m
    where m.account_id = a.id
  ) as movements_count
from public.accounts a
join public.offices o on o.id = a.office_id
where a.currency = 'USDT' and a.active = true
order by balance desc;
