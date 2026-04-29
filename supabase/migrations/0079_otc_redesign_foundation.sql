-- ============================================================================
-- CoinPlata · 0079_otc_redesign_foundation.sql
--
-- ФАЗА 6 OTC re-design: enum-фундамент.
--
-- Вводит новую модель «откуда приходят деньги / куда уходят»:
--
--   in_kind  ∈ { ours_now | ours_later | partner_now | partner_later }
--   out_kind ∈ { ours_now | ours_later | partner_now | partner_later }
--
--   ours_now      — мы получаем/выдаём прямо сейчас на/со своего счёта.
--   ours_later    — клиент должен нам / мы должны клиенту (отложено).
--   partner_now   — партнёр получает/выдаёт прямо сейчас на/со своего счёта.
--   partner_later — партнёр должен нам / мы должны партнёру (отложено).
--
-- Это даёт 16 комбинаций IN×OUT, покрывающих все сценарии:
--   ours_now / ours_now            — обычный обмен (legacy A)
--   ours_now / partner_now         — legacy B
--   partner_now / ours_now         — legacy C
--   partner_now / partner_now      — legacy D (брокеридж)
--   ours_now / ours_later          — клиент получит позже от нас
--   ours_later / ours_now          — клиент заплатит нам позже
--   partner_now / ours_later       — партнёр принял, мы выдадим позже
--   partner_later / ours_now       — партнёр обещал, мы уже выдали
--   ... и т.д.
--
-- Также вводит deals.kind ∈ { regular | otc | broker } для UI/аналитики.
-- regular — обычный обмен. otc — сделка с участием контрагента.
-- broker — чистый брокеридж: только commission, никакого margin.
--
-- РАСШИРЕНИЕ obligations:
--   debtor_kind / creditor_kind ∈ { us | client | partner }
--   debtor_id / creditor_id     — uuid конкретной стороны (или null для 'us')
--
-- Это покрывает 6 уникальных направлений долга:
--   us → client       (мы должны клиенту)
--   client → us       (клиент должен нам)
--   us → partner      (мы должны партнёру)
--   partner → us      (партнёр должен нам)
--   client → partner  (клиент должен партнёру, мы только свидетели)
--   partner → client  (партнёр должен клиенту)
--
-- Старое поле direction ∈ {we_owe, they_owe} остаётся для совместимости
-- (триггер автозаполняет старое из нового и наоборот).
--
-- НИЧЕГО НЕ ЛОМАЕТ. Все existing rows получают:
--   deals.kind = 'regular' (или 'otc' если был задан in_partner_account_id/leg.partner_account_id).
--   deals.in_kind = derived from in_account_id / in_partner_account_id / status.
--   deal_legs.out_kind = derived from account_id / partner_account_id.
--   obligations.debtor_kind/creditor_kind = derived from direction + client_id + partner_id.
--
-- create_deal/update_deal не трогаются — они продолжают писать через старые
-- поля. Их рефакторинг — Фаза 8 (SQL 0081).
-- ============================================================================

-- ============================================================================
-- 1. deals.kind — тип сделки
-- ============================================================================

alter table public.deals
  add column if not exists kind text;

update public.deals
   set kind = case
     when kind is not null then kind
     when in_partner_account_id is not null
       or exists (select 1 from public.deal_legs l
                  where l.deal_id = deals.id and l.partner_account_id is not null)
       then 'otc'
     else 'regular'
   end
 where kind is null;

alter table public.deals
  alter column kind set default 'regular',
  alter column kind set not null;

alter table public.deals
  drop constraint if exists deals_kind_check;
alter table public.deals
  add constraint deals_kind_check
    check (kind in ('regular','otc','broker'));

create index if not exists deals_kind_idx
  on public.deals(kind) where kind <> 'regular';

-- ============================================================================
-- 2. deals.in_kind — откуда приходят входящие деньги
-- ============================================================================

alter table public.deals
  add column if not exists in_kind text;

-- Backfill: derive из существующих полей.
-- Если ни нашего, ни партнёрского счёта нет — это deferred-сделка (legacy
-- p_deferred_in или incomplete data) → ours_later.
update public.deals
   set in_kind = case
     when in_partner_account_id is not null then 'partner_now'
     when in_account_id is not null         then 'ours_now'
     else 'ours_later'
   end
 where in_kind is null;

