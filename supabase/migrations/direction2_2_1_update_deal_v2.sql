-- Direction 2 — ШАГ 2.1: ledger.update_deal_v2
--
-- Атомарный edit: reverse(target, cascade=true) + create_deal_v2(new_payload).
-- Один statement → одна PG-транзакция → либо обе операции прошли,
-- либо никакая. На любом RAISE из вложенных функций — full ROLLBACK.
--
-- Replay через own idempotency_key: при дубликате с тем же hash возвращает
-- сохранённый result из new_deal_tx.metadata (без повторных reverse/create).
--
-- Метадата cross-links:
--   • target.metadata.replaced_by_tx_id = new_deal_tx_id
--   • new.metadata.replaces_tx_id = target_tx_id
--   • new.metadata.update_deal_v2_result = full TABLE result (для replay)

CREATE OR REPLACE FUNCTION ledger.update_deal_v2(
  p_idempotency_key uuid,
  p_request_hash text,
  p_target_tx_id uuid,
  p_new_payload jsonb,
  p_reason text,
  p_effective_date timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  reversed_tx_ids uuid[],
  new_deal_tx_id uuid,
  new_settle_tx_ids uuid[],
  new_recognition_tx_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_existing record;
  v_target record;
  v_reverse_key uuid;
  v_create_key uuid;
  v_internal_hash text;
  v_reversed_ids uuid[];
  v_create_result record;
  v_replay_result record;
  v_settle_ids uuid[];
  v_recognition_id uuid;
BEGIN
  -- ── 1. Validate inputs ──
  IF p_target_tx_id IS NULL THEN
    RAISE EXCEPTION 'target_tx_id required' USING ERRCODE = '22000';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required for update_deal_v2 (audit-trail)' USING ERRCODE = '22000';
  END IF;
  IF p_new_payload IS NULL OR jsonb_typeof(p_new_payload) <> 'object' THEN
    RAISE EXCEPTION 'new_payload must be a JSONB object' USING ERRCODE = '22000';
  END IF;
  IF p_new_payload->>'client_id'  IS NULL OR
     p_new_payload->>'office_id'  IS NULL OR
     p_new_payload->'in_legs'     IS NULL OR
     p_new_payload->'out_legs'    IS NULL OR
     p_new_payload->'commission'  IS NULL THEN
    RAISE EXCEPTION 'new_payload missing required fields (client_id, office_id, in_legs, out_legs, commission)'
      USING ERRCODE = '22000';
  END IF;

  -- ── 2. Idempotency check (наш ключ) ──
  IF p_idempotency_key IS NOT NULL THEN
    SELECT transaction_id, request_hash INTO v_existing
      FROM ledger.idempotency_keys
     WHERE key = p_idempotency_key AND expires_at > now() FOR UPDATE;
    IF FOUND THEN
      IF v_existing.request_hash <> p_request_hash THEN
        RAISE EXCEPTION 'Idempotency key reused with different payload (key=%)', p_idempotency_key
          USING ERRCODE = 'P0422';
      END IF;
      -- Replay: восстанавливаем сохранённый result из new-deal-tx.metadata
      SELECT
        ((metadata->'update_deal_v2_result'->>'reversed_tx_ids')::jsonb) AS reversed_arr,
        (metadata->'update_deal_v2_result'->>'new_deal_tx_id')::uuid     AS new_id,
        ((metadata->'update_deal_v2_result'->>'new_settle_tx_ids')::jsonb) AS settle_arr,
        nullif(metadata->'update_deal_v2_result'->>'new_recognition_tx_id','')::uuid AS rec_id
      INTO v_replay_result
        FROM ledger.transactions
       WHERE id = v_existing.transaction_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Replay state corrupted: transaction % not found', v_existing.transaction_id
          USING ERRCODE = 'XX000';
      END IF;
      reversed_tx_ids       := ARRAY(SELECT jsonb_array_elements_text(v_replay_result.reversed_arr))::uuid[];
      new_deal_tx_id        := v_replay_result.new_id;
      new_settle_tx_ids     := ARRAY(SELECT jsonb_array_elements_text(v_replay_result.settle_arr))::uuid[];
      new_recognition_tx_id := v_replay_result.rec_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- ── 3. Validate target ──
  SELECT id, source_kind, status INTO v_target
    FROM ledger.transactions WHERE id = p_target_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target transaction % not found', p_target_tx_id USING ERRCODE = 'P0002';
  END IF;
  IF v_target.source_kind <> 'deal' THEN
    RAISE EXCEPTION 'Target % is not a deal (source_kind=%); update_deal_v2 only edits deals',
                    p_target_tx_id, v_target.source_kind USING ERRCODE = '22000';
  END IF;
  IF v_target.status = 'reversed' THEN
    RAISE EXCEPTION 'Cannot update reversed transaction % (status=reversed)', p_target_tx_id
      USING ERRCODE = '22000';
  END IF;

  -- ── 4. Reverse target (cascade=true → settle+recognition тоже) ──
  -- Internal idempotency-keys: random gen, не replay'ятся отдельно
  -- (replay идёт через наш p_idempotency_key, который кеширует весь TABLE).
  v_reverse_key   := gen_random_uuid();
  v_create_key    := gen_random_uuid();
  v_internal_hash := encode(sha256((p_request_hash || ':internal')::bytea), 'hex');

  v_reversed_ids := ledger.reverse_transaction(
    p_idempotency_key => v_reverse_key,
    p_request_hash    => v_internal_hash,
    p_target_tx_id    => p_target_tx_id,
    p_reason          => 'edit:' || p_reason,
    p_cascade         => true,
    p_effective_date  => p_effective_date,
    p_metadata        => jsonb_build_object('update_deal_v2', true,
                                            'parent_idempotency_key', p_idempotency_key)
  );

  -- ── 5. Create новый deal ──
  SELECT * INTO v_create_result
    FROM ledger.create_deal_v2(
      p_idempotency_key => v_create_key,
      p_request_hash    => v_internal_hash,
      p_client_id       => (p_new_payload->>'client_id')::uuid,
      p_office_id       => (p_new_payload->>'office_id')::uuid,
      p_in_legs         => p_new_payload->'in_legs',
      p_out_legs        => p_new_payload->'out_legs',
      p_commission      => p_new_payload->'commission',
      p_effective_date  => p_effective_date,
      p_description     => COALESCE(p_new_payload->>'description', NULL),
      p_metadata        => COALESCE(p_new_payload->'metadata', '{}'::jsonb)
                            || jsonb_build_object(
                                 'replaces_tx_id', p_target_tx_id,
                                 'update_reason', p_reason,
                                 'parent_idempotency_key', p_idempotency_key
                               )
    );

  v_settle_ids     := v_create_result.settle_tx_ids;
  v_recognition_id := v_create_result.recognition_tx_id;

  -- ── 6. Cross-link metadata ──
  UPDATE ledger.transactions
     SET metadata = metadata || jsonb_build_object(
                       'replaced_by_tx_id', v_create_result.deal_tx_id,
                       'update_reason', p_reason
                     )
   WHERE id = p_target_tx_id;

  UPDATE ledger.transactions
     SET metadata = metadata || jsonb_build_object(
                       'update_deal_v2_result',
                       jsonb_build_object(
                         'reversed_tx_ids',  to_jsonb(v_reversed_ids),
                         'new_deal_tx_id',   v_create_result.deal_tx_id,
                         'new_settle_tx_ids', to_jsonb(v_settle_ids),
                         'new_recognition_tx_id', COALESCE(v_recognition_id::text, '')
                       )
                     )
   WHERE id = v_create_result.deal_tx_id;

  -- ── 7. Save own idempotency-key ──
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ledger.idempotency_keys (key, transaction_id, request_hash)
    VALUES (p_idempotency_key, v_create_result.deal_tx_id, p_request_hash);
  END IF;

  -- ── 8. Audit ──
  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('info', 'rpc.update_deal_v2',
          format('Deal %s edited → %s (reversed %s txs)',
                 p_target_tx_id, v_create_result.deal_tx_id, array_length(v_reversed_ids, 1)),
          jsonb_build_object(
            'target_tx_id', p_target_tx_id,
            'new_deal_tx_id', v_create_result.deal_tx_id,
            'reversed_tx_ids', v_reversed_ids,
            'reason', p_reason,
            'created_by', auth.uid()
          ));

  -- ── 9. Return ──
  reversed_tx_ids       := v_reversed_ids;
  new_deal_tx_id        := v_create_result.deal_tx_id;
  new_settle_tx_ids     := v_settle_ids;
  new_recognition_tx_id := v_recognition_id;
  RETURN NEXT;
END $function$;

ALTER FUNCTION ledger.update_deal_v2(uuid, text, uuid, jsonb, text, timestamptz, jsonb) OWNER TO postgres;
