-- ============================================================================
-- CoinPlata · 0102_participants_v5_dual_write_triggers.sql
-- ============================================================================
-- ФАЗА 5: триггеры на старых таблицах для зеркалирования в participants/*.
--
-- ПОДХОД: AFTER INSERT/UPDATE/DELETE триггеры. Soft-fail (exception when
-- others → raise warning) — если что-то пойдёт не так в новой стороне,
-- старая операция не сломается. Расхождения видны в v_dual_balance_check.
--
-- ПОКРЫТИЕ:
--   1. clients ↔ participants (role='client')
--   2. partners ↔ participants (role='partner')
--   3. partner_accounts ↔ participant_accounts
--   4. accounts ↔ participant_accounts (для self-participant)
--   5. partner_account_movements ↔ participant_movements
--   6. account_movements ↔ participant_movements
--
-- ОТКАТ: drop всех 6 trigger'ов и 6 функций — старая система работает
-- сама по себе.
-- ============================================================================

-- ─── 1. helper: self_participant_id ──────────────────────────────────────
create or replace function public._self_participant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.participants where 'self' = any(roles) limit 1
$$;

-- ─── 2. clients → participants ───────────────────────────────────────────
create or replace function public.sync_client_to_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_has_otc boolean := false;
begin
  -- читаем is_otc_partner если поле есть
  begin
    v_has_otc := coalesce((case when tg_op='DELETE' then OLD.is_otc_partner
                                                    else NEW.is_otc_partner end), false);
  exception when undefined_column then v_has_otc := false; end;

  if tg_op = 'INSERT' then
    insert into public.participants (
      display_name, full_name, telegram,
      roles, legacy_client_id, created_at, created_by
    )
    values (
      coalesce(nullif(trim(NEW.nickname),''), nullif(trim(NEW.full_name),''),
               'client #' || left(NEW.id::text, 8)),
      NEW.full_name,
      NEW.telegram,
      case when v_has_otc then array['client','partner']::text[]
           else array['client']::text[] end,
      NEW.id,
      NEW.created_at,
      NEW.created_by
    )
    on conflict do nothing;

  elsif tg_op = 'UPDATE' then
    update public.participants
       set display_name = coalesce(nullif(trim(NEW.nickname),''),
                                   nullif(trim(NEW.full_name),''),
                                   display_name),
           full_name    = NEW.full_name,
           telegram     = NEW.telegram,
           roles        = case
             when v_has_otc and not ('partner' = any(roles))
               then array_append(roles, 'partner')
             when not v_has_otc and 'partner' = any(roles)
                  and not ('partner' = any(
                    coalesce((select roles from public.participants p2
                              where p2.legacy_partner_id is not null
                                and p2.legacy_partner_id::text = ''),
                             roles)))
               then array_remove(roles, 'partner')
             else roles
           end
     where legacy_client_id = NEW.id;

  elsif tg_op = 'DELETE' then
    update public.participants
       set active = false
     where legacy_client_id = OLD.id;
  end if;

  return case when tg_op = 'DELETE' then OLD else NEW end;
exception when others then
  raise warning '[sync_client_to_participant] %  : %', tg_op, sqlerrm;
  return case when tg_op = 'DELETE' then OLD else NEW end;
end;
$func$;

drop trigger if exists trg_sync_client_to_participant on public.clients;
create trigger trg_sync_client_to_participant
  after insert or update or delete on public.clients
  for each row execute function public.sync_client_to_participant();

-- ─── 3. partners → participants ──────────────────────────────────────────
create or replace function public.sync_partner_to_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if tg_op = 'INSERT' then
    insert into public.participants (
      display_name, telegram, phone, notes,
      roles, active, legacy_partner_id, created_at, created_by
    )
    values (
      NEW.name, NEW.telegram, NEW.phone, NEW.note,
      array['partner']::text[],
      NEW.active, NEW.id, NEW.created_at, NEW.created_by
    )
    on conflict do nothing;

  elsif tg_op = 'UPDATE' then
    update public.participants
       set display_name = NEW.name,
           telegram     = NEW.telegram,
           phone        = NEW.phone,
           notes        = NEW.note,
           active       = NEW.active
     where legacy_partner_id = NEW.id;

  elsif tg_op = 'DELETE' then
    update public.participants
       set active = false
     where legacy_partner_id = OLD.id;
  end if;

  return case when tg_op = 'DELETE' then OLD else NEW end;
exception when others then
  raise warning '[sync_partner_to_participant] %  : %', tg_op, sqlerrm;
  return case when tg_op = 'DELETE' then OLD else NEW end;
end;
$func$;

drop trigger if exists trg_sync_partner_to_participant on public.partners;
create trigger trg_sync_partner_to_participant
  after insert or update or delete on public.partners
  for each row execute function public.sync_partner_to_participant();

-- ─── 4. partner_accounts → participant_accounts ─────────────────────────
create or replace function public.sync_partner_account_to_pa()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pid uuid;
begin
  if tg_op = 'INSERT' then
    select id into v_pid from public.participants
     where legacy_partner_id = NEW.partner_id limit 1;
    if v_pid is null then
      raise warning '[sync_partner_account] no participant for partner_id=%', NEW.partner_id;
      return NEW;
    end if;
    insert into public.participant_accounts (
      participant_id, name, currency_code, channel, network_id,
      address, notes, active, created_at, created_by, legacy_partner_account_id
    )
    values (
      v_pid, NEW.name, NEW.currency_code, NEW.type,
      NEW.network_id, NEW.address, NEW.note, NEW.active,
      NEW.created_at, NEW.created_by, NEW.id
    )
    on conflict do nothing;

  elsif tg_op = 'UPDATE' then
    update public.participant_accounts
       set name           = NEW.name,
           currency_code  = NEW.currency_code,
           channel        = NEW.type,
           network_id     = NEW.network_id,
           address        = NEW.address,
           notes          = NEW.note,
           active         = NEW.active
     where legacy_partner_account_id = NEW.id;

  elsif tg_op = 'DELETE' then
    update public.participant_accounts set active = false
     where legacy_partner_account_id = OLD.id;
  end if;

  return case when tg_op = 'DELETE' then OLD else NEW end;
exception when others then
  raise warning '[sync_partner_account_to_pa] %  : %', tg_op, sqlerrm;
  return case when tg_op = 'DELETE' then OLD else NEW end;
end;
$func$;

drop trigger if exists trg_sync_partner_account_to_pa on public.partner_accounts;
create trigger trg_sync_partner_account_to_pa
  after insert or update or delete on public.partner_accounts
  for each row execute function public.sync_partner_account_to_pa();

-- ─── 5. accounts → participant_accounts (self) ──────────────────────────
create or replace function public.sync_account_to_pa()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_self uuid;
begin
  v_self := public._self_participant_id();
  if v_self is null then
    raise warning '[sync_account_to_pa] no self-participant';
    return case when tg_op = 'DELETE' then OLD else NEW end;
  end if;

  if tg_op = 'INSERT' then
    insert into public.participant_accounts (
      participant_id, name, currency_code, channel, network_id,
      address, office_id, active, created_at, legacy_account_id
    )
    values (
      v_self, NEW.name, NEW.currency_code, NEW.type,
      NEW.network_id, NEW.address, NEW.office_id, NEW.active,
      NEW.created_at, NEW.id
    )
    on conflict do nothing;

  elsif tg_op = 'UPDATE' then
    update public.participant_accounts
       set name           = NEW.name,
           currency_code  = NEW.currency_code,
           channel        = NEW.type,
           network_id     = NEW.network_id,
           address        = NEW.address,
           office_id      = NEW.office_id,
           active         = NEW.active
     where legacy_account_id = NEW.id;

  elsif tg_op = 'DELETE' then
    update public.participant_accounts set active = false
     where legacy_account_id = OLD.id;
  end if;

  return case when tg_op = 'DELETE' then OLD else NEW end;
exception when others then
  raise warning '[sync_account_to_pa] %  : %', tg_op, sqlerrm;
  return case when tg_op = 'DELETE' then OLD else NEW end;
end;
$func$;

drop trigger if exists trg_sync_account_to_pa on public.accounts;
create trigger trg_sync_account_to_pa
  after insert or update or delete on public.accounts
  for each row execute function public.sync_account_to_pa();

-- ─── 6. partner_account_movements → participant_movements ───────────────
create or replace function public.sync_partner_movement_to_pm()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pa uuid;
  v_type text;
  v_deal_id bigint;
begin
  if tg_op = 'DELETE' then
    delete from public.participant_movements
     where legacy_partner_movement_id = OLD.id;
    return OLD;
  end if;

  -- INSERT/UPDATE — нужен participant_account_id
  select id into v_pa from public.participant_accounts
   where legacy_partner_account_id = NEW.partner_account_id limit 1;
  if v_pa is null then
    raise warning '[sync_partner_movement] no participant_account for legacy=%',
      NEW.partner_account_id;
    return NEW;
  end if;

  v_type := case
    when NEW.source_kind = 'opening'                          then 'opening'
    when NEW.source_kind = 'adjustment'                       then 'adjustment'
    when NEW.source_kind = 'otc_in'                           then 'deal_in'
    when NEW.source_kind = 'otc_out'                          then 'deal_out'
    when NEW.source_kind = 'settle' and NEW.direction = 'in'  then 'settlement_in'
    when NEW.source_kind = 'settle' and NEW.direction = 'out' then 'settlement_out'
    else 'adjustment'
  end;

  v_deal_id := null;
  if NEW.source_kind in ('otc_in','otc_out') and NEW.source_ref_id ~ '^\d+$' then
    begin
      v_deal_id := NEW.source_ref_id::bigint;
      if not exists (select 1 from public.deals where id = v_deal_id) then
        v_deal_id := null;
      end if;
    exception when others then v_deal_id := null; end;
  end if;

  if tg_op = 'INSERT' then
    insert into public.participant_movements (
      participant_account_id, amount, direction, currency_code,
      movement_type, source_kind, deal_id, movement_group_id,
      source_ref_type, source_ref_id, note, reserved,
      created_by, created_at, legacy_partner_movement_id
    )
    values (
      v_pa, NEW.amount, NEW.direction, NEW.currency_code,
      v_type, 'trigger', v_deal_id, NEW.movement_group_id,
      case when NEW.source_kind in ('otc_in','otc_out') then 'deal'
           when NEW.source_kind = 'settle' then 'settlement' else null end,
      NEW.source_ref_id, NEW.note, false,
      NEW.created_by, NEW.created_at, NEW.id
    )
    on conflict do nothing;

  elsif tg_op = 'UPDATE' then
    update public.participant_movements
       set amount = NEW.amount,
           direction = NEW.direction,
           currency_code = NEW.currency_code,
           movement_type = v_type,
           deal_id = v_deal_id,
           movement_group_id = NEW.movement_group_id,
           note = NEW.note
     where legacy_partner_movement_id = NEW.id;
  end if;

  return NEW;
exception when others then
  raise warning '[sync_partner_movement_to_pm] %  : %', tg_op, sqlerrm;
  return case when tg_op = 'DELETE' then OLD else NEW end;
end;
$func$;

drop trigger if exists trg_sync_partner_movement_to_pm on public.partner_account_movements;
create trigger trg_sync_partner_movement_to_pm
  after insert or update or delete on public.partner_account_movements
  for each row execute function public.sync_partner_movement_to_pm();

-- ─── 7. account_movements → participant_movements ──────────────────────
create or replace function public.sync_account_movement_to_pm()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pa uuid;
  v_type text;
  v_deal_id bigint;
begin
  if tg_op = 'DELETE' then
    delete from public.participant_movements
     where legacy_account_movement_id = OLD.id;
    return OLD;
  end if;

  select id into v_pa from public.participant_accounts
   where legacy_account_id = NEW.account_id limit 1;
  if v_pa is null then
    raise warning '[sync_account_movement] no participant_account for legacy=%',
      NEW.account_id;
    return NEW;
  end if;

  v_type := case
    when NEW.source_kind = 'opening'                            then 'opening'
    when NEW.source_kind = 'topup'                              then 'settlement_in'
    when NEW.source_kind = 'transfer_in'                        then 'transfer_in'
    when NEW.source_kind = 'transfer_out'                       then 'transfer_out'
    when NEW.source_kind = 'exchange_in'                        then 'deal_in'
    when NEW.source_kind = 'exchange_out'                       then 'deal_out'
    when NEW.source_kind in ('income','expense','adjustment')   then 'adjustment'
    when NEW.source_kind = 'settle' and NEW.direction = 'in'    then 'settlement_in'
    when NEW.source_kind = 'settle' and NEW.direction = 'out'   then 'settlement_out'
    else 'adjustment'
  end;

  v_deal_id := null;
  if NEW.source_kind in ('exchange_in','exchange_out') and NEW.source_ref_id ~ '^\d+$' then
    begin
      v_deal_id := NEW.source_ref_id::bigint;
      if not exists (select 1 from public.deals where id = v_deal_id) then
        v_deal_id := null;
      end if;
    exception when others then v_deal_id := null; end;
  end if;

  if tg_op = 'INSERT' then
    insert into public.participant_movements (
      participant_account_id, amount, direction, currency_code,
      movement_type, source_kind, deal_id, movement_group_id,
      source_ref_type, source_ref_id, note, reserved,
      created_by, created_at, legacy_account_movement_id
    )
    values (
      v_pa, NEW.amount, NEW.direction, NEW.currency_code,
      v_type, 'trigger', v_deal_id, NEW.movement_group_id,
      case when NEW.source_kind in ('exchange_in','exchange_out') then 'deal'
           when NEW.source_kind = 'settle' then 'settlement'
           when NEW.source_kind in ('income','expense') then 'expense_entry'
           when NEW.source_kind in ('transfer_in','transfer_out') then 'transfer'
           else null end,
      NEW.source_ref_id, NEW.note, coalesce(NEW.reserved, false),
      NEW.created_by, NEW.created_at, NEW.id
    )
    on conflict do nothing;

  elsif tg_op = 'UPDATE' then
    update public.participant_movements
       set amount = NEW.amount,
           direction = NEW.direction,
           currency_code = NEW.currency_code,
           movement_type = v_type,
           deal_id = v_deal_id,
           movement_group_id = NEW.movement_group_id,
           note = NEW.note,
           reserved = coalesce(NEW.reserved, false)
     where legacy_account_movement_id = NEW.id;
  end if;

  return NEW;
exception when others then
  raise warning '[sync_account_movement_to_pm] %  : %', tg_op, sqlerrm;
  return case when tg_op = 'DELETE' then OLD else NEW end;
end;
$func$;

drop trigger if exists trg_sync_account_movement_to_pm on public.account_movements;
create trigger trg_sync_account_movement_to_pm
  after insert or update or delete on public.account_movements
  for each row execute function public.sync_account_movement_to_pm();

-- ─── Verify ─────────────────────────────────────────────────────────────
select tgname, tgrelid::regclass as on_table, tgenabled
  from pg_trigger
  where tgname like 'trg_sync_%'
  order by tgname;