alter table public.deals
  alter column in_kind set default 'ours_now',
  alter column in_kind set not null;

alter table public.deals
  drop constraint if exists deals_in_kind_check;
alter table public.deals
  add constraint deals_in_kind_check
    check (in_kind in ('ours_now','ours_later','partner_now','partner_later'));

create index if not exists deals_in_kind_idx
  on public.deals(in_kind) where in_kind <> 'ours_now';

-- Согласованность in_kind с физическими полями.
-- ours_now  → должен быть in_account_id, не должно быть in_partner_account_id.
-- partner_now → должен быть in_partner_account_id, не должно быть in_account_id.
-- *_later  → ни того ни другого (живёт через obligation).
alter table public.deals
  drop constraint if exists deals_in_kind_consistency;
alter table public.deals
  add constraint deals_in_kind_consistency
    check (
      (in_kind = 'ours_now'      and in_account_id is not null and in_partner_account_id is null)
      or (in_kind = 'partner_now' and in_partner_account_id is not null and in_account_id is null)
      or (in_kind in ('ours_later','partner_later') and in_account_id is null and in_partner_account_id is null)
    );

-- ============================================================================
-- 3. deal_legs.out_kind — куда уходят исходящие деньги (per leg)
-- ============================================================================

alter table public.deal_legs
  add column if not exists out_kind text;

update public.deal_legs
   set out_kind = case
     when partner_account_id is not null then 'partner_now'
     when account_id is not null          then 'ours_now'
     else 'ours_later'
   end
 where out_kind is null;

alter table public.deal_legs
  alter column out_kind set default 'ours_now',
  alter column out_kind set not null;

alter table public.deal_legs
  drop constraint if exists deal_legs_out_kind_check;
alter table public.deal_legs
  add constraint deal_legs_out_kind_check
    check (out_kind in ('ours_now','ours_later','partner_now','partner_later'));

create index if not exists deal_legs_out_kind_idx
  on public.deal_legs(out_kind) where out_kind <> 'ours_now';

alter table public.deal_legs
  drop constraint if exists deal_legs_out_kind_consistency;
alter table public.deal_legs
  add constraint deal_legs_out_kind_consistency
    check (
      (out_kind = 'ours_now'      and account_id is not null and partner_account_id is null)
      or (out_kind = 'partner_now' and partner_account_id is not null and account_id is null)
      or (out_kind in ('ours_later','partner_later') and account_id is null and partner_account_id is null)
    );

-- ============================================================================
-- 4. obligations: 6-direction model
-- ============================================================================

alter table public.obligations
  add column if not exists debtor_kind   text,
  add column if not exists creditor_kind text,
  add column if not exists debtor_id     uuid,
  add column if not exists creditor_id   uuid;

-- Backfill из старого direction + client_id + partner_id.
-- direction='we_owe'   → us → (client | partner)
-- direction='they_owe' → (client | partner) → us
--
-- Если у legacy-строки нет ни client_id ни partner_id (только counterparty_name) —
-- оставляем debtor_kind/creditor_kind = NULL для не-нашей стороны, чтобы не
-- нарушить obligations_*_id_consistency check. UI продолжит читать
-- counterparty_name через legacy direction.
update public.obligations
   set debtor_kind = case
         when direction = 'we_owe' then 'us'
         when direction = 'they_owe' and client_id is not null then 'client'
         when direction = 'they_owe' and partner_id is not null then 'partner'
         else null
       end,
       creditor_kind = case
         when direction = 'they_owe' then 'us'
         when direction = 'we_owe' and client_id is not null then 'client'
         when direction = 'we_owe' and partner_id is not null then 'partner'
         else null
       end,
       debtor_id = case
         when direction = 'they_owe' and client_id is not null then client_id
         when direction = 'they_owe' and partner_id is not null then partner_id
         else null
       end,
       creditor_id = case
         when direction = 'we_owe' and client_id is not null then client_id
         when direction = 'we_owe' and partner_id is not null then partner_id
         else null
       end
 where debtor_kind is null and creditor_kind is null;

alter table public.obligations
  drop constraint if exists obligations_debtor_kind_check;
alter table public.obligations
  add constraint obligations_debtor_kind_check
    check (debtor_kind is null or debtor_kind in ('us','client','partner'));

alter table public.obligations
  drop constraint if exists obligations_creditor_kind_check;
