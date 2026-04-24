-- ============================================================================
-- CoinPlata · 0026_remove_international_cash.sql
--
-- Hotfix к 0025: International office — банковский, наличных там не держим.
-- 0025 по ошибке залил туда Cash · {CODE} на каждую fiat. Удаляем их
-- при условии opening_balance=0 И нет движений (безопасно: эти счета
-- только что созданы, никогда не использовались).
-- ============================================================================

do $fix$
declare
  v_intl uuid;
  v_removed int := 0;
begin
  select id into v_intl from public.offices
    where name ilike '%international%' and active = true
    order by created_at limit 1;

  if v_intl is null then
    raise notice 'International office not found — nothing to clean';
    return;
  end if;

  -- Деактивируем вместо физического delete, чтобы гарантированно не задеть
  -- ничего FK-связанного. Но сперва смотрим — если нулевой баланс и нет
  -- движений, можно и delete. Идём безопасно — через active=false.
  with targets as (
    select a.id
    from public.accounts a
    where a.office_id = v_intl
      and a.type = 'cash'
      and a.opening_balance = 0
      and not exists (
        select 1 from public.account_movements m where m.account_id = a.id
      )
  )
  update public.accounts
    set active = false
    where id in (select id from targets) and active = true;

  get diagnostics v_removed = row_count;
  raise notice 'Deactivated % International cash accounts (opening=0, no movements)', v_removed;
end
$fix$;
