-- ============================================================================
-- CoinPlata · 0099_participants_v2_rpcs.sql
-- ============================================================================
-- ФАЗА 2: RPC-обёртки для записи в новые таблицы participants/*.
--
-- Никаких триггеров, никакого backfill, никакого dual-write.
-- Старые таблицы не трогаются. Эти функции существуют сами по себе и
-- пока никем не вызываются (фронт о них не знает).
--
-- В фазе 3 фронт начнёт ими пользоваться параллельно со старыми путями.
-- В фазе 4 backfill наполнит таблицы данными через эти же функции (или
-- напрямую — будет миграция).
--
-- Полный список:
--   • upsert_participant            — create-or-find (идемпотент)
--   • ensure_participant_account    — create-or-find счёт
--   • record_participant_movement   — универсальная запись движения
--   • record_participant_inflow     — sugar: участник внёс / должен меньше
--   • record_participant_outflow    — sugar: участник забрал / должен больше
--   • record_participant_pair       — парное движение (deal/transfer): два
--                                     движения с общим movement_group_id
--   • delete_participant_movement   — откат одного движения
--   • delete_participant_group      — откат всей группы (пара/multi)
--   • take_balance_snapshot         — сохранить текущие балансы старой
--                                     системы в balance_snapshots
-- ============================================================================

-- ─── 1. upsert_participant ─────────────────────────────────────────────────
-- Идемпотентный поиск или создание participant. Логика поиска:
--   1) если задан legacy_client_id или legacy_partner_id — ищем по нему;
--   2) иначе ищем по точному match display_name (case-insensitive)
--      ВНУТРИ той же роли — иначе клиент с именем "Иван" и партнёр
--      "Иван" остаются разными;
--   3) если не нашли — создаём.
-- Если нашли существующего и роль ещё не присутствует в roles[] — добавляем.
create or replace function public.upsert_participant(
  p_display_name        text,
  p_role                text,                 -- 'self'|'client'|'partner'|'counterparty'
  p_full_name           text default null,
  p_telegram            text default null,
  p_phone               text default null,
  p_legacy_client_id    uuid default null,
  p_legacy_partner_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','admin','owner']);
  v_uid uuid := auth.uid();
  v_id uuid;
  v_dn text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  if p_role not in ('self','client','partner','counterparty') then
    raise exception 'unknown role: %', p_role using errcode = '22000';
  end if;

  -- 1) поиск по legacy ref
  if p_legacy_client_id is not null then
    select id into v_id from public.participants
      where legacy_client_id = p_legacy_client_id limit 1;
  end if;
  if v_id is null and p_legacy_partner_id is not null then
    select id into v_id from public.participants
      where legacy_partner_id = p_legacy_partner_id limit 1;
  end if;

  -- 2) для роли self — singleton (всегда один)
  if v_id is null and p_role = 'self' then
    select id into v_id from public.participants
      where 'self' = any(roles) limit 1;
  end if;

  -- 3) поиск по display_name внутри роли
  if v_id is null and v_dn is not null then
    select id into v_id from public.participants
      where lower(display_name) = lower(v_dn) and p_role = any(roles) limit 1;
  end if;

  -- Создание если не нашли
  if v_id is null then
    if v_dn is null then
      raise exception 'display_name required when creating participant'
        using errcode = '22000';
    end if;
    insert into public.participants (
      display_name, full_name, telegram, phone,
      roles, legacy_client_id, legacy_partner_id, created_by
    ) values (
      v_dn, nullif(trim(coalesce(p_full_name,'')), ''),
      nullif(trim(coalesce(p_telegram,'')), ''),
      nullif(trim(coalesce(p_phone,'')), ''),
      array[p_role]::text[],
      p_legacy_client_id, p_legacy_partner_id, v_uid
    ) returning id into v_id;
  else
    -- Добавляем роль если ещё нет
    update public.participants
       set roles = array_append(roles, p_role)
     where id = v_id and not (p_role = any(roles));
    -- Обновляем поля если переданы и пустые в БД (мягкое обогащение).
    update public.participants p
       set full_name = coalesce(p.full_name, nullif(trim(p_full_name),'')),
           telegram  = coalesce(p.telegram,  nullif(trim(p_telegram),'')),
           phone     = coalesce(p.phone,     nullif(trim(p_phone),''))
     where p.id = v_id;
  end if;

  return v_id;
end;
$func$;

grant execute on function public.upsert_participant(text,text,text,text,text,uuid,uuid)
  to authenticated;

-- ─── 2. ensure_participant_account ─────────────────────────────────────────
-- Идемпотентный create-or-find счёта. Поиск по
-- (participant_id, currency, channel, network_id, lower(address)) среди
-- active=true. Если не нашли — создаём.
create or replace function public.ensure_participant_account(
  p_participant_id uuid,
  p_currency       text,
  p_channel        text default null,
  p_network_id     text default null,
  p_address        text default null,
  p_office_id      uuid default null,
  p_name           text default null,
  p_notes          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','admin','owner']);
  v_uid uuid := auth.uid();
  v_id uuid;
  v_addr text := nullif(trim(coalesce(p_address,'')), '');
begin
  if p_participant_id is null then
    raise exception 'participant_id required' using errcode = '22000';
  end if;
  if p_currency is null or length(trim(p_currency)) = 0 then
    raise exception 'currency required' using errcode = '22000';
  end if;

  select id into v_id
    from public.participant_accounts
   where participant_id = p_participant_id
     and currency_code  = upper(trim(p_currency))
     and coalesce(channel,'')        = coalesce(p_channel,'')
     and coalesce(network_id,'')     = coalesce(p_network_id,'')
     and coalesce(lower(trim(address)),'') = coalesce(lower(v_addr),'')
     and active = true
   limit 1;

  if v_id is null then
    insert into public.participant_accounts (
      participant_id, name, currency_code, channel, network_id,
      address, office_id, notes, created_by
    ) values (
      p_participant_id,
      nullif(trim(coalesce(p_name,'')),''),
      upper(trim(p_currency)),
      nullif(trim(coalesce(p_channel,'')),''),
      nullif(trim(coalesce(p_network_id,'')),''),
      v_addr, p_office_id,
      nullif(trim(coalesce(p_notes,'')),''),
      v_uid
    ) returning id into v_id;
  end if;

  return v_id;
end;
$func$;

grant execute on function public.ensure_participant_account(uuid,text,text,text,text,uuid,text,text)
  to authenticated;

-- ─── 3. record_participant_movement ────────────────────────────────────────
-- Универсальная запись одного движения. Минимальный путь — нужны:
-- account_id, amount > 0, direction, movement_type. Остальное опционально.
create or replace function public.record_participant_movement(
  p_account_id        uuid,
  p_amount            numeric,
  p_direction         text,           -- 'in'|'out'
  p_movement_type     text,           -- см. CHECK в 0098
  p_source_kind       text default 'rpc',
  p_deal_id           bigint default null,
  p_movement_group_id uuid default null,
  p_source_ref_type   text default null,
  p_source_ref_id     text default null,
  p_note              text default null,
  p_reserved          boolean default false,
  p_currency          text default null   -- если null, берём из account
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','admin','owner']);
  v_uid uuid := auth.uid();
  v_acc record;
  v_cur text;
  v_id uuid;
begin
  if p_account_id is null then
    raise exception 'account_id required' using errcode = '22000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be > 0' using errcode = '22000';
  end if;
  if p_direction not in ('in','out') then
    raise exception 'direction must be in/out' using errcode = '22000';
  end if;

  select id, currency_code, active into v_acc
    from public.participant_accounts where id = p_account_id;
  if not found then
    raise exception 'participant_account % not found', p_account_id;
  end if;
  if not v_acc.active then
    raise exception 'participant_account % is inactive', p_account_id;
  end if;

  v_cur := coalesce(upper(trim(p_currency)), v_acc.currency_code);
  if v_cur <> v_acc.currency_code then
    raise exception 'currency mismatch: account is %, got %',
      v_acc.currency_code, v_cur using errcode = '22000';
  end if;

  insert into public.participant_movements (
    participant_account_id, amount, direction, currency_code,
    movement_type, source_kind, deal_id, movement_group_id,
    source_ref_type, source_ref_id, note, reserved, created_by
  ) values (
    p_account_id, p_amount, p_direction, v_cur,
    p_movement_type, coalesce(p_source_kind,'rpc'),
    p_deal_id, p_movement_group_id,
    p_source_ref_type, p_source_ref_id,
    nullif(trim(coalesce(p_note,'')),''),
    coalesce(p_reserved,false), v_uid
  ) returning id into v_id;

  return v_id;
end;
$func$;

grant execute on function public.record_participant_movement(uuid,numeric,text,text,text,bigint,uuid,text,text,text,boolean,text)
  to authenticated;

-- ─── 4. record_participant_inflow (sugar) ──────────────────────────────────
-- Sugar для случая «participant внёс» = direction=in, type=settlement_in.
create or replace function public.record_participant_inflow(
  p_account_id uuid,
  p_amount     numeric,
  p_note       text default null,
  p_deal_id    bigint default null,
  p_group_id   uuid default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.record_participant_movement(
    p_account_id, p_amount, 'in', 'settlement_in', 'rpc',
    p_deal_id, p_group_id, null, null, p_note, false, null
  );
$$;

grant execute on function public.record_participant_inflow(uuid,numeric,text,bigint,uuid)
  to authenticated;

-- ─── 5. record_participant_outflow (sugar) ─────────────────────────────────
create or replace function public.record_participant_outflow(
  p_account_id uuid,
  p_amount     numeric,
  p_note       text default null,
  p_deal_id    bigint default null,
  p_group_id   uuid default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.record_participant_movement(
    p_account_id, p_amount, 'out', 'settlement_out', 'rpc',
    p_deal_id, p_group_id, null, null, p_note, false, null
  );
$$;

grant execute on function public.record_participant_outflow(uuid,numeric,text,bigint,uuid)
  to authenticated;

-- ─── 6. record_participant_pair ────────────────────────────────────────────
-- Парное движение: from-account OUT + to-account IN. Используется для
-- transfer'ов и двусторонних settlement'ов. Один movement_group_id.
-- Если currencies разные — обе amount пишутся в своих валютах (как сейчас
-- в transfers); вызывающий сам отвечает за курс.
create or replace function public.record_participant_pair(
  p_from_account_id uuid,
  p_from_amount     numeric,
  p_to_account_id   uuid,
  p_to_amount       numeric,
  p_movement_type_from text default 'transfer_out',
  p_movement_type_to   text default 'transfer_in',
  p_deal_id         bigint default null,
  p_note            text default null
)
returns uuid          -- movement_group_id
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','admin','owner']);
  v_group uuid := gen_random_uuid();
begin
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'both from_account_id and to_account_id required'
      using errcode = '22000';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'from and to must differ' using errcode = '22000';
  end if;

  perform public.record_participant_movement(
    p_from_account_id, p_from_amount, 'out', p_movement_type_from, 'rpc',
    p_deal_id, v_group, null, null, p_note, false, null
  );
  perform public.record_participant_movement(
    p_to_account_id, p_to_amount, 'in', p_movement_type_to, 'rpc',
    p_deal_id, v_group, null, null, p_note, false, null
  );
  return v_group;
end;
$func$;

grant execute on function public.record_participant_pair(uuid,numeric,uuid,numeric,text,text,bigint,text)
  to authenticated;

-- ─── 7. delete_participant_movement ────────────────────────────────────────
create or replace function public.delete_participant_movement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
begin
  if p_id is null then
    raise exception 'movement_id required' using errcode = '22000';
  end if;
  delete from public.participant_movements where id = p_id;
end;
$func$;

grant execute on function public.delete_participant_movement(uuid) to authenticated;

-- ─── 8. delete_participant_group ───────────────────────────────────────────
create or replace function public.delete_participant_group(p_group_id uuid)
returns integer        -- count deleted rows
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
  v_n integer;
begin
  if p_group_id is null then
    raise exception 'group_id required' using errcode = '22000';
  end if;
  delete from public.participant_movements where movement_group_id = p_group_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$func$;

grant execute on function public.delete_participant_group(uuid) to authenticated;

-- ─── 9. take_balance_snapshot ──────────────────────────────────────────────
-- Snapshot текущих балансов СТАРОЙ системы (v_account_balances для наших
-- касс + sum(partner_account_movements) для партнёрских счетов). Нужен для
-- сверки до/после backfill (фаза 3+).
--
-- Структура data: {
--   "accounts":         [{"account_id": uuid, "currency": text, "balance": num, "reserved": num}],
--   "partner_accounts": [{"partner_account_id": uuid, "currency": text, "balance": num}]
-- }
create or replace function public.take_balance_snapshot(
  p_scope text default 'manual',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['admin','owner']);
  v_uid uuid := auth.uid();
  v_data jsonb;
  v_accounts jsonb;
  v_partner jsonb;
  v_id uuid;
begin
  if p_scope not in ('pre_backfill','post_backfill','periodic','manual','dual_check') then
    raise exception 'unknown scope: %', p_scope using errcode = '22000';
  end if;

  -- accounts: используем v_account_balances если есть; иначе пусто.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', b.account_id,
      'currency',   b.currency_code,
      'balance',    b.total,
      'reserved',   b.reserved
    )), '[]'::jsonb)
    into v_accounts
    from public.v_account_balances b;
  exception when undefined_table then
    v_accounts := '[]'::jsonb;
  end;

  -- partner_accounts: aggregate из partner_account_movements.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'partner_account_id', pa.id,
      'currency',           pa.currency_code,
      'balance',            t.bal
    )), '[]'::jsonb)
    into v_partner
    from public.partner_accounts pa
    join (
      select partner_account_id,
             coalesce(sum(case when direction='in' then amount end),0)
             - coalesce(sum(case when direction='out' then amount end),0) as bal
        from public.partner_account_movements
        group by partner_account_id
    ) t on t.partner_account_id = pa.id;
  exception when undefined_table then
    v_partner := '[]'::jsonb;
  end;

  v_data := jsonb_build_object(
    'accounts',         v_accounts,
    'partner_accounts', v_partner
  );

  insert into public.balance_snapshots (taken_by, scope, notes, data)
  values (v_uid, p_scope, nullif(trim(coalesce(p_notes,'')),''), v_data)
  returning id into v_id;

  return v_id;
end;
$func$;

grant execute on function public.take_balance_snapshot(text,text) to authenticated;

-- ─── Verify ────────────────────────────────────────────────────────────────
select proname, pg_get_function_identity_arguments(oid) as args
  from pg_proc
  where proname in (
    'upsert_participant','ensure_participant_account',
    'record_participant_movement','record_participant_inflow',
    'record_participant_outflow','record_participant_pair',
    'delete_participant_movement','delete_participant_group',
    'take_balance_snapshot'
  )
    and pronamespace = 'public'::regnamespace
  order by proname;