alter table public.obligations
  add constraint obligations_creditor_kind_check
    check (creditor_kind is null or creditor_kind in ('us','client','partner'));

-- debtor_kind = 'us' → debtor_id IS NULL (мы — единственная организация).
-- debtor_kind <> 'us' → debtor_id обязателен (FK на clients или partners).
alter table public.obligations
  drop constraint if exists obligations_debtor_id_consistency;
alter table public.obligations
  add constraint obligations_debtor_id_consistency
    check (
      debtor_kind is null
      or (debtor_kind = 'us' and debtor_id is null)
      or (debtor_kind in ('client','partner') and debtor_id is not null)
    );

alter table public.obligations
  drop constraint if exists obligations_creditor_id_consistency;
alter table public.obligations
  add constraint obligations_creditor_id_consistency
    check (
      creditor_kind is null
      or (creditor_kind = 'us' and creditor_id is null)
      or (creditor_kind in ('client','partner') and creditor_id is not null)
    );

-- Долг сам себе невозможен.
alter table public.obligations
  drop constraint if exists obligations_distinct_sides;
alter table public.obligations
  add constraint obligations_distinct_sides
    check (
      debtor_kind is null or creditor_kind is null
      or debtor_kind <> creditor_kind
      or debtor_id is distinct from creditor_id
    );

create index if not exists obligations_debtor_idx
  on public.obligations(debtor_kind, debtor_id) where status = 'open';
create index if not exists obligations_creditor_idx
  on public.obligations(creditor_kind, creditor_id) where status = 'open';

-- ============================================================================
-- 5. Триггер двусторонней синхронизации direction ↔ debtor_kind/creditor_kind
--
-- Старые колонки (direction, client_id, partner_id) ещё используются всем
-- существующим кодом (UI, RPC). Новые (debtor_*, creditor_*) — только для
-- рефакторинга. Триггер заполняет одно из другого, чтобы оба источника
-- оставались согласованными при INSERT/UPDATE.
-- ============================================================================

create or replace function public._sync_obligation_direction()
returns trigger
language plpgsql
as $trig$
begin
  -- Если новые поля заданы, derive direction/client_id/partner_id из них.
  if new.debtor_kind is not null and new.creditor_kind is not null then
    if new.debtor_kind = 'us' and new.creditor_kind in ('client','partner') then
      new.direction := 'we_owe';
      if new.creditor_kind = 'client' then
        new.client_id := coalesce(new.client_id, new.creditor_id);
      elsif new.creditor_kind = 'partner' then
        new.partner_id := coalesce(new.partner_id, new.creditor_id);
      end if;
    elsif new.creditor_kind = 'us' and new.debtor_kind in ('client','partner') then
      new.direction := 'they_owe';
      if new.debtor_kind = 'client' then
        new.client_id := coalesce(new.client_id, new.debtor_id);
      elsif new.debtor_kind = 'partner' then
        new.partner_id := coalesce(new.partner_id, new.debtor_id);
      end if;
    end if;
    -- client↔partner случаи не имеют отображения в legacy direction.
    -- Оставляем direction как есть (может быть null).
  -- Если новые поля не заданы, derive их из старых.
  -- Только когда есть конкретный client_id или partner_id — иначе оставляем
  -- *_kind=NULL (legacy counterparty_name работает через старое direction).
  elsif new.direction is not null then
    if new.direction = 'we_owe' then
      if new.client_id is not null then
        new.debtor_kind   := coalesce(new.debtor_kind, 'us');
        new.creditor_kind := coalesce(new.creditor_kind, 'client');
        new.creditor_id   := coalesce(new.creditor_id, new.client_id);
      elsif new.partner_id is not null then
        new.debtor_kind   := coalesce(new.debtor_kind, 'us');
        new.creditor_kind := coalesce(new.creditor_kind, 'partner');
        new.creditor_id   := coalesce(new.creditor_id, new.partner_id);
      end if;
    elsif new.direction = 'they_owe' then
      if new.client_id is not null then
        new.creditor_kind := coalesce(new.creditor_kind, 'us');
        new.debtor_kind   := coalesce(new.debtor_kind, 'client');
        new.debtor_id     := coalesce(new.debtor_id, new.client_id);
      elsif new.partner_id is not null then
        new.creditor_kind := coalesce(new.creditor_kind, 'us');
        new.debtor_kind   := coalesce(new.debtor_kind, 'partner');
        new.debtor_id     := coalesce(new.debtor_id, new.partner_id);
      end if;
    end if;
  end if;
  return new;
