-- posting_master_2_allow_admin.sql
--
-- Расширяет _require_role на ledger.create_manual_entry до {owner, admin, accountant}.
-- Раньше admin был accounting:view — приматывался к owner/accountant для approve/reject
-- капитальных операций. С 2026-05 Казначейство стало UI-источником правды
-- (inline-edit остатков, ручные проводки), и admin тоже должен мочь писать.
--
-- Безопасность не падает: write всё ещё проходит через _require_role и SECURITY DEFINER;
-- роль logged в transactions.metadata.posted_by_role и в audit_alerts.

CREATE OR REPLACE FUNCTION ledger.create_manual_entry(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_lines           jsonb,
  p_currency_code   text,
  p_reason          text,
  p_effective_date  timestamptz DEFAULT now(),
  p_description     text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_existing    record;
  v_caller_role text;
  v_tx_id       uuid;
  v_line        jsonb;
  v_idx         int := 0;
  v_dir         text;
  v_amt         numeric;
  v_code        text;
  v_acc         record;
  v_client      uuid;
  v_partner     uuid;
  v_sum_dr      numeric := 0;
  v_sum_cr      numeric := 0;
  v_n_dr        int := 0;
  v_n_cr        int := 0;
  v_n_lines     int;
  v_metadata    jsonb;
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

  -- 2. Caller role (raises 42501 for not-authenticated / wrong role)
  --    Added 'admin' to the allowlist (was {owner, accountant}).
  v_caller_role := public._require_role(ARRAY['owner','admin','accountant']);

  -- 3. Validate currency
  IF NOT EXISTS (SELECT 1 FROM ledger.currencies WHERE code = p_currency_code) THEN
    RAISE EXCEPTION 'Unknown currency %', p_currency_code USING ERRCODE = 'P0002',
      DETAIL = format('Currency %s is not registered in ledger.currencies', p_currency_code);
  END IF;

  -- 4. Validate reason
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required (audit-trail)' USING ERRCODE = '22000';
  END IF;

  -- 5. Validate lines container
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be a JSON array' USING ERRCODE = '22000';
  END IF;
  v_n_lines := jsonb_array_length(p_lines);
  IF v_n_lines < 2 THEN
    RAISE EXCEPTION 'a manual entry needs at least 2 lines (got %)', v_n_lines USING ERRCODE = '22000';
  END IF;

  -- 6. Validate each line
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;

    v_dir := lower(v_line->>'direction');
    IF v_dir IS NULL OR v_dir NOT IN ('dr','cr') THEN
      RAISE EXCEPTION 'line %: direction must be dr|cr (got %)', v_idx, v_line->>'direction'
        USING ERRCODE = '22000';
    END IF;

    BEGIN
      v_amt := (v_line->>'amount')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'line %: amount is not a number (got %)', v_idx, v_line->>'amount'
        USING ERRCODE = '22000';
    END;
    IF v_amt IS NULL OR v_amt <= 0 THEN
      RAISE EXCEPTION 'line %: amount must be > 0 (got %)', v_idx, v_amt USING ERRCODE = '22000';
    END IF;

    v_code := v_line->>'account_code';
    SELECT id, code, currency_code, client_dim_required, partner_dim_required
      INTO v_acc
      FROM ledger.accounts WHERE code = v_code AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line %: account % not found or inactive', v_idx, v_code USING ERRCODE = 'P0002';
    END IF;
    IF v_acc.currency_code <> p_currency_code THEN
      RAISE EXCEPTION 'line %: account % currency (%) does not match entry currency (%)',
        v_idx, v_code, v_acc.currency_code, p_currency_code USING ERRCODE = '22000';
    END IF;

    v_client  := NULLIF(v_line->>'client_id','')::uuid;
    v_partner := NULLIF(v_line->>'partner_id','')::uuid;
    IF v_acc.client_dim_required AND v_client IS NULL THEN
      RAISE EXCEPTION 'line %: account % requires a client_id', v_idx, v_code USING ERRCODE = '22000';
    END IF;
    IF v_acc.partner_dim_required AND v_partner IS NULL THEN
      RAISE EXCEPTION 'line %: account % requires a partner_id', v_idx, v_code USING ERRCODE = '22000';
    END IF;

    IF v_dir = 'dr' THEN v_sum_dr := v_sum_dr + v_amt; v_n_dr := v_n_dr + 1;
                    ELSE v_sum_cr := v_sum_cr + v_amt; v_n_cr := v_n_cr + 1; END IF;
  END LOOP;

  -- 7. Composition + balance
  IF v_n_dr = 0 OR v_n_cr = 0 THEN
    RAISE EXCEPTION 'a manual entry needs at least one Dr and one Cr line' USING ERRCODE = '22000';
  END IF;
  IF abs(v_sum_dr - v_sum_cr) > 0.01 THEN
    RAISE EXCEPTION 'entry does not balance: Dr % <> Cr %', v_sum_dr, v_sum_cr USING ERRCODE = '22000';
  END IF;

  -- 8. Insert transaction
  v_tx_id := gen_random_uuid();
  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'reason', p_reason, 'line_count', v_n_lines, 'posted_by_role', v_caller_role
  );
  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description, source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, p_idempotency_key, p_effective_date, auth.uid(),
          COALESCE(NULLIF(trim(p_description), ''), 'Manual entry: ' || p_reason),
          'manual', NULL, v_metadata);

  -- 9. Insert journal entries (lines already validated above)
  INSERT INTO ledger.journal_entries
    (transaction_id, account_id, direction, amount, currency_code, client_id, partner_id, note)
  SELECT v_tx_id, a.id, lower(l->>'direction'), (l->>'amount')::numeric, p_currency_code,
         NULLIF(l->>'client_id','')::uuid, NULLIF(l->>'partner_id','')::uuid, 'Manual: ' || p_reason
    FROM jsonb_array_elements(p_lines) AS l
    JOIN ledger.accounts a ON a.code = l->>'account_code' AND a.active;

  -- 10. Save idempotency key
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ledger.idempotency_keys (key, transaction_id, request_hash)
    VALUES (p_idempotency_key, v_tx_id, p_request_hash);
  END IF;

  -- 11. Audit alert (warn — manual postings are rare and should be visible)
  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'rpc.create_manual_entry',
          format('Manual entry posted: %s lines, %s %s (reason: %s)', v_n_lines, v_sum_dr, p_currency_code, p_reason),
          jsonb_build_object(
            'tx_id', v_tx_id, 'currency', p_currency_code, 'sum', v_sum_dr,
            'reason', p_reason, 'lines', p_lines, 'created_by', auth.uid(), 'role', v_caller_role
          ));

  RETURN v_tx_id;
END $function$;
