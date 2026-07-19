-- aegis_account_columns_and_deliveries.sql — применено в прод 2026-07-19.
-- AEGIS-интеграция (часть B, шаг 1). Аддитивно, NULLable — существующие счета
-- не задеты (проверено: 45 счетов, 0 тронуто). balance_usd_est информационная
-- (НЕ авторитетна для денег/леджера). network_id НЕ трогаем (остаётся
-- 'TRC20'/'ERC20' для резолва каналов); нормализация в lowercase для AEGIS —
-- на границе в src/lib/aegisClient.js.
alter table public.accounts
  add column if not exists aegis_wallet_id   text,
  add column if not exists aegis_capability  text,
  add column if not exists risk_level        text,
  add column if not exists risk_updated_at   timestamptz,
  add column if not exists balance_usd_est   numeric,
  add column if not exists synced_at         timestamptz;

-- Канон риска из /v1: ok|warning|critical (или NULL = не подключён/нет данных).
-- Внутренний aml.js (low/medium/high) — другой домен, здесь не смешиваем.
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema='public' and table_name='accounts' and constraint_name='accounts_risk_level_chk'
  ) then
    alter table public.accounts
      add constraint accounts_risk_level_chk
      check (risk_level is null or risk_level in ('ok','warning','critical'));
  end if;
end $$;

create index if not exists accounts_aegis_wallet_idx
  on public.accounts (aegis_wallet_id) where aegis_wallet_id is not null;
create index if not exists accounts_risk_level_idx
  on public.accounts (risk_level) where risk_level is not null;

-- Дедуп доставок вебхука AEGIS (at-least-once → возможны повторы).
-- По образцу ledger.idempotency_keys. RLS вкл без политик → только service-role.
create table if not exists public.aegis_webhook_deliveries (
  delivery_id  text primary key,
  event_type   text,
  received_at  timestamptz not null default now()
);
alter table public.aegis_webhook_deliveries enable row level security;
