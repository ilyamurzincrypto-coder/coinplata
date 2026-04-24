-- ============================================================================
-- CoinPlata · 0020_rate_snapshots_realtime.sql
--
-- Добавляет rate_snapshots и pairs в realtime publication, чтобы
-- фронт автоматически получал INSERT-уведомления и refresh-ил Rate History.
--
-- Симптом: изменяем курс через SQL или UI, в rate_snapshots запись
-- создаётся триггером (0017), но UI History не обновляется пока не
-- сделать refresh страницы.
--
-- Применять в Supabase SQL Editor. Безопасно при повторе.
-- ============================================================================

-- alter publication idempotent — если уже добавлено, бросает notice, не error.
-- Оборачиваем в DO чтобы не падать на повторном применении.
do $$
begin
  begin
    alter publication supabase_realtime add table public.rate_snapshots;
  exception when duplicate_object then
    raise notice 'rate_snapshots already in publication';
  end;
end $$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.pairs;
  exception when duplicate_object then
    raise notice 'pairs already in publication';
  end;
end $$;

-- Проверка:
--   select pubname, tablename
--     from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename in ('rate_snapshots', 'pairs');
