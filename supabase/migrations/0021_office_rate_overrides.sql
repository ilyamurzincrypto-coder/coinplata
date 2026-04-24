-- ============================================================================
-- CoinPlata · 0021_office_rate_overrides.sql
--
-- Per-office rate overrides. Позволяет задать свой курс для конкретного
-- офиса поверх глобального pairs.rate. Если override отсутствует —
-- используется global. Один office x pair = одна запись.
--
-- Модель:
--   office_id uuid  → offices(id)
--   from_currency / to_currency → currencies(code)
--   base_rate numeric — сохранённое значение (как у pairs)
--   spread_percent numeric default 0 — override spread per office
--   rate generated — base * (1 + spread/100)
--   updated_at / updated_by — audit
--
-- Применять в Supabase SQL Editor. Безопасно при повторе.
-- ============================================================================

create table if not exists public.office_rate_overrides (
  office_id        uuid not null references public.offices(id) on delete cascade,
  from_currency    text not null references public.currencies(code),
  to_currency      text not null references public.currencies(code),
  base_rate        numeric(20,10) not null,
  spread_percent   numeric(8,4)   not null default 0,
  rate             numeric(20,10) generated always as
                   (base_rate * (1 + spread_percent / 100)) stored,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.users(id) on delete set null,
  primary key (office_id, from_currency, to_currency),
  check (from_currency <> to_currency)
);

create index if not exists office_rate_overrides_office_idx
  on public.office_rate_overrides(office_id);

-- RLS
alter table public.office_rate_overrides enable row level security;

drop policy if exists "ofc_rates_read" on public.office_rate_overrides;
create policy "ofc_rates_read" on public.office_rate_overrides
  for select to authenticated using (true);

drop policy if exists "ofc_rates_write_admin" on public.office_rate_overrides;
create policy "ofc_rates_write_admin" on public.office_rate_overrides
  for insert to authenticated
  with check (public.f_role() in ('owner','admin'));

drop policy if exists "ofc_rates_update_admin" on public.office_rate_overrides;
create policy "ofc_rates_update_admin" on public.office_rate_overrides
  for update to authenticated
  using (public.f_role() in ('owner','admin'))
  with check (public.f_role() in ('owner','admin'));

drop policy if exists "ofc_rates_delete_admin" on public.office_rate_overrides;
create policy "ofc_rates_delete_admin" on public.office_rate_overrides
  for delete to authenticated
  using (public.f_role() in ('owner','admin'));

-- Upsert helper: вставить/обновить запись
create or replace function public.upsert_office_rate_override(
  p_office_id uuid,
  p_from text,
  p_to text,
  p_rate numeric,
  p_spread numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text;
begin
  select role into v_caller_role from public.users where id = auth.uid();
  if v_caller_role not in ('owner','admin') then
    raise exception 'Only owner/admin can set per-office rates' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'Rate must be > 0' using errcode = '22000';
  end if;
  insert into public.office_rate_overrides(office_id, from_currency, to_currency, base_rate, spread_percent, updated_by, updated_at)
  values (p_office_id, upper(trim(p_from)), upper(trim(p_to)), p_rate, coalesce(p_spread, 0), auth.uid(), now())
  on conflict (office_id, from_currency, to_currency) do update set
    base_rate      = excluded.base_rate,
    spread_percent = excluded.spread_percent,
    updated_by     = excluded.updated_by,
    updated_at     = now();
end;
$func$;

grant execute on function public.upsert_office_rate_override(uuid, text, text, numeric, numeric) to authenticated;

-- Delete helper
create or replace function public.delete_office_rate_override(
  p_office_id uuid,
  p_from text,
  p_to text
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text;
begin
  select role into v_caller_role from public.users where id = auth.uid();
  if v_caller_role not in ('owner','admin') then
    raise exception 'Only owner/admin' using errcode = '42501';
  end if;
  delete from public.office_rate_overrides
   where office_id = p_office_id
     and from_currency = upper(trim(p_from))
     and to_currency = upper(trim(p_to));
end;
$func$;

grant execute on function public.delete_office_rate_override(uuid, text, text) to authenticated;

-- Realtime publication (идемпотентно)
do $$ begin
  begin
    alter publication supabase_realtime add table public.office_rate_overrides;
  exception when duplicate_object then raise notice 'already in publication'; end;
end $$;

-- Effective rate lookup: override > global
create or replace function public.effective_rate(
  p_office_id uuid,
  p_from text,
  p_to text
)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select rate from public.office_rate_overrides
      where office_id = p_office_id
        and from_currency = p_from
        and to_currency = p_to
      limit 1),
    (select rate from public.pairs
      where from_currency = p_from and to_currency = p_to and is_default
      limit 1)
  );
$$;

grant execute on function public.effective_rate(uuid, text, text) to authenticated;

-- Проверки:
--   select public.upsert_office_rate_override('<office-uuid>', 'USD', 'TRY', 45.5);
--   select * from public.office_rate_overrides;
--   select public.effective_rate('<office-uuid>', 'USD', 'TRY');
