-- ============================================================================
-- CoinPlata · 0052_p2p_interoffice_transfers.sql
--
-- P2P-механика для interoffice transfers:
--   * Sender создаёт transfer → OUT movement резервируется (reserved=true).
--   * IN movement НЕ создаётся сразу. Баланс получателя не меняется.
--   * Receiver видит pending incoming, подтверждает или отклоняет.
--   * Confirm: OUT.reserved=false + IN created → status='confirmed'.
--   * Reject:  OUT удаляется → status='rejected'.
--   * Cancel by sender (до confirm): OUT удаляется → status='cancelled'.
--
-- Статусы:
--   pending   — создан, ждёт receiver
--   confirmed — receiver принял (final)
--   rejected  — receiver отказал (final)
--   cancelled — sender отменил до подтверждения (final)
--
-- Edge cases:
--   * Receiver disabled/удалён — admin может reassign через update_transfer_recipient
--     или выполнить confirm/reject от имени receiver через own admin role.
--   * Pending > 24h — UI помечает оранжевым (frontend logic).
-- ============================================================================

-- 1. Schema changes
alter table public.transfers
  add column if not exists status text not null default 'confirmed',
  add column if not exists to_manager_id uuid references public.users(id),
  add column if not exists confirmed_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists confirmation_note text;

-- Backfill: existing transfers всегда были immediate-execution → 'confirmed'.
-- created_at используем как confirmed_at (исторически они выполнялись сразу).
update public.transfers
  set status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, created_at)
  where status not in ('pending','confirmed','rejected','cancelled');

-- Constraint
alter table public.transfers
  drop constraint if exists transfers_status_check;
alter table public.transfers
  add constraint transfers_status_check
    check (status in ('pending','confirmed','rejected','cancelled'));

create index if not exists transfers_pending_idx
  on public.transfers(to_manager_id, status)
  where status = 'pending';

-- 2. create_transfer V2: создаёт OUT reserved + transfer.pending.
--    IN не создаётся (баланс получателя не меняется до confirm).
--    Сигнатура расширена: добавлен p_to_manager_id (опционально).

drop function if exists public.create_transfer(uuid, uuid, numeric, numeric, numeric, text);
drop function if exists public.create_transfer(uuid, uuid, numeric, numeric, numeric, text, uuid);

create function public.create_transfer(
  p_from_account_id uuid,
  p_to_account_id   uuid,
  p_from_amount     numeric,
  p_to_amount       numeric,
  p_rate            numeric,
  p_note            text,
  p_to_manager_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['accountant','admin','owner']);
  v_transfer_id uuid := gen_random_uuid();
  v_mov_group uuid := gen_random_uuid();
  v_from record;
  v_to record;
  v_user_id uuid := auth.uid();
  v_is_interoffice boolean;
begin
  if p_from_amount is null or p_from_amount <= 0 then
    raise exception 'from_amount must be > 0';
  end if;
  if p_to_amount is null or p_to_amount <= 0 then
    raise exception 'to_amount must be > 0';
  end if;

  select * into v_from from public.accounts where id = p_from_account_id;
  select * into v_to   from public.accounts where id = p_to_account_id;
  if v_from is null or v_to is null then raise exception 'Account not found'; end if;
  if v_from.id = v_to.id then raise exception 'Same account transfer'; end if;

  -- Interoffice = разные офисы. Только для них применяется P2P-flow.
  -- Same-office transfer выполняется immediately (status=confirmed).
  v_is_interoffice := v_from.office_id is distinct from v_to.office_id;

  insert into public.transfers (
    id, from_account_id, to_account_id, from_amount, to_amount,
    from_currency, to_currency, rate, note, created_by,
    status, to_manager_id, confirmed_at
  ) values (
    v_transfer_id, p_from_account_id, p_to_account_id, p_from_amount, p_to_amount,
    v_from.currency_code, v_to.currency_code, p_rate, p_note, v_user_id,
    case when v_is_interoffice then 'pending' else 'confirmed' end,
    p_to_manager_id,
    case when v_is_interoffice then null else now() end
  );

  -- OUT movement всегда создаётся. Для interoffice — reserved=true (заблокировано
  -- до confirm). Для same-office — reserved=false (immediate).
  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, movement_group_id, note, created_by
  ) values (
    p_from_account_id, p_from_amount, 'out', v_from.currency_code,
    v_is_interoffice,
    'transfer_out', v_transfer_id::text, v_mov_group, p_note, v_user_id
  );

  -- IN movement создаётся только для same-office (immediate).
  -- Для interoffice IN создастся позже в confirm_transfer.
  if not v_is_interoffice then
    insert into public.account_movements (
      account_id, amount, direction, currency_code, reserved,
      source_kind, source_ref_id, movement_group_id, note, created_by
    ) values (
      p_to_account_id, p_to_amount, 'in', v_to.currency_code, false,
      'transfer_in', v_transfer_id::text, v_mov_group, p_note, v_user_id
    );
  end if;

  return v_transfer_id;
end;
$func$;

