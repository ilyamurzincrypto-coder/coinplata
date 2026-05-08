-- Direction 2 — ШАГ 2.2: ledger.update_tx_metadata
--
-- Whitelist/blocked patch для transactions.metadata.
-- ALLOWED  exact: tx_hash, external_ref, note, comment, notes_history
-- ALLOWED  prefix: manual_*
-- BLOCKED  exact: idempotency_key, bypass_anomaly, deferred_legs,
--                replaces_tx_id, replaced_by_tx_id, update_deal_v2_result,
--                parent_idempotency_key
-- BLOCKED  prefix: _immutable*
-- UNKNOWN: success + audit warn
--
-- Concurrent updates защищены через FOR UPDATE на transaction row.
-- Reversed transactions могут получать metadata patches (audit purpose).
-- notes_history — special-case array append (jsonb || для arrays concat).

CREATE OR REPLACE FUNCTION ledger.update_tx_metadata(
  p_idempotency_key uuid,
  p_request_hash text,
  p_tx_id uuid,
  p_patch jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_existing record;
  v_current_metadata jsonb;
  v_new_metadata jsonb;
  v_key text;
  v_unknown_keys text[] := ARRAY[]::text[];
  v_patch_keys text[] := ARRAY[]::text[];
  v_blocked_exact text[] := ARRAY[
    'idempotency_key', 'bypass_anomaly', 'deferred_legs',
    'replaces_tx_id', 'replaced_by_tx_id', 'update_deal_v2_result',
    'parent_idempotency_key'
  ];
  v_allowed_exact text[] := ARRAY[
    'tx_hash', 'external_ref', 'note', 'comment', 'notes_history'
  ];
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
      RETURN;
    END IF;
  END IF;

  -- 2. Validate inputs
  IF p_tx_id IS NULL THEN
    RAISE EXCEPTION 'tx_id required' USING ERRCODE = '22000';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be a JSONB object' USING ERRCODE = '22000';
  END IF;
  IF p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'patch is empty' USING ERRCODE = '22000';
  END IF;

  -- 3. Validate patch keys
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    v_patch_keys := array_append(v_patch_keys, v_key);

    IF v_key = ANY(v_blocked_exact) OR v_key LIKE '\_immutable%' ESCAPE '\' THEN
      INSERT INTO ledger.audit_alerts (level, source, message, payload)
      VALUES ('warn', 'rpc.update_tx_metadata',
              format('Attempted to modify immutable field %s', v_key),
              jsonb_build_object(
                'tx_id', p_tx_id,
                'field_name', v_key,
                'attempted_by', auth.uid()));
      RAISE EXCEPTION 'Field % is immutable in tx metadata', v_key
        USING ERRCODE = '22000',
        DETAIL = 'Allowed fields: tx_hash, external_ref, note, notes_history, comment, manual_*';
    END IF;

    IF v_key = ANY(v_allowed_exact) OR v_key LIKE 'manual\_%' ESCAPE '\' THEN
      IF v_key = 'notes_history' AND jsonb_typeof(p_patch->v_key) <> 'array' THEN
        RAISE EXCEPTION 'notes_history must be a JSONB array' USING ERRCODE = '22000';
      END IF;
      CONTINUE;
    END IF;

    v_unknown_keys := array_append(v_unknown_keys, v_key);
  END LOOP;

  -- 4. Lock target row + apply patch
  SELECT metadata INTO v_current_metadata
    FROM ledger.transactions
   WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % not found', p_tx_id USING ERRCODE = 'P0002';
  END IF;

  v_new_metadata := COALESCE(v_current_metadata, '{}'::jsonb) || p_patch;

  -- Special-case notes_history array append
  IF p_patch ? 'notes_history' AND jsonb_typeof(v_current_metadata->'notes_history') = 'array' THEN
    v_new_metadata := jsonb_set(v_new_metadata, '{notes_history}',
                                v_current_metadata->'notes_history' || (p_patch->'notes_history'));
  END IF;

  UPDATE ledger.transactions
     SET metadata = v_new_metadata
   WHERE id = p_tx_id;

  -- 5. Save idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ledger.idempotency_keys (key, transaction_id, request_hash)
    VALUES (p_idempotency_key, p_tx_id, p_request_hash);
  END IF;

  -- 6. Audit alerts
  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('info', 'rpc.update_tx_metadata',
          'Tx metadata updated',
          jsonb_build_object(
            'tx_id', p_tx_id,
            'patch_keys', to_jsonb(v_patch_keys),
            'updated_by', auth.uid()));

  IF array_length(v_unknown_keys, 1) > 0 THEN
    INSERT INTO ledger.audit_alerts (level, source, message, payload)
    VALUES ('warn', 'rpc.update_tx_metadata',
            format('Unknown metadata key(s) added: %s', array_to_string(v_unknown_keys, ', ')),
            jsonb_build_object(
              'tx_id', p_tx_id,
              'unknown_keys', to_jsonb(v_unknown_keys),
              'updated_by', auth.uid()));
  END IF;
END $function$;

ALTER FUNCTION ledger.update_tx_metadata(uuid, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.update_tx_metadata(uuid, text, uuid, jsonb) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION ledger.update_tx_metadata(uuid, text, uuid, jsonb) TO service_role;
