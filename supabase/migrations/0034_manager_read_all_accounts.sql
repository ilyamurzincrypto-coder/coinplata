-- ============================================================================
-- CoinPlata · 0034_manager_read_all_accounts.sql
--
-- Задумка: менеджер видит счета и остатки ВСЕХ офисов на главной.
-- Раньше accounts_read и movements_read давали manager'у только row'ы
-- его собственного офиса (office_id = f_office()) — балансы других
-- офисов были недоступны.
--
-- Relax-ed policies:
--   • accounts_read: пускаем owner/admin/accountant/manager — без
--     office-фильтра
--   • movements_read: тоже — чтобы balanceOf/reservedOf корректно
--     считалось для любых счетов
--
-- Writes (insert/update/delete) на accounts и movements остаются
-- ограничены (owner/admin + accountant где применимо из 0028). Manager
-- по-прежнему не может создавать/деактивировать счета.
--
-- Другие офисные scoping (deals_read, obligations_read, transfers_read,
-- expenses_read, bt_read) НЕ трогаем — manager проводит сделки только
-- в своём офисе.
-- ============================================================================

-- Accounts: все role'и читают все row'ы
drop policy if exists "accounts_read" on public.accounts;
create policy "accounts_read" on public.accounts
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- Movements: тоже — необходимо для корректного баланса
drop policy if exists "movements_read" on public.account_movements;
create policy "movements_read" on public.account_movements
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );
