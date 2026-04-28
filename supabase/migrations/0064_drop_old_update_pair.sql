-- ============================================================================
-- CoinPlata · 0064_drop_old_update_pair.sql
--
-- FIX: PostgREST не мог выбрать между двумя сигнатурами update_pair:
--   public.update_pair(text, text, numeric, numeric)            -- 0046, старая
--   public.update_pair(text, text, numeric, numeric, numeric)   -- 0063, новая
-- Когда frontend вызывает БЕЗ p_reverse_rate (defensive payload), PostgREST
-- видит обе кандидатур и выкидывает "Could not choose the best candidate".
--
-- 0062/0063 дропали только 5-арг версию через `drop function if exists
-- public.update_pair(text,text,numeric,numeric,numeric)`, а 4-арг (старая
-- из 0046) оставалась в БД. Этот патч её удаляет.
--
-- Также — defensive cleanup для других overloaded функций.
-- ============================================================================

-- Удаляем старую 4-аргументную сигнатуру update_pair
drop function if exists public.update_pair(text, text, numeric, numeric);

-- На всякий случай удаляем legacy 1-arg create_pair если осталась
-- (миграция 0031 → 0047 переписывала её несколько раз)
-- drop function if exists public.create_pair(text, text, numeric); -- если есть

-- Также: create_transfer с 6 args (без p_to_manager_id) — могла остаться
-- если 0052 не drop'ила её корректно. p_to_manager_id опционально по
-- defensive payload — если есть обе сигнатуры, конфликт.
drop function if exists public.create_transfer(uuid, uuid, numeric, numeric, numeric, text);

-- Проверка: после миграции должна быть только одна update_pair (5 args)
-- и одна create_transfer (7 args).
select
  proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('update_pair', 'create_transfer')
order by proname, args;
