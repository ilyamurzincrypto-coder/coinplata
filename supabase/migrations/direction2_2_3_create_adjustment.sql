-- Direction 2 — ШАГ 2.3: ledger.create_adjustment
--
-- Manual adjustment с тремя kinds:
--   • reconciliation — исправление расхождения. Default balancing =
--                      Retained Earnings · {currency}. Override possible.
--   • transfer       — кросс-account adjustment. p_balancing_account REQUIRED.
--   • opening        — для cutover scripts. Default balancing =
--                      Opening Balance Equity · {currency}.
--
-- Step 0 (после idempotency): validate currency exists в ledger.currencies
-- (catches typos USDX → USDT etc.)
--
-- amount > 0 → Dr p_account_code, Cr balancing_account
-- amount < 0 → Cr p_account_code, Dr balancing_account
--
-- RLS: только postgres + service_role могут вызывать. Audit alert level='warn'
-- на каждый adjustment.

CREATE OR REPLACE FUNCTION ledger.create_adjustment(
  p_idempotency_key uuid,
  p_request_hash text,
  p_account_code text,
  p_amount numeric,
  p_currency_code text,
  p_reason text,
  p_adjustment_kind text,
  p_balancing_account text DEFAULT NULL,
  p_effective_date timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_existing record;
  v_tx_id uuid;
  v_account record;
  v_balancing_account record;
  v_balancing_code text;
  v_metadata_full jsonb;
BEGIN
  -- 1. Idempotency lookup
  IF p_idempotency_key IS NOT NULL THEN
    SELECT transaction_id, request_hash INTO v_existing
      FROM ledger.idempotency_keys
     WHERE key = p_idempotency_key AND expires_at > now() FOR UPDATE;
    IF FOUND THEN
      IF v_existing.request_hash <> p_request_hash THEN
        RAISE EXCEPTION 'Idempotency key reused with different payload (key=%)', p_idempotency_key
          USING ERRCODE = 'P0422';
      END IF;
      RETURN v_existing.transaction_id;
    END IF;
  END IF;

  -- 2. Validate currency exists (catches typos USDX → USDT etc.)
  IF NOT EXISTS (SELECT 1 FROM ledger.currencies WHERE code = p_currency_code) THEN
    RAISE EXCEPTION 'Unknown currency %', p_currency_code
      USING ERRCODE = 'P0002',
            DETAIL = format('Currency %s is not registered in ledger.currencies', p_currency_code),
            HINT = 'Available currencies: USD, EUR, TRY, RUB, GBP, CHF, USDT, USDC, BTC, ETH';
  END IF;

  -- 3. Validate basic inputs
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero (got %)', p_amount USING ERRCODE = '22000';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required (audit-trail)' USING ERRCODE = '22000';
  END IF;
  IF p_adjustment_kind NOT IN ('reconciliation', 'transfer', 'opening') THEN
    RAISE EXCEPTION 'adjustment_kind must be reconciliation|transfer|opening (got %)', p_adjustment_kind
      USING ERRCODE = '22000';
  END IF;

  -- 4. Validate target account
  SELECT id, code, currency_code, type, subtype INTO v_account
    FROM ledger.accounts WHERE code = p_account_code AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % not found', p_account_code USING ERRCODE = 'P0002';
  END IF;
  IF v_account.currency_code <> p_currency_code THEN
    RAISE EXCEPTION 'Account % currency (%) does not match adjustment currency (%)',
      v_account.code, v_account.currency_code, p_currency_code USING ERRCODE = '22000';
  END IF;

  -- 5. Resolve balancing_account по kind
  IF p_balancing_account IS NOT NULL THEN
    v_balancing_code := p_balancing_account;
  ELSE
    CASE p_adjustment_kind
      WHEN 'transfer' THEN
        RAISE EXCEPTION 'transfer kind requires balancing_account' USING ERRCODE = '22000';
      WHEN 'reconciliation' THEN
        SELECT code INTO v_balancing_code FROM ledger.accounts
         WHERE subtype='retained_earnings' AND currency_code = p_currency_code AND active;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No Retained Earnings account for currency %', p_currency_code
            USING ERRCODE = 'P0002',
              DETAIL = format('Currency %s requires Retained Earnings account in chart of accounts', p_currency_code),
              HINT = format('Run migration to seed Retained Earnings · %s first or pass explicit p_balancing_account', p_currency_code);
        END IF;
      WHEN 'opening' THEN
        SELECT code INTO v_balancing_code FROM ledger.accounts
         WHERE subtype='opening_balance' AND currency_code = p_currency_code AND active;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No Opening Equity account for currency %', p_currency_code
            USING ERRCODE = 'P0002',
              DETAIL = format('Currency %s requires Opening Balance Equity account in chart of accounts', p_currency_code),
              HINT = format('Run migration to seed Opening · %s first', p_currency_code);
        END IF;
    END CASE;
  END IF;

  -- 6. Validate balancing account
  SELECT id, code, currency_code INTO v_balancing_account
    FROM ledger.accounts WHERE code = v_balancing_code AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balancing account % not found', v_balancing_code USING ERRCODE = 'P0002';
  END IF;
  IF v_balancing_account.currency_code <> p_currency_code THEN
    RAISE EXCEPTION 'Balancing account % currency (%) does not match (%)',
      v_balancing_account.code, v_balancing_account.currency_code, p_currency_code USING ERRCODE = '22000';
  END IF;
  IF v_balancing_account.code = v_account.code THEN
    RAISE EXCEPTION 'balancing_account must differ from account_code (%)', v_account.code
      USING ERRCODE = '22000';
  END IF;

  -- 7. Insert transaction
  v_tx_id := gen_random_uuid();
  v_metadata_full := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'adjustment_kind', p_adjustment_kind,
    'reason', p_reason,
    'balancing_account', v_balancing_account.code,
    'amount_signed', p_amount
  );

  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description, source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, p_idempotency_key, p_effective_date, auth.uid(),
          format('Adjustment (%s): %s', p_adjustment_kind, p_reason),
          'adjustment', NULL, v_metadata_full);

  -- 8. Insert 2 entries (Dr/Cr по знаку amount)
  IF p_amount > 0 THEN
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note) VALUES
      (v_tx_id, v_account.id,           'dr', p_amount, p_currency_code,
       format('Adjustment %s: %s', p_adjustment_kind, p_reason)),
      (v_tx_id, v_balancing_account.id, 'cr', p_amount, p_currency_code,
       format('Balancing entry (%s)', v_balancing_account.code));
  ELSE
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note) VALUES
      (v_tx_id, v_account.id,           'cr', ABS(p_amount), p_currency_code,
       format('Adjustment %s: %s', p_adjustment_kind, p_reason)),
      (v_tx_id, v_balancing_account.id, 'dr', ABS(p_amount), p_currency_code,
       format('Balancing entry (%s)', v_balancing_account.code));
  END IF;

  -- 9. Save idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ledger.idempotency_keys (key, transaction_id, request_hash)
    VALUES (p_idempotency_key, v_tx_id, p_request_hash);
  END IF;

  -- 10. Audit alert (warn — adjustments редкие, должны быть видны)
  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'rpc.create_adjustment',
          format('Adjustment created: %s %s on %s (kind=%s)',
                 p_amount, p_currency_code, p_account_code, p_adjustment_kind),
          jsonb_build_object(
            'tx_id', v_tx_id,
            'account_code', p_account_code,
            'balancing_account', v_balancing_account.code,
            'amount', p_amount,
            'currency', p_currency_code,
            'kind', p_adjustment_kind,
            'reason', p_reason,
            'created_by', auth.uid()
          ));

  RETURN v_tx_id;
END $function$;

ALTER FUNCTION ledger.create_adjustment(uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.create_adjustment(uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION ledger.create_adjustment(uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb) TO service_role;
