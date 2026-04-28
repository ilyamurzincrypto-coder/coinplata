-- ============================================================================
-- CoinPlata · 0067_crypto_full_wipe.sql
--
-- Полная замена USDT-баланса. 0066 удалил только opening/topup, но deal/
-- transfer movements остались и суммировались со старыми показателями.
-- Теперь стираем ВСЕ USDT movements (любого source_kind) и ставим один
-- opening 228 538.65 на Mark Antalya / TRC20.
--
-- ВНИМАНИЕ: deals и transfers записи в их таблицах остаются — стираются
-- только связанные account_movements. Бизнес-история (тип сделок, сумма,
-- comment, дата) в public.deals не теряется. Просто баланс пересоберётся
-- с чистого листа.
--
-- Когда вечером будешь делать актуальную разбивку — в 0068 удали этот
-- opening и поставь по каждому реальному счёту корректное значение.
-- ============================================================================

do $wipe$
declare
  v_target_account_id uuid;
  v_office_id uuid;
  v_admin_id uuid;
  v_target_amount numeric := 228538.65;
  v_now timestamptz := now();
  v_deleted int;
begin
  -- Mark Antalya office
  select id into v_office_id
    from public.offices
    where lower(name) like '%mark%antalya%'
       or lower(name) like '%antalya%mark%'
    limit 1;
  if v_office_id is null then
    select id into v_office_id
      from public.offices
      where lower(name) like '%antalya%' or lower(name) like '%mark%'
      order by
        case
          when lower(name) like '%antalya%' then 1
          when lower(name) like '%mark%' then 2
          else 3
        end
      limit 1;
  end if;
  if v_office_id is null then
    raise exception 'Не найден офис Mark/Antalya';
  end if;

  -- Admin для created_by
  select id into v_admin_id from public.users
    where role in ('owner', 'admin') and status = 'active'
    limit 1;

  -- USDT TRC20 счёт в Mark Antalya
  select id into v_target_account_id
    from public.accounts
    where office_id = v_office_id
      and currency_code = 'USDT'
      and active = true
      and (
        upper(coalesce(network_id, '')) = 'TRC20'
        or upper(coalesce(name, '')) like '%TRC20%'
      )
    limit 1;

  if v_target_account_id is null then
    insert into public.accounts (
      id, office_id, name, type, currency_code, network_id, active, opening_balance
    ) values (
      gen_random_uuid(), v_office_id, 'USDT TRC20', 'crypto', 'USDT', 'TRC20',
      true, 0
    ) returning id into v_target_account_id;
    raise notice 'Created USDT TRC20 account in Mark Antalya';
  end if;

  raise notice 'Target account: %', v_target_account_id;

  -- ПОЛНЫЙ wipe всех movements у USDT счетов — любого source_kind.
  -- Старые deal/transfer movements тоже удаляются, иначе сумма не
  -- сходится. Сами deals/transfers в их таблицах остаются.
  delete from public.account_movements
    where account_id in (
      select id from public.accounts where currency_code = 'USDT'
    );
  get diagnostics v_deleted = row_count;
  raise notice 'Deleted % USDT movements (full wipe)', v_deleted;

  -- Один opening на целевой счёт
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
    'Полный реset крипто-остатка на ' || to_char(v_now, 'DD.MM.YYYY HH24:MI'),
    v_admin_id,
    v_now
  );

  -- legacy opening_balance — обнуляем все USDT счета и ставим целевую сумму
  update public.accounts set opening_balance = 0 where currency_code = 'USDT';
  update public.accounts set opening_balance = v_target_amount where id = v_target_account_id;

  raise notice 'Done: % USDT on % (single account)', v_target_amount, v_target_account_id;
end
$wipe$;

-- Проверка: total по всем USDT счетам должен быть ровно 228 538.65
select
  o.name as office,
  a.name as account,
  a.network_id,
  coalesce((
    select sum(case when m.direction = 'in' then m.amount else -m.amount end)
    from public.account_movements m
    where m.account_id = a.id and not m.reserved
  ), 0) as balance,
  (
    select count(*) from public.account_movements m where m.account_id = a.id
  ) as movements_count
from public.accounts a
join public.offices o on o.id = a.office_id
where a.currency_code = 'USDT' and a.active = true
order by balance desc;

-- Grand total — должен быть 228538.65
select
  'GRAND TOTAL USDT' as label,
  coalesce(sum(case when m.direction = 'in' then m.amount else -m.amount end), 0) as total
from public.account_movements m
join public.accounts a on a.id = m.account_id
where a.currency_code = 'USDT' and not m.reserved;
