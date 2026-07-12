-- docs/db/rate-and-deal-functions.sql
-- Снимок DDL с ЖИВОЙ БД (касса ygtphuxzazxdtyouxxir), снят 2026-07-12 для разбора S1.
-- Вопрос S1: «чей курс выигрывает в сделке — переданный фронтом или посчитанный сервером?»
--
-- ВЫВОД (см. docs/BUGS.md → S1):
--   • v2-путь (ЖИВОЙ, USE_NEW_LEDGER=true): create_deal_v2 книжит ТОЛЬКО leg.amount.
--     Поля leg.rate / rate_source В ПЕЙЛОАДЕ ЕСТЬ, но функция их НЕ ЧИТАЕТ — курс сделки
--     это ИСКЛЮЧИТЕЛЬНО отношение amtOut/amtIn, посчитанное фронтом.
--   • Сервер НЕ пересчитывает и НЕ валидирует курс. tx_check_balance проверяет
--     SUM(dr)=SUM(cr) ПО КАЖДОЙ ВАЛЮТЕ ОТДЕЛЬНО (IN и OUT валюты сходятся на своём
--     fx_clearing) — кросс-курс между валютами не проверяется вообще.
--   • effective_rate / deal_rate_for_leg зовёт ТОЛЬКО legacy create_deal + _update_deal_impl.
--     На живом v2-пути они мертвы.
--
--   СЛЕДСТВИЕ: фронт — единственный источник истины по курсу, серверного бэкстопа НЕТ.
--   Значит B2 (инверсия getRate для GBP/CHF и др. вне STRONG-вайтлиста) — НЕ косметика:
--   перевёрнутый курс уйдёт в проводку как реальные деньги. Приоритет B2 = critical.
--
-- Как пересникать:
--   select pg_get_functiondef('ledger.create_deal_v2(uuid,text,uuid,uuid,jsonb,jsonb,jsonb,timestamptz,text,jsonb)'::regprocedure);
--   select pg_get_functiondef('public.effective_rate(uuid,text,text)'::regprocedure);
--   select pg_get_functiondef('public.deal_rate_for_leg(bigint,text,text)'::regprocedure);

-- ─────────────────────────────────────────────────────────────────────────────
-- public.effective_rate — override офиса, иначе default-пара. Legacy-only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.effective_rate(p_office_id uuid, p_from text, p_to text)
 RETURNS numeric LANGUAGE sql STABLE
AS $function$
  select coalesce(
    (select rate from public.office_rate_overrides
      where office_id = p_office_id and from_currency = p_from and to_currency = p_to
      limit 1),
    (select rate from public.pairs
      where from_currency = p_from and to_currency = p_to and is_default
      limit 1)
  );
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- public.deal_rate_for_leg — курс из rate_snapshot сделки, иначе default-пара. Legacy-only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deal_rate_for_leg(p_deal_id bigint, p_from text, p_to text)
 RETURNS numeric LANGUAGE sql STABLE
AS $function$
  with d as (select rate_snapshot_id from public.deals where id = p_deal_id),
  snap as (select rates from public.rate_snapshots where id = (select rate_snapshot_id from d))
  select coalesce(
    ((select rates from snap) ->> (p_from || '_' || p_to))::numeric,
    (select rate from public.pairs
      where from_currency = p_from and to_currency = p_to and is_default limit 1)
  );
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ledger.create_deal_v2 — ЖИВОЙ путь. Полное тело см. в git-снимке ниже.
-- КЛЮЧЕВОЕ: во всём теле НЕТ обращения к leg->>'rate'. Книжатся только:
--   IN:  Dr in_account (amount)      / Cr fx_clearing[cur_in]  (amount)
--   OUT: Dr fx_clearing[cur_out] (amount+commission) / Cr out_account (amount)
-- Курс = amtOut/amtIn, целиком с фронта. Серверной проверки кросс-курса нет.
-- (Тело функции — 15 КБ, не дублируем; снять командой из шапки.)
