-- Cutover F2 — 4-param overload of create_opening_from_inventory (PR #17).
--
-- Adds a NEW overload alongside the existing 3-param signature. Splits the
-- previous p_crypto_wallets into two clean channels:
--   • p_office_crypto_input   — receive USDT (per office, with company-level
--                                option via office_id NULL for 1340/1341)
--   • p_company_crypto_output — send USDT (OUT-ONLY company wallets)
--
-- Lookups go through ledger.wallet_addresses.network — no metadata column.
-- Hard guard: Москва Вася office_id is rejected in p_office_crypto_input
-- (no crypto wallets for that office per owner final 2026-05-09).
--
-- 3-param signature kept for backward-compat; marked DEPRECATED via COMMENT.

CREATE OR REPLACE FUNCTION ledger.create_opening_from_inventory(
  p_office_cash           jsonb,
  p_office_crypto_input   jsonb,
  p_company_crypto_output jsonb,
  p_inter_office          jsonb,
  p_effective_date timestamptz DEFAULT now(),
  p_description    text DEFAULT 'Cutover opening (PR#17 4-param inventory)',
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
  v_io_value jsonb;
  v_io_account record;
  v_io_left text;
  v_io_right text;
  v_input_value jsonb;
  v_output_value jsonb;
  v_input_account record;
  v_output_account record;
  v_office_id_str text;
  v_office_id uuid;
  v_network text;
  v_balance numeric;
  v_validation_errors text[] := ARRAY[]::text[];
  v_currency_check record;
  v_moscow_vasya_id constant uuid := '12b68624-a75c-4909-a74a-fe108660c33e';
BEGIN
  -- Type checks
  IF jsonb_typeof(p_office_cash) <> 'array' THEN
    RAISE EXCEPTION 'p_office_cash must be a JSONB array' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_office_crypto_input) <> 'array' THEN
    RAISE EXCEPTION 'p_office_crypto_input must be a JSONB array' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_company_crypto_output) <> 'array' THEN
    RAISE EXCEPTION 'p_company_crypto_output must be a JSONB array' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_inter_office) <> 'array' THEN
    RAISE EXCEPTION 'p_inter_office must be a JSONB array' USING ERRCODE = '22000';
  END IF;

  -- All-empty guard: deferred tx_check_completeness (>=2 entries) would
  -- fail with a confusing error otherwise. Bail upfront with a clear msg.
  IF jsonb_array_length(p_office_cash) = 0
     AND jsonb_array_length(p_office_crypto_input) = 0
     AND jsonb_array_length(p_company_crypto_output) = 0
     AND jsonb_array_length(p_inter_office) = 0 THEN
    RAISE EXCEPTION 'Cutover opening requires at least one non-empty inventory array (cash, crypto_input, crypto_output, or inter_office)'
      USING ERRCODE = '22000';
  END IF;

  -- Pre-write validation: p_office_crypto_input
  FOR v_input_value IN SELECT value FROM jsonb_array_elements(p_office_crypto_input)
  LOOP
    IF v_input_value->>'network' IS NULL OR v_input_value->>'balance' IS NULL THEN
      v_validation_errors := array_append(v_validation_errors,
        'office_crypto_input requires network, balance: ' || v_input_value::text);
      CONTINUE;
    END IF;
    IF (v_input_value->>'network') NOT IN ('TRC20', 'ERC20') THEN
      v_validation_errors := array_append(v_validation_errors,
        'office_crypto_input network must be TRC20 or ERC20, got: ' || (v_input_value->>'network'));
    END IF;
    BEGIN
      v_balance := (v_input_value->>'balance')::numeric;
      IF v_balance < 0 THEN
        v_validation_errors := array_append(v_validation_errors,
          'office_crypto_input balance must be >= 0: ' || v_input_value::text);
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      v_validation_errors := array_append(v_validation_errors,
        'office_crypto_input balance is not numeric: ' || (v_input_value->>'balance'));
    END;

    v_office_id_str := nullif(v_input_value->>'office_id', '');
    IF v_office_id_str IS NOT NULL THEN
      BEGIN
        v_office_id := v_office_id_str::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_validation_errors := array_append(v_validation_errors,
          'office_crypto_input office_id is not a valid uuid: ' || v_office_id_str);
        CONTINUE;
      END;

      IF v_office_id = v_moscow_vasya_id THEN
        v_validation_errors := array_append(v_validation_errors,
          'Office Москва Вася has no crypto accounts. Remove from p_office_crypto_input.');
        CONTINUE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.offices WHERE id = v_office_id AND active) THEN
        v_validation_errors := array_append(v_validation_errors,
          'office_crypto_input office_id not found or inactive: ' || v_office_id::text);
      END IF;
    END IF;
  END LOOP;

  -- Pre-write validation: p_company_crypto_output
  FOR v_output_value IN SELECT value FROM jsonb_array_elements(p_company_crypto_output)
  LOOP
    IF v_output_value->>'network' IS NULL OR v_output_value->>'balance' IS NULL THEN
      v_validation_errors := array_append(v_validation_errors,
        'company_crypto_output requires network, balance: ' || v_output_value::text);
      CONTINUE;
    END IF;
    IF (v_output_value->>'network') NOT IN ('TRC20', 'ERC20') THEN
      v_validation_errors := array_append(v_validation_errors,
        'company_crypto_output network must be TRC20 or ERC20, got: ' || (v_output_value->>'network'));
    END IF;
    BEGIN
      v_balance := (v_output_value->>'balance')::numeric;
      IF v_balance < 0 THEN
        v_validation_errors := array_append(v_validation_errors,
          'company_crypto_output balance must be >= 0: ' || v_output_value::text);
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      v_validation_errors := array_append(v_validation_errors,
        'company_crypto_output balance is not numeric: ' || (v_output_value->>'balance'));
    END;
  END LOOP;

  -- Pre-write validation: p_inter_office shape
  FOR v_io_value IN SELECT value FROM jsonb_array_elements(p_inter_office)
  LOOP
    IF v_io_value->>'office_pair' IS NULL OR
       v_io_value->>'currency'   IS NULL OR
       v_io_value->>'amount'     IS NULL THEN
      v_validation_errors := array_append(v_validation_errors,
        'inter_office requires office_pair, currency, amount: ' || v_io_value::text);
    END IF;
  END LOOP;

  IF array_length(v_validation_errors, 1) > 0 THEN
    RAISE EXCEPTION E'Validation failed:\n  - %', array_to_string(v_validation_errors, E'\n  - ')
      USING ERRCODE = '22000';
  END IF;

  -- Create transaction header
  v_tx_id := gen_random_uuid();
  v_metadata_full := p_metadata || jsonb_build_object(
    'bypass_zero_floor', true,
    'bypass_anomaly', true,
    'cutover_office_cash_count',           jsonb_array_length(p_office_cash),
    'cutover_office_crypto_input_count',   jsonb_array_length(p_office_crypto_input),
    'cutover_company_crypto_output_count', jsonb_array_length(p_company_crypto_output),
    'cutover_inter_office_count',          jsonb_array_length(p_inter_office),
    'cutover_signature_version', 4,
    'partner_balances_excluded', true
  );

  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description,
     source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, NULL, p_effective_date, auth.uid(),
          p_description, 'opening', NULL, v_metadata_full);

  -- Phase 1a: office_cash (unchanged from 3-param)
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

  -- Phase 1b: office_crypto_input (lookup via wallet_addresses.network)
  FOR v_input_value IN SELECT value FROM jsonb_array_elements(p_office_crypto_input)
  LOOP
    v_office_id_str := nullif(v_input_value->>'office_id', '');
    v_office_id := CASE WHEN v_office_id_str IS NULL THEN NULL ELSE v_office_id_str::uuid END;
    v_network := v_input_value->>'network';
    v_balance := (v_input_value->>'balance')::numeric;
    IF v_balance = 0 THEN CONTINUE; END IF;

    SELECT a.id, a.code, a.currency_code INTO v_input_account
      FROM ledger.accounts a
     WHERE a.subtype = 'crypto_input'
       AND a.active
       AND ((v_office_id IS NULL AND a.office_id IS NULL)
            OR (a.office_id = v_office_id))
       AND EXISTS (
         SELECT 1 FROM ledger.wallet_addresses w
         WHERE w.account_id = a.id AND w.network = v_network AND w.active
       )
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'crypto_input account not found for office_id=%, network=%',
                      COALESCE(v_office_id::text, 'COMPANY'), v_network
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note)
    VALUES (v_tx_id, v_input_account.id, 'dr', v_balance, v_input_account.currency_code,
            'Cutover crypto_input ' || COALESCE(v_office_id::text, 'COMPANY') || ' ' || v_network);
  END LOOP;

  -- Phase 1c: company_crypto_output (LIKE 'TRC20%' covers TRC20-GasFree variant)
  FOR v_output_value IN SELECT value FROM jsonb_array_elements(p_company_crypto_output)
  LOOP
    v_network := v_output_value->>'network';
    v_balance := (v_output_value->>'balance')::numeric;
    IF v_balance = 0 THEN CONTINUE; END IF;

    SELECT a.id, a.code, a.currency_code INTO v_output_account
      FROM ledger.accounts a
     WHERE a.subtype = 'crypto_output'
       AND a.active
       AND a.office_id IS NULL
       AND EXISTS (
         SELECT 1 FROM ledger.wallet_addresses w
         WHERE w.account_id = a.id AND w.network LIKE v_network || '%' AND w.active
       )
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'crypto_output account not found for network=%', v_network
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note)
    VALUES (v_tx_id, v_output_account.id, 'dr', v_balance, v_output_account.currency_code,
            'Cutover crypto_output ' || v_network);
  END LOOP;

  -- Phase 1d: inter_office (unchanged from 3-param)
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
        USING ERRCODE = 'P0002';
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

  -- Phase 2: per-currency balancing through Opening Equity
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

  -- Phase 3: per-currency Dr=Cr final guard
  FOR v_currency_check IN
    SELECT je.currency_code AS cur,
           SUM(CASE WHEN je.direction='dr' THEN je.amount ELSE 0 END) AS dr_total,
           SUM(CASE WHEN je.direction='cr' THEN je.amount ELSE 0 END) AS cr_total
      FROM ledger.journal_entries je
     WHERE je.transaction_id = v_tx_id
     GROUP BY je.currency_code
  LOOP
    IF v_currency_check.dr_total <> v_currency_check.cr_total THEN
      RAISE EXCEPTION 'Per-currency imbalance after balancing: % Dr=% Cr=% (delta=%)',
                      v_currency_check.cur,
                      v_currency_check.dr_total,
                      v_currency_check.cr_total,
                      (v_currency_check.dr_total - v_currency_check.cr_total)
        USING ERRCODE = '22000';
    END IF;
  END LOOP;

  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'cutover.create_opening',
          format('Cutover opening (4-param): %s cash + %s crypto_input + %s crypto_output + %s inter-office',
                 jsonb_array_length(p_office_cash),
                 jsonb_array_length(p_office_crypto_input),
                 jsonb_array_length(p_company_crypto_output),
                 jsonb_array_length(p_inter_office)),
          jsonb_build_object('opening_tx_id', v_tx_id, 'signature_version', 4));

  RETURN v_tx_id;
END $function$;

ALTER FUNCTION ledger.create_opening_from_inventory(jsonb, jsonb, jsonb, jsonb, timestamptz, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.create_opening_from_inventory(jsonb, jsonb, jsonb, jsonb, timestamptz, text, jsonb)
  FROM PUBLIC, authenticated, anon;

COMMENT ON FUNCTION ledger.create_opening_from_inventory(jsonb, jsonb, jsonb, timestamptz, text, jsonb)
  IS 'DEPRECATED — use 4-param overload (p_office_cash, p_office_crypto_input, p_company_crypto_output, p_inter_office). Kept for backward-compat through 2026-05-19 cutover.';
