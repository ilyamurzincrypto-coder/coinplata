-- 0105_counterparty_balances_views.sql
--
-- Aggregated balance views per counterparty — для Treasury → Пассивы
-- (counterparty-first группировка) и DealForm client autocomplete.
--
-- ledger.v_client_balances — балансы клиентов по валютам.
-- ledger.v_partner_balances — балансы OTC партнёров.
--
-- VIEW'ы агрегируют ledger.balances по (client_id|partner_id, currency_code).
-- Не меняют исходные таблицы; индексы на (client_id), (partner_id) уже есть
-- в ledger.balances PK через client_id_key / partner_id_key generated cols.

CREATE OR REPLACE VIEW ledger.v_client_balances AS
SELECT
  c.id                          AS client_id,
  c.nickname,
  c.full_name,
  c.telegram,
  c.tag,
  c.is_otc_partner,
  c.referrer_id,
  c.archived_at,
  b.currency_code,
  SUM(b.balance)                AS balance,
  COUNT(DISTINCT b.account_id)  AS source_accounts_count,
  MAX(b.updated_at)             AS last_movement,
  ARRAY_AGG(DISTINCT b.account_id) AS source_account_ids
FROM ledger.balances b
JOIN ledger.accounts a ON a.id = b.account_id
JOIN public.clients  c ON c.id = b.client_id
WHERE a.type = 'liability'
  AND a.subtype IN ('customer_liab', 'unearned')
  AND b.balance <> 0
GROUP BY c.id, c.nickname, c.full_name, c.telegram, c.tag,
         c.is_otc_partner, c.referrer_id, c.archived_at, b.currency_code;

COMMENT ON VIEW ledger.v_client_balances IS
  'Aggregated client liability balances per currency. Used in Treasury → Liabilities (counterparty grouping) and DealForm client autocomplete.';

CREATE OR REPLACE VIEW ledger.v_partner_balances AS
SELECT
  p.id                          AS partner_id,
  p.name,
  p.telegram,
  p.active,
  b.currency_code,
  SUM(b.balance)                AS balance,
  COUNT(DISTINCT b.account_id)  AS source_accounts_count,
  MAX(b.updated_at)             AS last_movement,
  ARRAY_AGG(DISTINCT b.account_id) AS source_account_ids
FROM ledger.balances b
JOIN ledger.accounts a ON a.id = b.account_id
JOIN public.partners p ON p.id = b.partner_id
WHERE a.type = 'liability'
  AND a.subtype = 'partner_liab'
  AND b.balance <> 0
GROUP BY p.id, p.name, p.telegram, p.active, b.currency_code;

COMMENT ON VIEW ledger.v_partner_balances IS
  'Aggregated partner liability balances per currency. Mirror of v_client_balances for OTC partners.';

GRANT SELECT ON ledger.v_client_balances  TO anon, authenticated;
GRANT SELECT ON ledger.v_partner_balances TO anon, authenticated;
