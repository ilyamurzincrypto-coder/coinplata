-- ============================================================================
-- CoinPlata · 0096_grant_accounting_feed.sql
--
-- Контекст: 0095 пересоздал view через DROP CASCADE + CREATE. Привилегии
-- (grants) на view при DROP уничтожаются и НЕ восстанавливаются автоматом
-- при новом CREATE.
--
-- В результате: SQL Editor (роль postgres) видит data, а клиент через
-- PostgREST (роль authenticated/anon) получает permission denied — фронт
-- показывает "ничего нет" в репорте.
--
-- Фикс: явный GRANT SELECT на роли authenticated и anon.
-- ============================================================================

grant select on public.v_accounting_feed to authenticated;
grant select on public.v_accounting_feed to anon;

-- На всякий случай — те же гранты для view с балансовыми корректировками
-- и v_account_balances, чтобы не повторять этот же баг для других мест.
grant select on public.v_balance_adjustments to authenticated;
grant select on public.v_balance_adjustments to anon;

-- Verify
select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('v_accounting_feed', 'v_balance_adjustments')
  order by table_name, grantee;