grant execute on function public.create_transfer(
  uuid, uuid, numeric, numeric, numeric, text, uuid
) to authenticated;

-- 3. confirm_transfer: receiver подтверждает.
--    Permission: receiving manager (to_manager_id), либо admin/owner,
--    либо любой manager receiving office если to_manager_id не назначен.

create or replace function public.confirm_transfer(
  p_transfer_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_t record;
  v_to_acc record;
  v_mov_group uuid := gen_random_uuid();
begin
  -- LOCK row чтобы защитить от concurrent confirm/reject
  select * into v_t from public.transfers
    where id = p_transfer_id for update;
  if v_t is null then raise exception 'Transfer % not found', p_transfer_id; end if;
  if v_t.status <> 'pending' then
    raise exception 'Transfer is not pending (status=%)', v_t.status;
  end if;

  -- Permission check
  select * into v_to_acc from public.accounts where id = v_t.to_account_id;
  if v_caller_role = 'manager' then
    if v_t.to_manager_id is not null then
      if v_t.to_manager_id <> v_uid then
        raise exception 'Only assigned receiving manager can confirm'
          using errcode = '42501';
      end if;
    else
      -- to_manager_id не назначен — любой manager receiving office
      if not exists (
        select 1 from public.users
          where id = v_uid and office_id = v_to_acc.office_id
      ) then
        raise exception 'Only managers of the receiving office can confirm'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- Снимаем reserved с OUT движения
  update public.account_movements
    set reserved = false
    where source_ref_id = v_t.id::text
      and source_kind = 'transfer_out';

  -- Создаём IN движение
  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, source_ref_id, movement_group_id, note, created_by
  ) values (
    v_t.to_account_id, v_t.to_amount, 'in', v_t.to_currency, false,
    'transfer_in', v_t.id::text, v_mov_group, v_t.note, v_uid
  );

  -- Обновляем transfer
  update public.transfers
    set status = 'confirmed',
        confirmed_at = now(),
        to_manager_id = coalesce(to_manager_id, v_uid),
        confirmation_note = p_note
    where id = p_transfer_id;
end;
$func$;

grant execute on function public.confirm_transfer(uuid, text) to authenticated;

-- 4. reject_transfer: receiver отказывает. OUT удаляется, sender получает деньги
--    обратно. Status=rejected (final).

create or replace function public.reject_transfer(
  p_transfer_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_t record;
  v_to_acc record;
begin
  select * into v_t from public.transfers
    where id = p_transfer_id for update;
  if v_t is null then raise exception 'Transfer % not found', p_transfer_id; end if;
  if v_t.status <> 'pending' then
    raise exception 'Transfer is not pending (status=%)', v_t.status;
  end if;

  -- Permission check (та же логика что в confirm)
  select * into v_to_acc from public.accounts where id = v_t.to_account_id;
  if v_caller_role = 'manager' then
    if v_t.to_manager_id is not null and v_t.to_manager_id <> v_uid then
      raise exception 'Only assigned receiving manager can reject'
        using errcode = '42501';
    end if;
    if v_t.to_manager_id is null then
      if not exists (
        select 1 from public.users
          where id = v_uid and office_id = v_to_acc.office_id
      ) then
        raise exception 'Only managers of the receiving office can reject'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- Удаляем OUT (sender получает обратно средства)
  delete from public.account_movements
    where source_ref_id = v_t.id::text
      and source_kind = 'transfer_out';

  update public.transfers
    set status = 'rejected',
        rejected_at = now(),
        confirmation_note = p_reason
    where id = p_transfer_id;
end;
$func$;

grant execute on function public.reject_transfer(uuid, text) to authenticated;

-- 5. cancel_transfer: sender отменяет до подтверждения.

create or replace function public.cancel_transfer(
  p_transfer_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller_role text := public._require_role(array['manager','accountant','admin','owner']);
  v_uid uuid := auth.uid();
  v_t record;
begin
  select * into v_t from public.transfers
    where id = p_transfer_id for update;
  if v_t is null then raise exception 'Transfer % not found', p_transfer_id; end if;
  if v_t.status <> 'pending' then
    raise exception 'Transfer is not pending (status=%)', v_t.status;
  end if;

  -- Только sender или admin может отменить
  if v_caller_role = 'manager' and v_t.created_by <> v_uid then
    raise exception 'Only sender can cancel transfer' using errcode = '42501';
  end if;

  delete from public.account_movements
    where source_ref_id = v_t.id::text
      and source_kind = 'transfer_out';

  update public.transfers
    set status = 'cancelled',
        cancelled_at = now(),
        confirmation_note = p_reason
    where id = p_transfer_id;
end;
$func$;

grant execute on function public.cancel_transfer(uuid, text) to authenticated;

-- Проверка
select 'Schema:' as info;
select column_name, data_type from information_schema.columns
  where table_schema = 'public' and table_name = 'transfers'
  order by ordinal_position;

select 'Functions:' as info;
select proname, pg_get_function_identity_arguments(oid) as signature
  from pg_proc
  where proname in ('create_transfer','confirm_transfer','reject_transfer','cancel_transfer')
  order by proname;
