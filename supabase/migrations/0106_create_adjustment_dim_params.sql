-- ledger.create_adjustment(): add optional p_client_id / p_partner_id.
-- Wiring: when target/balancing account has client_dim_required=true and
-- p_client_id was passed → that entry gets client_id; same logic for partner.
-- Backwards-compatible: existing callers (no client/partner args) keep working.

CREATE OR REPLACE FUNCTION ledger.create_adjustment(
  p_idempotency_key uuid,
  p_request_hash text,
  p_account_code text,
  p_amount numeric,
  p_currency_code text,
  p_reason text,
  p_adjustment_kind text,
  p_balancing_account text DEFAULT NULL,
  p_effective_date timestamp with time zone DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_client_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'ledger', 'public'
AS $function$
DECLARE
  v_existing record;
  v_tx_id uuid;
  v_account record;
  v_balancing_account record;
  v_balancing_code text;
  v_metadata_full jsonb;
  v_acc_client uuid;
  v_acc_partner uuid;
  v_bal_client uuid;
  v_bal_partner uuid;
BEGIN
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

  IF NOT EXISTS (SELECT 1 FROM ledger.currencies WHERE code = p_currency_code) THEN
    RAISE EXCEPTION 'Unknown currency %', p_currency_code USING ERRCODE = 'P0002';
  END IF;
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

  SELECT id, code, currency_code, type, subtype, client_dim_required, partner_dim_required
    INTO v_account FROM ledger.accounts WHERE code = p_account_code AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % not found', p_account_code USING ERRCODE = 'P0002';
  END IF;
  IF v_account.currency_code <> p_currency_code THEN
    RAISE EXCEPTION 'Account % currency (%) does not match adjustment currency (%)',
      v_account.code, v_account.currency_code, p_currency_code USING ERRCODE = '22000';
  END IF;

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
          RAISE EXCEPTION 'No Retained Earnings account for currency %', p_currency_code USING ERRCODE = 'P0002';
        END IF;
      WHEN 'opening' THEN
        SELECT code INTO v_balancing_code FROM ledger.accounts
         WHERE subtype='opening_balance' AND currency_code = p_currency_code AND active;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No Opening Equity account for currency %', p_currency_code USING ERRCODE = 'P0002';
        END IF;
    END CASE;
  END IF;

  SELECT id, code, currency_code, client_dim_required, partner_dim_required
    INTO v_balancing_account FROM ledger.accounts WHERE code = v_balancing_code AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balancing account % not found', v_balancing_code USING ERRCODE = 'P0002';
  END IF;
  IF v_balancing_account.currency_code <> p_currency_code THEN
    RAISE EXCEPTION 'Balancing account % currency mismatch', v_balancing_account.code USING ERRCODE = '22000';
  END IF;
  IF v_balancing_account.code = v_account.code THEN
    RAISE EXCEPTION 'balancing_account must differ from account_code (%)', v_account.code USING ERRCODE = '22000';
  END IF;

  v_acc_client  := CASE WHEN v_account.client_dim_required  THEN p_client_id  ELSE NULL END;
  v_acc_partner := CASE WHEN v_account.partner_dim_required THEN p_partner_id ELSE NULL END;
  v_bal_client  := CASE WHEN v_balancing_account.client_dim_required  THEN p_client_id  ELSE NULL END;
  v_bal_partner := CASE WHEN v_balancing_account.partner_dim_required THEN p_partner_id ELSE NULL END;

  IF v_account.client_dim_required  AND p_client_id  IS NULL THEN
    RAISE EXCEPTION 'Account % requires p_client_id', v_account.code USING ERRCODE = '23502';
  END IF;
  IF v_account.partner_dim_required AND p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Account % requires p_partner_id', v_account.code USING ERRCODE = '23502';
  END IF;

  v_tx_id := gen_random_uuid();
  v_metadata_full := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'adjustment_kind', p_adjustment_kind,
    'reason', p_reason,
    'balancing_account', v_balancing_account.code,
    'amount_signed', p_amount,
    'client_id', p_client_id,
    'partner_id', p_partner_id
  );

  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description, source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, p_idempotency_key, p_effective_date, auth.uid(),
          format('Adjustment (%s): %s', p_adjustment_kind, p_reason),
          'adjustment', NULL, v_metadata_full);

  IF p_amount > 0 THEN
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, client_id, partner_id, note) VALUES
      (v_tx_id, v_account.id,           'dr', p_amount, p_currency_code, v_acc_client, v_acc_partner,
       format('Adjustment %s: %s', p_adjustment_kind, p_reason)),
      (v_tx_id, v_balancing_account.id, 'cr', p_amount, p_currency_code, v_bal_client, v_bal_partner,
       format('Balancing entry (%s)', v_balancing_account.code));
  ELSE
    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, client_id, partner_id, note) VALUES
      (v_tx_id, v_account.id,           'cr', ABS(p_amount), p_currency_code, v_acc_client, v_acc_partner,
       format('Adjustment %s: %s', p_adjustment_kind, p_reason)),
      (v_tx_id, v_balancing_account.id, 'dr', ABS(p_amount), p_currency_code, v_bal_client, v_bal_partner,
       format('Balancing entry (%s)', v_balancing_account.code));
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ledger.idempotency_keys (key, transaction_id, request_hash)
    VALUES (p_idempotency_key, v_tx_id, p_request_hash);
  END IF;

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
            'client_id', p_client_id,
            'partner_id', p_partner_id,
            'created_by', auth.uid()
          ));

  RETURN v_tx_id;
END $function$;

REVOKE ALL ON FUNCTION ledger.create_adjustment(uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.create_adjustment(uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb, uuid, uuid) TO anon, authenticated;
