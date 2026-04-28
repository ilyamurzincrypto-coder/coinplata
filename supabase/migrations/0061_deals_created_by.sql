-- ============================================================================
-- CoinPlata · 0061_deals_created_by.sql
--
-- Добавляем deals.created_by_user_id чтобы отличать "кто реально создал
-- сделку" от manager_id ("на чьё имя"). Когда admin/owner создаёт сделку
-- через manager picker (от имени manager X), у нас:
--   manager_id          = X (выбранный)
--   created_by_user_id  = auth.uid() (реальный создатель = admin/owner)
--
-- Если manager_id ≠ created_by_user_id — это означает "сделка назначена
-- на менеджера X кем-то другим". Frontend (NotificationsProvider) ловит
-- INSERT realtime и шлёт пуш менеджеру X: "вам назначена сделка #N от
-- {creator_name}".
--
-- Реализация без изменения create_deal RPC: BEFORE INSERT trigger
-- автоматически ставит created_by_user_id = auth.uid() если RPC его
-- не передал.
-- ============================================================================

alter table public.deals
  add column if not exists created_by_user_id uuid references public.users(id);

create index if not exists deals_created_by_idx on public.deals(created_by_user_id);

-- BEFORE INSERT trigger: автоматически записывает auth.uid() как создателя.
-- Не перезаписывает явно переданное значение (на случай если RPC сам ставит).
create or replace function public._deals_set_created_by()
returns trigger
language plpgsql
as $func$
begin
  if NEW.created_by_user_id is null then
    NEW.created_by_user_id := auth.uid();
  end if;
  return NEW;
end;
$func$;

drop trigger if exists deals_set_created_by_trg on public.deals;
create trigger deals_set_created_by_trg
  before insert on public.deals
  for each row
  execute function public._deals_set_created_by();

-- Backfill: исторические записи получают created_by_user_id = manager_id
-- (раньше "кто создал" и "за кем закреплено" совпадали — manager_id ≈ creator).
update public.deals
  set created_by_user_id = manager_id
  where created_by_user_id is null;
