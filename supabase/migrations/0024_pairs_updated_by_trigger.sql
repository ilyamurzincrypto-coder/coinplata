-- ============================================================================
-- CoinPlata · 0024_pairs_updated_by_trigger.sql
--
-- Автозаполнение pairs.updated_by = auth.uid() для корректной фильтрации
-- "свои vs чужие" в notifications (store/notifications.jsx).
--
-- Баг: frontend `rpcUpdatePair` не писал updated_by при UPDATE pairs.
-- Колонка schema-определена (0001), но никто не клал туда uid. В итоге
-- realtime payload.new.updated_by = NULL → фильтр
--   `if (row.updated_by && row.updated_by === currentUser.id) return;`
-- не срабатывал → юзер получал notification "курс изменился" о своих
-- собственных правках ("by someone").
--
-- Fix: before update trigger — всегда проставляем updated_by = auth.uid()
-- и updated_at = now(). Для security-definer вызовов где auth.uid() = NULL
-- — сохраняем то что было в new (coalesce), чтобы не затирать явно
-- переданное значение.
-- ============================================================================

create or replace function public.f_pairs_set_updated_by()
returns trigger
language plpgsql
security invoker
as $func$
begin
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  new.updated_at = now();
  return new;
end;
$func$;

drop trigger if exists pairs_set_updated_by on public.pairs;
create trigger pairs_set_updated_by
  before update on public.pairs
  for each row execute function public.f_pairs_set_updated_by();
