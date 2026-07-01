-- Мост CoinPoint → касса: идемпотентный upsert онлайн-заявок в manager_orders.
-- source_order_id = coinpoint bot_orders.id (стабильный ключ). sync_state хранит
-- курсор дельты по офису, чтобы подтягивать и закрытые (cancelled/done) заявки.

alter table public.manager_orders
  add column if not exists source_order_id bigint;
create unique index if not exists manager_orders_source_order_id_uq
  on public.manager_orders (source_order_id) where source_order_id is not null;

create table if not exists public.cashdesk_sync_state (
  office     text primary key,          -- coinpoint office code (ANT/IST/MSK)
  last_since timestamptz,               -- курсор: updated_at последней подтянутой заявки
  updated_at timestamptz not null default now()
);
