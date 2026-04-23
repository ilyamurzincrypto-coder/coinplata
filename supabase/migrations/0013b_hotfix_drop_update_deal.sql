-- ============================================================================
-- CoinPlata · 0013b_hotfix_drop_update_deal.sql
--
-- Если получили ошибку "function update_deal already exists with same
-- argument types" при применении 0013 — это значит что в БД уже лежит
-- функция с новой 14-параметровой сигнатурой (частично применилась).
--
-- Запустите этот блок ПЕРЕД 0013 — он снесёт обе возможные версии.
-- Безопасно запускать повторно.
-- ============================================================================

-- 12-параметровая (старая, до 0013)
drop function if exists public.update_deal(
  bigint, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text, jsonb
);

-- 14-параметровая (новая, после 0013)
drop function if exists public.update_deal(
  bigint, uuid, uuid, text, text, numeric, uuid, text, boolean, text, text, jsonb,
  timestamptz, boolean
);
