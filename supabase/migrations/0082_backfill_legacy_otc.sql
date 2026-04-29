-- ============================================================================
-- CoinPlata · 0082_backfill_legacy_otc.sql
--
-- ФАЗА 12: backfill legacy OTC сделок в новую kind/in_kind/out_kind модель.
--
-- Контекст. До 0077 OTC сделки создавались через `create_otc_deal` (0069 →
-- расширен в 0072 partner_pays_client → расширен в 0073 partner_deferred).
-- Эти сделки записывали в `deals.comment` суффиксы:
--   ' [OTC]'                        — стандартная OTC
--   ' [OTC · partner pays client]'  — партнёр выдал клиенту напрямую
--   ' [OTC · partner deferred]'     — партнёр обещал зачислить позже
--
-- Миграция 0079 уже сделала backfill `kind`, `in_kind`, `out_kind` на основе
-- наличия `in_account_id` / `in_partner_account_id` / `partner_account_id`.
-- Все legacy OTC получили `kind='regular'`, `in_kind='ours_now'`,
-- `out_kind='ours_now'` — потому что у них всегда был `in_account_id`
-- (наш счёт) и `deal_legs.account_id` (наш счёт).
--
-- Технически это правильно (деньги шли через наши счета и в legacy режимах
-- partner_pays_client / partner_deferred тоже — на in_account_id ссылка
-- сохранилась как метаданные, хоть movement и не создавался). Но теряется
-- ВИДИМОСТЬ: пользователь не может отличить «обычный обмен» от «исторической
-- OTC сделки» в UI / Capital фильтрах.
--
-- Этот скрипт ставит `kind='otc'` для всех сделок с маркером '[OTC' в
-- comment, ничего больше не меняя. Исторические данные движений и
-- obligations остаются как есть.
--
-- Идемпотентен — повторный запуск не делает повторных изменений (where kind = 'regular').
-- ============================================================================

-- 1. Pre-check: counts before
select 'before' as snapshot,
       sum(case when kind = 'regular' then 1 else 0 end) as regular,
       sum(case when kind = 'otc' then 1 else 0 end)     as otc,
       sum(case when kind = 'broker' then 1 else 0 end)  as broker,
       sum(case when comment like '%[OTC%' then 1 else 0 end) as has_otc_marker
from public.deals;

-- 2. Mark legacy OTC deals as kind='otc'
update public.deals
   set kind = 'otc'
 where kind = 'regular'
   and (
     comment like '% [OTC]%'
     or comment like '% [OTC ·%'
     or comment like '%[OTC]%'
     or comment like '%[OTC ·%'
   );

-- 3. Post-check: counts after
select 'after' as snapshot,
       sum(case when kind = 'regular' then 1 else 0 end) as regular,
       sum(case when kind = 'otc' then 1 else 0 end)     as otc,
       sum(case when kind = 'broker' then 1 else 0 end)  as broker
from public.deals;

-- 4. Sanity: все otc-сделки должны иметь at least один deal_leg
select 'otc_deals_without_legs' as check_name, count(*) from public.deals d
  where d.kind = 'otc'
    and not exists (select 1 from public.deal_legs l where l.deal_id = d.id);

-- 5. Распределение in_kind среди otc-сделок (для верификации backfill 0079)
select kind, in_kind, count(*)
  from public.deals
  where kind in ('otc','broker')
  group by kind, in_kind
  order by kind, in_kind;

-- 6. Sample легаси OTC сделок (первые 10 для глаз-проверки)
select id, kind, in_kind, type,
       substring(comment, 1, 80) as comment_preview,
       client_nickname,
       created_at::date as created
  from public.deals
  where kind = 'otc'
  order by created_at desc
  limit 10;
