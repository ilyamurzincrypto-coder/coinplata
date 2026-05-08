-- Cutover B1 — drop partner_id support в opening transaction.
--
-- Owner подтвердил: партнёрские балансы (Шериф, Мехмет) при cutover
-- НЕ используются. Команда работает с партнёрами как с обычными клиентами.
--
-- Изменения:
--   • Опытка inventory entry с partner_dim_required=true account → RAISE
--     с понятным сообщением (partner_liab accounts не должны попадать
--     в opening на cutover-day).
--   • partner_id поле в inventory JSONB теперь ignored.
--   • Customer Liab path (client_dim_required) продолжает работать
--     как раньше.
--   • metadata.partner_balances_excluded=true для post-cutover audit.

CREATE OR REPLACE FUNCTION ledger.create_opening_from_inventory(
  p_inventory      jsonb,
  p_effective_date timestamptz DEFAULT now(),
  p_description    text        DEFAULT 'Cutover opening from physical inventory',
  p_metadata       jsonb       DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_tx_id uuid;
  v_metadata_full jsonb;
  rec record;
  v_account record;
  v_amount numeric;
  v_client_id uuid;
  v_dr boolean;
  v_currency_net record;
  v_opening_acc_id uuid;
BEGIN
  IF jsonb_typeof(p_inventory) <> 'array' OR jsonb_array_length(p_inventory) = 0 THEN
    RAISE EXCEPTION 'p_inventory must be a non-empty JSONB array' USING ERRCODE = '22000';
  END IF;

  v_tx_id := gen_random_uuid();
  v_metadata_full := p_metadata || jsonb_build_object(
    'bypass_zero_floor', true,
    'bypass_anomaly', true,
    'cutover_inventory_count', jsonb_array_length(p_inventory),
    'partner_balances_excluded', true
  );

  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description,
     source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, NULL, p_effective_date, auth.uid(),
          p_description, 'opening', NULL, v_metadata_full);

  -- Phase 1: inventory rows как entries (partner accounts blocked)
  FOR rec IN SELECT * FROM jsonb_array_elements(p_inventory) AS inv
  LOOP
    SELECT id, code, name, type, subtype, currency_code,
           client_dim_required, partner_dim_required
      INTO v_account
      FROM ledger.accounts WHERE code = (rec.value->>'account_code')::text AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account % not found in chart of accounts', rec.value->>'account_code'
        USING ERRCODE = 'P0002';
    END IF;

    v_amount := (rec.value->>'amount')::numeric;
    IF v_amount = 0 THEN CONTINUE; END IF;

    -- Drop partner support: partner_dim_required accounts blocked on cutover
    IF v_account.partner_dim_required THEN
      RAISE EXCEPTION 'Partner Liab account % cannot be used in cutover opening', v_account.code
        USING ERRCODE = '22000',
              DETAIL = 'Partners treated as regular clients in new ledger (per owner decision)',
              HINT = 'Use Customer Liab account for the same currency instead';
    END IF;

    v_client_id := nullif(rec.value->>'client_id', '')::uuid;

    IF v_account.client_dim_required AND v_client_id IS NULL THEN
      RAISE EXCEPTION 'Account % requires client_id (got NULL)', v_account.code
        USING ERRCODE = '23502';
    END IF;

    IF v_account.type IN ('asset','expense') THEN
      v_dr := (v_amount > 0);
    ELSE
      v_dr := (v_amount < 0);
    END IF;

    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code,
       client_id, partner_id, note)
    VALUES (
      v_tx_id, v_account.id,
      CASE WHEN v_dr THEN 'dr' ELSE 'cr' END,
      ABS(v_amount), v_account.currency_code,
      v_client_id, NULL,
      'Cutover opening: ' || v_account.code || ' = ' || v_amount::text
    );
  END LOOP;

  -- Phase 2: balancing через Opening Equity per currency
  FOR v_currency_net IN
    SELECT je.currency_code AS cur,
           SUM(CASE WHEN je.direction='dr' THEN je.amount ELSE -je.amount END) AS net_dr_cr
      FROM ledger.journal_entries je
     WHERE je.transaction_id = v_tx_id
     GROUP BY je.currency_code
     HAVING SUM(CASE WHEN je.direction='dr' THEN je.amount ELSE -je.amount END) <> 0
  LOOP
    SELECT id INTO v_opening_acc_id FROM ledger.accounts
      WHERE subtype = 'opening_balance' AND currency_code = v_currency_net.cur AND active LIMIT 1;
    IF v_opening_acc_id IS NULL THEN
      RAISE EXCEPTION 'Opening Balance Equity for currency % not found', v_currency_net.cur
        USING ERRCODE = 'P0002',
        HINT = 'Add Opening Balance Equity · <currency> account first';
    END IF;

    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note)
    VALUES (
      v_tx_id, v_opening_acc_id,
      CASE WHEN v_currency_net.net_dr_cr > 0 THEN 'cr' ELSE 'dr' END,
      ABS(v_currency_net.net_dr_cr), v_currency_net.cur,
      'Cutover balancing: net capital in ' || v_currency_net.cur
    );
  END LOOP;

  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'cutover.create_opening',
          format('Cutover opening transaction created (%s entries, partners excluded)',
                 (SELECT count(*) FROM ledger.journal_entries WHERE transaction_id = v_tx_id)),
          jsonb_build_object('opening_tx_id', v_tx_id,
                             'effective_date', p_effective_date,
                             'inventory_count', jsonb_array_length(p_inventory),
                             'partner_balances_excluded', true));

  RETURN v_tx_id;
END $function$;

ALTER FUNCTION ledger.create_opening_from_inventory(jsonb, timestamptz, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.create_opening_from_inventory(jsonb, timestamptz, text, jsonb)
  FROM PUBLIC, authenticated, anon;
