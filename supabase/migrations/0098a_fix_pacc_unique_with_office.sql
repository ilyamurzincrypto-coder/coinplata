-- ============================================================================
-- CoinPlata · 0098a_fix_pacc_unique_with_office.sql
-- ============================================================================
-- Фикс partial unique pacc_unique_active_idx: добавляем office_id в ключ.
--
-- Симптом: backfill self-аккаунтов упал на duplicate violation для
-- (Coinplata, USD, cash, '', '') — у нас несколько USD-cash касс в
-- разных офисах, и они должны быть разрешены как разные счета.
--
-- Фикс: ключ теперь включает coalesce(office_id::text, ''). Для partner-
-- аккаунтов office_id=null → '' для всех, поведение не меняется. Для
-- self — office_id различает кассы офисов.
-- ============================================================================

drop index if exists public.pacc_unique_active_idx;

create unique index pacc_unique_active_idx on public.participant_accounts (
  participant_id,
  currency_code,
  coalesce(channel, ''),
  coalesce(network_id, ''),
  coalesce(lower(trim(address)), ''),
  coalesce(office_id::text, '')
) where active = true;

-- Verify
select indexname, indexdef
  from pg_indexes
  where schemaname = 'public' and indexname = 'pacc_unique_active_idx';