end;
$trig$;

drop trigger if exists obligations_sync_direction on public.obligations;
create trigger obligations_sync_direction
  before insert or update on public.obligations
  for each row execute function public._sync_obligation_direction();
-- Backfill для existing rows уже выполнен в шаге 4 (UPDATE с CASE).

-- ============================================================================
-- 6. View: obligations с человеко-читаемыми именами сторон
-- ============================================================================

create or replace view public.v_obligations_directed as
select
  o.id,
  o.office_id,
  o.deal_id,
  o.deal_leg_id,
  o.currency_code,
  o.amount,
  o.paid_amount,
  o.amount - o.paid_amount as remaining_amount,
  o.status,
  o.note,
  o.created_at,
  o.closed_at,
  o.debtor_kind,
  o.debtor_id,
  case o.debtor_kind
    when 'us'      then 'Мы'
    when 'client'  then coalesce(
                          (select coalesce(c.full_name, c.nickname) from public.clients c where c.id = o.debtor_id),
                          o.counterparty_name, 'Клиент')
    when 'partner' then coalesce(
                          (select p.name from public.partners p where p.id = o.debtor_id),
                          o.counterparty_name, 'Партнёр')
    else null
  end as debtor_name,
  o.creditor_kind,
  o.creditor_id,
  case o.creditor_kind
    when 'us'      then 'Мы'
    when 'client'  then coalesce(
                          (select coalesce(c.full_name, c.nickname) from public.clients c where c.id = o.creditor_id),
                          o.counterparty_name, 'Клиент')
    when 'partner' then coalesce(
                          (select p.name from public.partners p where p.id = o.creditor_id),
                          o.counterparty_name, 'Партнёр')
    else null
  end as creditor_name,
  -- 6-канальная классификация для UI-фильтров
  case
    when o.debtor_kind = 'us'      and o.creditor_kind = 'client'  then 'us_to_client'
    when o.debtor_kind = 'client'  and o.creditor_kind = 'us'      then 'client_to_us'
    when o.debtor_kind = 'us'      and o.creditor_kind = 'partner' then 'us_to_partner'
    when o.debtor_kind = 'partner' and o.creditor_kind = 'us'      then 'partner_to_us'
    when o.debtor_kind = 'client'  and o.creditor_kind = 'partner' then 'client_to_partner'
    when o.debtor_kind = 'partner' and o.creditor_kind = 'client'  then 'partner_to_client'
    else 'unknown'
  end as flow
from public.obligations o;

-- ============================================================================
-- 7. Verify
-- ============================================================================

-- Колонки deals
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='deals'
  and column_name in ('kind','in_kind','in_account_id','in_partner_account_id')
order by ordinal_position;

-- Колонки deal_legs
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='deal_legs'
  and column_name in ('out_kind','account_id','partner_account_id')
order by ordinal_position;

-- Колонки obligations
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='obligations'
  and column_name in ('direction','debtor_kind','creditor_kind','debtor_id','creditor_id')
order by ordinal_position;

-- Распределение по новым полям
select kind, in_kind, count(*)
from public.deals
group by kind, in_kind
order by kind, in_kind;

select out_kind, count(*) from public.deal_legs
group by out_kind order by out_kind;

select debtor_kind, creditor_kind, count(*) from public.obligations
group by debtor_kind, creditor_kind order by debtor_kind, creditor_kind;

-- Подсчёт incohérence (должно быть 0)
select 'deals_in_kind_mismatch' as check_name, count(*) from public.deals
  where (in_kind = 'ours_now'      and (in_account_id is null or in_partner_account_id is not null))
     or (in_kind = 'partner_now'   and (in_partner_account_id is null or in_account_id is not null))
     or (in_kind in ('ours_later','partner_later') and (in_account_id is not null or in_partner_account_id is not null))
union all
select 'deal_legs_out_kind_mismatch', count(*) from public.deal_legs
  where (out_kind = 'ours_now'      and (account_id is null or partner_account_id is not null))
     or (out_kind = 'partner_now'   and (partner_account_id is null or account_id is not null))
     or (out_kind in ('ours_later','partner_later') and (account_id is not null or partner_account_id is not null));
