-- ============================================================================
-- CoinPlata · 0103_clients_referrer_id.sql
-- ============================================================================
-- Реферальная система v1.
--
-- ЦЕЛЬ: каждый client может иметь поле referrer_id — указатель на другого
-- client'а который его привёл. Используется в:
--   • UI карточки клиента — выбор «Кого привёл»
--   • Расчёт реферальных бонусов — для каждой сделки клиента с непустым
--     referrer_id начисляем процент от OUT-amount рефереру
--   • Отображение в Капитал → Рефералы — список рефереров и накопленный
--     бонус по валютам
--
-- Реферером может быть только зарегистрированный client (FK на clients).
-- Self-referral (referrer_id = id) не запрещён на уровне БД, но в UI
-- отфильтрован.
-- ============================================================================

alter table public.clients
  add column if not exists referrer_id uuid references public.clients(id)
  on delete set null;

-- Индекс для быстрого «приведённые рефером X»
create index if not exists clients_referrer_idx
  on public.clients(referrer_id)
  where referrer_id is not null;

-- Sanity check
select
  (select count(*) from information_schema.columns
   where table_schema='public' and table_name='clients' and column_name='referrer_id') as has_column;
