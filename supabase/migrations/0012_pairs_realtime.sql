-- ============================================================================
-- CoinPlata · 0012_pairs_realtime.sql
-- Подписываем pairs на realtime publication чтобы клиенты получали
-- UPDATE-события при изменении курсов.
-- ============================================================================

-- На всякий случай сначала проверяем не добавлено ли уже
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pairs'
  ) then
    alter publication supabase_realtime add table public.pairs;
  end if;
end $$;

-- REPLICA IDENTITY — оставляем DEFAULT (primary key). payload.new в UPDATE
-- всё равно содержит полную новую строку; старые значения берём из
-- frontend-кэша в момент события.
