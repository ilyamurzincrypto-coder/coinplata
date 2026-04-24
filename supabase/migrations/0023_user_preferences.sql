-- ============================================================================
-- CoinPlata · 0023_user_preferences.sql
--
-- Per-user UI preferences: favoriteRatePairs, ratesExpanded и т.п.
-- Хранится как jsonb в public.users — один столбец на все пользовательские
-- настройки (удобно: нет новой таблицы, RLS уже покрыт
-- users_update_self_or_admin policy из 0001).
--
-- Использование:
--   update public.users set preferences = jsonb_set(
--     coalesce(preferences, '{}'::jsonb),
--     '{favoriteRatePairs}',
--     '[["USDT","TRY"],["USD","TRY"]]'::jsonb
--   ) where id = auth.uid();
-- ============================================================================

alter table public.users
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Существующие policies из 0001 уже позволяют self-update:
--   users_update_self_or_admin: id = auth.uid() or f_role() in ('owner','admin')
-- — значит любой юзер может писать в свой preferences.
