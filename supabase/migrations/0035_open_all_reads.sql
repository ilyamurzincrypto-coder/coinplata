-- ============================================================================
-- CoinPlata · 0035_open_all_reads.sql
--
-- Полная открытость read-policies для всех авторизованных пользователей
-- с любой ролью (owner/admin/accountant/manager). Убираем офисный
-- scoping из всех SELECT policies.
--
-- Задумка: команда внутренняя, менеджер должен видеть счета/остатки/
-- сделки/обязательства/трансферы/расходы всех офисов для работы с
-- главного дашборда.
--
-- Writes (insert/update/delete) — НЕ трогаем, они по-прежнему гейтятся
-- per-policy (accounts только owner/admin/accountant, expenses — тоже,
-- deals/movements/transfers пускают manager'а и т.п.).
--
-- Повторно применяет 0034 (accounts_read, movements_read) на случай
-- если 0034 не прогонялся.
-- ============================================================================

-- accounts
drop policy if exists "accounts_read" on public.accounts;
create policy "accounts_read" on public.accounts
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- account_movements
drop policy if exists "movements_read" on public.account_movements;
create policy "movements_read" on public.account_movements
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- deals
drop policy if exists "deals_read" on public.deals;
create policy "deals_read" on public.deals
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- deal_legs
drop policy if exists "legs_read" on public.deal_legs;
create policy "legs_read" on public.deal_legs
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- obligations
drop policy if exists "obligations_read" on public.obligations;
create policy "obligations_read" on public.obligations
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- transfers
drop policy if exists "transfers_read" on public.transfers;
create policy "transfers_read" on public.transfers
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- expenses
drop policy if exists "expenses_read" on public.expenses;
create policy "expenses_read" on public.expenses
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- blockchain_txs
drop policy if exists "bt_read" on public.blockchain_txs;
create policy "bt_read" on public.blockchain_txs
  for select to authenticated using (
    public.f_role() in ('owner','admin','accountant','manager')
  );

-- Проверка: покажи текущие SELECT policies
select tablename, policyname, qual
  from pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and tablename in (
      'accounts','account_movements','deals','deal_legs',
      'obligations','transfers','expenses','blockchain_txs'
    )
  order by tablename, policyname;
