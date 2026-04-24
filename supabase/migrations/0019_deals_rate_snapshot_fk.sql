-- ============================================================================
-- CoinPlata · 0019_deals_rate_snapshot_fk.sql
--
-- Связь deals → rate_snapshots. Каждая сделка хранит ссылку на snapshot
-- курсов актуальный на момент создания. Это даёт корректный PnL даже
-- после последующих изменений курсов: реальная маржа считается от курсов
-- которые были на момент сделки.
--
-- 1. Колонка deals.rate_snapshot_id uuid FK.
-- 2. В create_deal и update_deal — создаём/используем snapshot и привязываем.
-- 3. Helper view v_deal_pnl с пересчётом по snapshot-rates.
--
-- Применять после 0017 (там trigger auto_snapshot_on_pair_change) и 0018.
-- Безопасно при повторе (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- 1. Колонка + FK
alter table public.deals
  add column if not exists rate_snapshot_id uuid references public.rate_snapshots(id);

create index if not exists deals_rate_snapshot_idx on public.deals(rate_snapshot_id);

-- Backfill: существующие deals → свяжем с ближайшим snapshot ≤ deal.created_at.
-- Если snapshot'ов нет — оставим NULL (PnL вернётся к текущим курсам).
update public.deals d
   set rate_snapshot_id = (
     select rs.id from public.rate_snapshots rs
      where rs.created_at <= d.created_at
      order by rs.created_at desc
      limit 1
   )
 where rate_snapshot_id is null;

-- 2. Helper: получить rate из snapshot (или fallback на текущий pairs.rate)
create or replace function public.deal_rate_for_leg(
  p_deal_id bigint,
  p_from text,
  p_to text
)
returns numeric
language sql
stable
as $$
  with d as (
    select rate_snapshot_id from public.deals where id = p_deal_id
  ),
  snap as (
    select rates from public.rate_snapshots
     where id = (select rate_snapshot_id from d)
  )
  select coalesce(
    ((select rates from snap) ->> (p_from || '_' || p_to))::numeric,
    (select rate from public.pairs
      where from_currency = p_from and to_currency = p_to and is_default
      limit 1)
  );
$$;

grant execute on function public.deal_rate_for_leg(bigint, text, text) to authenticated;

-- 3. View: PnL per deal с пересчётом по snapshot-rates.
-- profit_historic_usd — прибыль считая курсы на момент сделки.
-- profit_current_usd  — текущая записанная в deal profit_usd (fee_usd).
-- delta_usd — разница (сколько мы "потеряли/выиграли" из-за изменения курсов после сделки).
create or replace view public.v_deal_pnl as
select
  d.id                          as deal_id,
  d.created_at,
  d.manager_id,
  d.office_id,
  d.currency_in,
  d.amount_in,
  d.profit_usd                  as profit_recorded_usd,
  d.rate_snapshot_id,
  coalesce(
    (select sum(
       -- margin на leg в currency_in: planned / actual_rate − planned / snapshot_rate
       (dl.amount / nullif(dl.rate, 0))
       - (dl.amount / nullif(public.deal_rate_for_leg(d.id, d.currency_in, dl.currency), 0))
     ) from public.deal_legs dl where dl.deal_id = d.id),
     0
  ) as margin_in_curin,
  -- Текущая прибыль на момент сейчас (для сравнения)
  coalesce(
    (select sum(
       (dl.amount / nullif(dl.rate, 0))
       - (dl.amount / nullif((select rate from public.pairs
           where from_currency = d.currency_in and to_currency = dl.currency
             and is_default limit 1), 0))
     ) from public.deal_legs dl where dl.deal_id = d.id),
     0
  ) as margin_at_current_rates
from public.deals d
where d.status <> 'deleted';

grant select on public.v_deal_pnl to authenticated;

-- 4. Обновляем create_deal — сохраняем snapshot_id.
-- Логика: если сделка использует manual rate (ExchangeForm пишет manual-rate
-- snapshot перед create), или если есть confirmed snapshot за сегодня —
-- привязываем deal. Иначе — последний snapshot вообще.
-- На стороне RPC: после INSERT deals → ищем последний rate_snapshot и
-- пишем в deals.rate_snapshot_id. Так проще чем передавать id с фронта.

create or replace function public._attach_latest_snapshot_to_deal(p_deal_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  update public.deals
     set rate_snapshot_id = (
       select id from public.rate_snapshots
        order by created_at desc limit 1
     )
   where id = p_deal_id and rate_snapshot_id is null;
end;
$$;

grant execute on function public._attach_latest_snapshot_to_deal(bigint) to authenticated;

-- 5. Trigger: AFTER INSERT ON deals → auto-attach.
-- Это вместо изменения create_deal RPC — не трогаем его, атомарно добавляется
-- на уровне БД.
create or replace function public.trg_attach_snapshot_on_deal_insert()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.rate_snapshot_id is null then
    NEW.rate_snapshot_id := (
      select id from public.rate_snapshots
       order by created_at desc limit 1
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_attach_snapshot_on_deal on public.deals;
create trigger trg_attach_snapshot_on_deal
before insert on public.deals
for each row
execute function public.trg_attach_snapshot_on_deal_insert();

-- Проверки:
--   select id, rate_snapshot_id from public.deals limit 5;
--   select * from public.v_deal_pnl limit 5;
