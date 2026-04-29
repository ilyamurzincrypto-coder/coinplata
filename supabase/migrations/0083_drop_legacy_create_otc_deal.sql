-- ============================================================================
-- CoinPlata · 0083_drop_legacy_create_otc_deal.sql
--
-- ФАЗА 13: drop legacy create_otc_deal RPC (финальная очистка OTC re-design).
--
-- Контекст. До 0077 быстрая OTC сделка между двумя нашими счетами шла через
-- отдельный RPC `create_otc_deal` (введён в 0069, расширен в 0072 + 0073).
-- Он писал deal с двумя movements + опциональной obligation, но НЕ
-- использовал fee_usd / profit_usd / margin / commission механизм.
--
-- После 0081 + миграции OtcDealModal.jsx на rpcCreateDeal (Phase 13 frontend),
-- legacy RPC больше не вызывается из JS — всё OTC проходит через единый
-- create_deal с kind='otc'.
--
-- Этот скрипт удаляет:
--   1. create_otc_deal — все три перегрузки (0069 / 0072 / 0073)
--
-- НИЧЕГО НЕ ЛОМАЕТ существующие данные. Уже созданные сделки (deals,
-- deal_legs, account_movements, obligations) остаются нетронутыми. 0082
-- уже промаркировал их kind='otc'.
--
-- НЕ ЗАПУСКАЙ это, пока не убедишься что:
--   - npm run build проходит без ошибок
--   - OtcDealModal на AccountsPage создаёт сделки через новый rpcCreateDeal
--   - в логах нет вызовов "create_otc_deal" из live-сессий
-- ============================================================================

-- 1. Pre-check: убедиться что функция существует и не используется логом
select n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_otc_deal';

-- 2. Drop всех версий create_otc_deal.
-- Сигнатуры по 0069 → 0072 → 0073:
--   0069: (uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz)
--   0072: + boolean (p_partner_pays_client)
--   0073: + boolean (p_partner_deferred)
drop function if exists public.create_otc_deal(
  uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz
);
drop function if exists public.create_otc_deal(
  uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz, boolean
);
drop function if exists public.create_otc_deal(
  uuid, uuid, numeric, uuid, numeric, numeric, text, text, timestamptz, boolean, boolean
);

-- 3. Verify: функция должна исчезнуть.
select count(*) as remaining_create_otc_deal
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_otc_deal';
-- Ожидаемое: 0

-- 4. Sanity: остальные create/update_deal RPC на месте.
select n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_deal','update_deal','add_deal_in_payment','add_deal_leg_payment')
order by p.proname, signature;
