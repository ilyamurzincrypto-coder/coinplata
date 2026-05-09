-- Cutover E2 — extend create_opening_from_inventory с crypto wallets +
-- inter-office balances. Backward compat: pure cash inventory работает
-- (через 1-параметрическую signature, see cutover_1_*.sql).
--
-- Новая 3-параметрическая signature:
--   • p_office_cash    — array of {account_code, amount, client_id?}
--   • p_crypto_wallets — array of {wallet_id, balance, currency?}
--   • p_inter_office   — array of {office_pair, currency, amount, direction}
--
-- direction format: 'left_owes_right' где left/right = short_codes офисов
-- по lex-order. Например 'mark_owes_terra'. Reverse 'terra_owes_mark'
-- автоматически инвертирует знак.

CREATE OR REPLACE FUNCTION ledger.create_opening_from_inventory(
  p_office_cash    jsonb,
  p_crypto_wallets jsonb DEFAULT '[]'::jsonb,
  p_inter_office   jsonb DEFAULT '[]'::jsonb,
  p_effective_date timestamptz DEFAULT now(),
  p_description    text DEFAULT 'Cutover opening (extended inventory)',
  p_metadata       jsonb DEFAULT '{}'::jsonb
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
  v_wallet record;
  v_wallet_account record;
  v_io_value jsonb;
  v_io_account record;
  v_io_left text;
  v_io_right text;
BEGIN
  IF jsonb_typeof(p_office_cash) <> 'array' OR jsonb_array_length(p_office_cash) = 0 THEN
    RAISE EXCEPTION 'p_office_cash must be a non-empty JSONB array' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_crypto_wallets) <> 'array' THEN
    RAISE EXCEPTION 'p_crypto_wallets must be a JSONB array' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_inter_office) <> 'array' THEN
    RAISE EXCEPTION 'p_inter_office must be a JSONB array' USING ERRCODE = '22000';
  END IF;

  FOR v_io_value IN SELECT value FROM jsonb_array_elements(p_inter_office)
  LOOP
    IF v_io_value->>'office_pair' IS NULL OR
       v_io_value->>'currency'   IS NULL OR
       v_io_value->>'amount'     IS NULL THEN
      RAISE EXCEPTION 'inter_office entry requires office_pair, currency, amount; got %',
                      v_io_value USING ERRCODE = '22000';
    END IF;
  END LOOP;

  v_tx_id := gen_random_uuid();
  v_metadata_full := p_metadata || jsonb_build_object(
    'bypass_zero_floor', true,
    'bypass_anomaly', true,
    'cutover_office_cash_count',    jsonb_array_length(p_office_cash),
    'cutover_crypto_wallets_count', jsonb_array_length(p_crypto_wallets),
    'cutover_inter_office_count',   jsonb_array_length(p_inter_office),
    'partner_balances_excluded', true
  );

  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description,
     source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, NULL, p_effective_date, auth.uid(),
          p_description, 'opening', NULL, v_metadata_full);

  -- Phase 1a: office_cash
  FOR rec IN SELECT * FROM jsonb_array_elements(p_office_cash) AS inv
  LOOP
    SELECT id, code, type, subtype, currency_code,
           client_dim_required, partner_dim_required
      INTO v_account
      FROM ledger.accounts WHERE code = (rec.value->>'account_code')::text AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account % not found', rec.value->>'account_code' USING ERRCODE = 'P0002';
    END IF;
    v_amount := (rec.value->>'amount')::numeric;
    IF v_amount = 0 THEN CONTINUE; END IF;
    IF v_account.partner_dim_required THEN
      RAISE EXCEPTION 'Partner Liab account % cannot be used in cutover', v_account.code
        USING ERRCODE = '22000';
    END IF;
    v_client_id := nullif(rec.value->>'client_id', '')::uuid;
    IF v_account.client_dim_required AND v_client_id IS NULL THEN
      RAISE EXCEPTION 'Account % requires client_id', v_account.code USING ERRCODE = '23502';
    END IF;
    IF v_account.type IN ('asset','expense') THEN v_dr := (v_amount > 0);
    ELSE v_dr := (v_amount < 0); END IF;
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, client_id, partner_id, note)
    VALUES (v_tx_id, v_account.id,
            CASE WHEN v_dr THEN 'dr' ELSE 'cr' END,
            ABS(v_amount), v_account.currency_code, v_client_id, NULL,
            'Cutover office_cash: ' || v_account.code);
  END LOOP;

  -- Phase 1b: crypto wallets
  FOR rec IN SELECT * FROM jsonb_array_elements(p_crypto_wallets) AS w
  LOOP
    IF rec.value->>'wallet_id' IS NULL OR rec.value->>'balance' IS NULL THEN
      RAISE EXCEPTION 'crypto_wallet entry requires wallet_id, balance' USING ERRCODE = '22000';
    END IF;
    SELECT id, account_id INTO v_wallet
      FROM ledger.wallet_addresses WHERE id = (rec.value->>'wallet_id')::uuid AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wallet_id % not found in ledger.wallet_addresses',
                      rec.value->>'wallet_id' USING ERRCODE = 'P0002';
    END IF;
    SELECT id, code, type, subtype, currency_code INTO v_wallet_account
      FROM ledger.accounts WHERE id = v_wallet.account_id AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wallet account % not found', v_wallet.account_id USING ERRCODE = 'P0002';
    END IF;
    IF rec.value->>'currency' IS NOT NULL
       AND (rec.value->>'currency') <> v_wallet_account.currency_code THEN
      RAISE EXCEPTION 'wallet % currency mismatch: expected %, got %',
                      rec.value->>'wallet_id', v_wallet_account.currency_code,
                      rec.value->>'currency' USING ERRCODE = '22000';
    END IF;
    v_amount := (rec.value->>'balance')::numeric;
    IF v_amount = 0 THEN CONTINUE; END IF;
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note)
    VALUES (v_tx_id, v_wallet_account.id,
            CASE WHEN v_amount > 0 THEN 'dr' ELSE 'cr' END,
            ABS(v_amount), v_wallet_account.currency_code,
            'Cutover crypto_wallet ' || v_wallet.id::text);
  END LOOP;

  -- Phase 1c: inter-office balances
  FOR v_io_value IN SELECT value FROM jsonb_array_elements(p_inter_office)
  LOOP
    SELECT id, code, currency_code INTO v_io_account
      FROM ledger.accounts
      WHERE subtype = 'inter_office'
        AND active
        AND currency_code = (v_io_value->>'currency')::text
        AND name LIKE 'Inter-office · ' ||
            split_part(v_io_value->>'office_pair', '_', 1) || '↔' ||
            split_part(v_io_value->>'office_pair', '_', 2) || ' · %';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inter-office account for pair=%, currency=% not found',
                      v_io_value->>'office_pair', v_io_value->>'currency'
        USING ERRCODE = 'P0002',
              HINT = 'Run cutover_2_inter_office_accounts_seed.sql first';
    END IF;

    v_io_left  := split_part(v_io_value->>'office_pair', '_', 1);
    v_io_right := split_part(v_io_value->>'office_pair', '_', 2);
    v_amount := (v_io_value->>'amount')::numeric;
    IF v_io_value->>'direction' = (v_io_right || '_owes_' || v_io_left) THEN
      v_amount := -v_amount;
    ELSIF v_io_value->>'direction' <> (v_io_left || '_owes_' || v_io_right) THEN
      RAISE EXCEPTION 'inter_office direction must be %_owes_% or %_owes_%',
                      v_io_left, v_io_right, v_io_right, v_io_left
        USING ERRCODE = '22000';
    END IF;

    IF v_amount = 0 THEN CONTINUE; END IF;
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note)
    VALUES (v_tx_id, v_io_account.id,
            CASE WHEN v_amount > 0 THEN 'dr' ELSE 'cr' END,
            ABS(v_amount), v_io_account.currency_code,
            'Cutover inter_office ' || (v_io_value->>'office_pair') || ' ' ||
              (v_io_value->>'direction'));
  END LOOP;

  -- Phase 2: balancing per currency
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
        USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note)
    VALUES (v_tx_id, v_opening_acc_id,
            CASE WHEN v_currency_net.net_dr_cr > 0 THEN 'cr' ELSE 'dr' END,
            ABS(v_currency_net.net_dr_cr), v_currency_net.cur,
            'Cutover balancing: net capital in ' || v_currency_net.cur);
  END LOOP;

  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'cutover.create_opening',
          format('Cutover opening: %s cash + %s wallets + %s inter-office',
                 jsonb_array_length(p_office_cash),
                 jsonb_array_length(p_crypto_wallets),
                 jsonb_array_length(p_inter_office)),
          jsonb_build_object('opening_tx_id', v_tx_id));

  RETURN v_tx_id;
END $function$;

ALTER FUNCTION ledger.create_opening_from_inventory(jsonb, jsonb, jsonb, timestamptz, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.create_opening_from_inventory(jsonb, jsonb, jsonb, timestamptz, text, jsonb)
  FROM PUBLIC, authenticated, anon;
