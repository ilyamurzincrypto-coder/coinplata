-- ============================================================================
-- CoinPlata · 0043_rls_hardening.sql
--
-- Defence-in-depth поверх 0042 (RPC authz). Закрываем HIGH/MEDIUM:
--
--   * clients_write / clients_update / wallets_write: были `with check (true)`
--     — любой авторизованный мог писать. Теперь — role gate.
--   * accounts_write_admin / accounts_update_admin: admin мог писать в любой
--     офис. Теперь admin ограничен своим office (owner — везде, как и был).
--   * deals_write / deals_update: manager мог писать с manager_id != auth.uid().
--     Теперь enforced manager_id = auth.uid() для роли manager.
--   * expenses_write / expenses_delete: accountant мог писать/удалять в любом
--     офисе. Теперь — office check (admin/accountant — свой офис, owner — везде).
--   * audit_write: было `with check (true)` — клиент мог логировать от чужого
--     имени. Теперь user_id обязан совпадать с auth.uid() (или быть NULL).
--
-- Не трогаем: read-policies (0035 сознательно открыл всё для удобства),
-- *_read scoping, обязательно reading own profile (users_read).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- clients: разрешаем write только бизнес-ролям (manager создаёт клиента
-- при новой сделке через ensureClient, accountant правит профили,
-- admin/owner — всё).
-- ----------------------------------------------------------------------------
drop policy if exists "clients_write" on public.clients;
drop policy if exists "clients_update" on public.clients;

create policy "clients_write" on public.clients for insert to authenticated
  with check (public.f_role() in ('owner','admin','accountant','manager'));

create policy "clients_update" on public.clients for update to authenticated
  using (public.f_role() in ('owner','admin','accountant','manager'))
  with check (public.f_role() in ('owner','admin','accountant','manager'));

-- ----------------------------------------------------------------------------
-- client_wallets: то же самое + добавляем update policy (раньше её не было,
-- что блокировало usage_count инкременты от менеджеров — но текущий код
-- идёт через RPC upsert_client_wallet, так что не сломаем).
-- ----------------------------------------------------------------------------
drop policy if exists "wallets_write" on public.client_wallets;
drop policy if exists "wallets_update" on public.client_wallets;

create policy "wallets_write" on public.client_wallets for insert to authenticated
  with check (public.f_role() in ('owner','admin','accountant','manager'));

create policy "wallets_update" on public.client_wallets for update to authenticated
  using (public.f_role() in ('owner','admin','accountant','manager'))
  with check (public.f_role() in ('owner','admin','accountant','manager'));

-- ----------------------------------------------------------------------------
-- accounts: owner пишет везде; admin — только в свой office (если f_office()
-- IS NULL — значит admin "глобальный" / без привязки → пускаем). Это
-- предотвращает создание счетов в чужих офисах через прямой PostgREST insert.
-- ----------------------------------------------------------------------------
drop policy if exists "accounts_write_admin" on public.accounts;
drop policy if exists "accounts_update_admin" on public.accounts;

create policy "accounts_write_admin" on public.accounts for insert to authenticated
  with check (
    public.f_role() = 'owner'
    or (
      public.f_role() = 'admin'
      and (public.f_office() is null or office_id = public.f_office())
    )
  );

create policy "accounts_update_admin" on public.accounts for update to authenticated
  using (
    public.f_role() = 'owner'
    or (
      public.f_role() = 'admin'
      and (public.f_office() is null or office_id = public.f_office())
    )
  )
  with check (
    public.f_role() = 'owner'
    or (
      public.f_role() = 'admin'
      and (public.f_office() is null or office_id = public.f_office())
    )
  );

-- ----------------------------------------------------------------------------
-- deals: manager обязан ставить manager_id = auth.uid(). Owner/admin/accountant
-- могут писать с любым manager_id (для backfill / правок). Это второй слой
-- защиты — RPC create_deal/update_deal уже это enforce'ит, но если кто-то
-- bypass'ит RPC и пишет напрямую — RLS поймает.
-- ----------------------------------------------------------------------------
drop policy if exists "deals_write" on public.deals;
drop policy if exists "deals_update" on public.deals;

create policy "deals_write" on public.deals for insert to authenticated
  with check (
    public.f_role() in ('owner','admin','accountant')
    or (public.f_role() = 'manager' and manager_id = auth.uid())
  );

create policy "deals_update" on public.deals for update to authenticated
  using (
    public.f_role() in ('owner','admin','accountant')
    or (public.f_role() = 'manager' and manager_id = auth.uid())
  )
  with check (
    public.f_role() in ('owner','admin','accountant')
    or (public.f_role() = 'manager' and manager_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- expenses: office check для admin/accountant (owner — везде). insertExpense
-- вызывается из фронта через .from('expenses').insert (не RPC), поэтому
-- здесь enforce обязателен — иначе accountant записывает расход в чужой
-- офис, проставляя office_id вручную.
-- ----------------------------------------------------------------------------
drop policy if exists "expenses_write" on public.expenses;
drop policy if exists "expenses_delete" on public.expenses;

create policy "expenses_write" on public.expenses for insert to authenticated
  with check (
    public.f_role() = 'owner'
    or (
      public.f_role() in ('admin','accountant')
      and (public.f_office() is null or office_id = public.f_office())
    )
  );

create policy "expenses_delete" on public.expenses for delete to authenticated
  using (
    public.f_role() = 'owner'
    or (
      public.f_role() in ('admin','accountant')
      and (public.f_office() is null or office_id = public.f_office())
    )
  );

-- ----------------------------------------------------------------------------
-- audit_log: было `with check (true)` — клиент мог писать row с user_id
-- любого юзера. Теперь user_id обязан совпадать с auth.uid() либо быть NULL
-- (для системных событий, генерируемых триггерами).
-- ----------------------------------------------------------------------------
drop policy if exists "audit_write" on public.audit_log;

create policy "audit_write" on public.audit_log for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

-- Проверка: показать актуальные WRITE policies для всех затронутых таблиц.
select tablename, policyname, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and tablename in ('clients','client_wallets','accounts','deals','expenses','audit_log')
    and cmd in ('INSERT','UPDATE','DELETE')
  order by tablename, cmd, policyname;
