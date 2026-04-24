-- ============================================================================
-- CoinPlata · 0029_topup_source_kind.sql
--
-- Расширяем topup_account RPC: новый параметр p_source_kind (default 'topup').
-- Нужно чтобы кнопка "Opening" в TopUpModal писала movement с source_kind=
-- 'opening' (а не 'topup' + note-prefix, как было). Тогда AccountHistoryModal
-- покажет badge "Остаток" (i18n mv_source_opening = "Остаток") вместо
-- "Пополнение". Семантика первого баланса корректно отделена.
--
-- account_movements.source_kind check (0001) уже допускает 'opening' —
-- schema не меняется, только RPC.
-- ============================================================================

drop function if exists public.topup_account(uuid, numeric, text);
drop function if exists public.topup_account(uuid, numeric, text, text);

create function public.topup_account(
  p_account_id  uuid,
  p_amount      numeric,
  p_note        text,
  p_source_kind text default 'topup'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_mov_group uuid := gen_random_uuid();
  v_acc record;
  v_kind text := coalesce(p_source_kind, 'topup');
begin
  -- Ограничиваем допустимые значения, чтобы клиенту нельзя было подсунуть
  -- 'exchange_in' и смешаться с деалами.
  if v_kind not in ('topup', 'opening') then
    raise exception 'Invalid source_kind for topup_account: %', v_kind;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be > 0 (got %)', p_amount;
  end if;

  select * into v_acc from public.accounts where id = p_account_id;
  if v_acc is null then
    raise exception 'Account % not found', p_account_id;
  end if;

  insert into public.account_movements (
    account_id, amount, direction, currency_code, reserved,
    source_kind, movement_group_id, note, created_by
  ) values (
    p_account_id, p_amount, 'in', v_acc.currency_code, false,
    v_kind, v_mov_group, p_note, auth.uid()
  );
  return v_mov_group;
end;
$func$;

grant execute on function public.topup_account(uuid, numeric, text, text) to authenticated;
