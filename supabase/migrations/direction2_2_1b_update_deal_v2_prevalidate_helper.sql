-- Direction 2 — ШАГ 2.1b — patch update_deal_v2:
--   C1: extracted helper validate_create_deal_payload вызывается ДО reverse.
--       Структурные ошибки (FK, currency mismatch, missing account, invalid
--       source/destination) ловятся ДО reverse_transaction → target stays posted.
--   C2: подвызовы reverse_transaction + create_deal_v2 вызываются с
--       p_idempotency_key=NULL. Replay-protection обеспечивает родительский
--       update_deal_v2 через result-cache в new_deal.metadata.
--
-- Балансовые проверки НЕ делаются в pre-validate — модель permissive overdraft
-- (Customer Liab.allow_negative=true). Negative balance → audit alert info-level.

CREATE OR REPLACE FUNCTION ledger.validate_create_deal_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ledger, public
AS $function$
DECLARE
  v_in_leg jsonb;
  v_out_leg jsonb;
  v_comm jsonb;
  v_acc record;
  v_out_currencies text[];
  v_dup_check int;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSONB object' USING ERRCODE = '22000';
  END IF;
  IF p_payload->>'client_id' IS NULL OR p_payload->>'office_id' IS NULL THEN
    RAISE EXCEPTION 'payload requires client_id, office_id' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_payload->'in_legs') <> 'array' OR jsonb_array_length(p_payload->'in_legs') = 0 THEN
    RAISE EXCEPTION 'in_legs must be non-empty array' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_payload->'out_legs') <> 'array' OR jsonb_array_length(p_payload->'out_legs') = 0 THEN
    RAISE EXCEPTION 'out_legs must be non-empty array' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_payload->'commission') <> 'array' OR jsonb_array_length(p_payload->'commission') = 0 THEN
    RAISE EXCEPTION 'commission must be non-empty array' USING ERRCODE = '22000';
  END IF;

  -- in_legs
  FOR v_in_leg IN SELECT * FROM jsonb_array_elements(p_payload->'in_legs') LOOP
    IF (v_in_leg->>'amount')::numeric IS NULL OR (v_in_leg->>'amount')::numeric <= 0 THEN
      RAISE EXCEPTION 'IN leg amount must be > 0' USING ERRCODE = '22000';
    END IF;
    IF (v_in_leg->>'currency') IS NULL THEN
      RAISE EXCEPTION 'IN leg currency required' USING ERRCODE = '22000';
    END IF;
    IF (v_in_leg->>'source') NOT IN ('fresh', 'from_balance') THEN
      RAISE EXCEPTION 'IN.source must be fresh|from_balance (got %)', v_in_leg->>'source' USING ERRCODE = '22000';
    END IF;
    IF (v_in_leg->>'source') = 'fresh' THEN
      IF v_in_leg->>'account_code' IS NULL OR v_in_leg->>'account_code' = '' THEN
        RAISE EXCEPTION 'fresh source requires account_code' USING ERRCODE = '22000';
      END IF;
      SELECT code, currency_code INTO v_acc FROM ledger.accounts
        WHERE code = (v_in_leg->>'account_code')::text AND active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'IN account % not found', v_in_leg->>'account_code' USING ERRCODE = 'P0002';
      END IF;
      IF v_acc.currency_code <> (v_in_leg->>'currency')::text THEN
        RAISE EXCEPTION 'IN account % currency (%) does not match leg currency (%)',
          v_acc.code, v_acc.currency_code, v_in_leg->>'currency' USING ERRCODE = '22000';
      END IF;
    END IF;
    IF (v_in_leg->>'source') = 'from_balance' THEN
      PERFORM 1 FROM ledger.accounts
        WHERE subtype='customer_liab' AND currency_code = (v_in_leg->>'currency')::text AND active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer Liab for currency % not found (required for from_balance)',
          v_in_leg->>'currency' USING ERRCODE = 'P0002';
      END IF;
    END IF;
  END LOOP;

  -- out_legs
  FOR v_out_leg IN SELECT * FROM jsonb_array_elements(p_payload->'out_legs') LOOP
    IF (v_out_leg->>'amount')::numeric IS NULL OR (v_out_leg->>'amount')::numeric <= 0 THEN
      RAISE EXCEPTION 'OUT leg amount must be > 0' USING ERRCODE = '22000';
    END IF;
    IF (v_out_leg->>'currency') IS NULL THEN
      RAISE EXCEPTION 'OUT leg currency required' USING ERRCODE = '22000';
    END IF;
    IF (v_out_leg->>'destination') NOT IN ('physical','to_balance') THEN
      RAISE EXCEPTION 'OUT.destination must be physical|to_balance (got %)',
        v_out_leg->>'destination' USING ERRCODE = '22000';
    END IF;
    IF (v_out_leg->>'destination') = 'to_balance'
       AND COALESCE((v_out_leg->>'deferred')::boolean, false) = true THEN
      RAISE EXCEPTION 'to_balance is inherently immediate, deferred=true not allowed' USING ERRCODE = '22000';
    END IF;
    IF (v_out_leg->>'destination') = 'physical' THEN
      IF v_out_leg->>'account_code' IS NULL OR v_out_leg->>'account_code' = '' THEN
        RAISE EXCEPTION 'physical destination requires account_code' USING ERRCODE = '22000';
      END IF;
      SELECT code, currency_code INTO v_acc FROM ledger.accounts
        WHERE code = (v_out_leg->>'account_code')::text AND active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OUT account % not found', v_out_leg->>'account_code' USING ERRCODE = 'P0002';
      END IF;
      IF v_acc.currency_code <> (v_out_leg->>'currency')::text THEN
        RAISE EXCEPTION 'OUT account % currency (%) does not match leg currency (%)',
          v_acc.code, v_acc.currency_code, v_out_leg->>'currency' USING ERRCODE = '22000';
      END IF;
    END IF;
  END LOOP;

  -- commission
  SELECT array_agg(DISTINCT (leg->>'currency')::text) INTO v_out_currencies
    FROM jsonb_array_elements(p_payload->'out_legs') AS leg;
  SELECT count(*) INTO v_dup_check FROM (
    SELECT (c->>'currency')::text AS cur FROM jsonb_array_elements(p_payload->'commission') AS c
    GROUP BY (c->>'currency')::text HAVING count(*) > 1
  ) sub;
  IF v_dup_check > 0 THEN
    RAISE EXCEPTION 'Duplicate currency in commission array' USING ERRCODE = '22000';
  END IF;
  FOR v_comm IN SELECT * FROM jsonb_array_elements(p_payload->'commission') LOOP
    IF (v_comm->>'amount')::numeric <= 0 THEN
      RAISE EXCEPTION 'commission.amount must be > 0' USING ERRCODE = '22000';
    END IF;
    IF NOT ((v_comm->>'currency')::text = ANY(v_out_currencies)) THEN
      RAISE EXCEPTION 'Commission currency % not present in OUT legs', v_comm->>'currency'
        USING ERRCODE = '22000';
    END IF;
  END LOOP;
END $function$;

ALTER FUNCTION ledger.validate_create_deal_payload(jsonb) OWNER TO postgres;


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
  v_reversed_ids uuid[];
  v_create_result record;
  v_replay_result record;
  v_settle_ids uuid[];
  v_recognition_id uuid;
BEGIN
  -- 1. Idempotency lookup (cached replay)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT transaction_id, request_hash INTO v_existing
      FROM ledger.idempotency_keys
     WHERE key = p_idempotency_key AND expires_at > now() FOR UPDATE;
    IF FOUND THEN
      IF v_existing.request_hash <> p_request_hash THEN
        RAISE EXCEPTION 'Idempotency key reused with different payload (key=%)', p_idempotency_key
          USING ERRCODE = 'P0422';
      END IF;
      SELECT
        ((metadata->'update_deal_v2_result'->>'reversed_tx_ids')::jsonb) AS reversed_arr,
        (metadata->'update_deal_v2_result'->>'new_deal_tx_id')::uuid AS new_id,
        ((metadata->'update_deal_v2_result'->>'new_settle_tx_ids')::jsonb) AS settle_arr,
        nullif(metadata->'update_deal_v2_result'->>'new_recognition_tx_id','')::uuid AS rec_id
      INTO v_replay_result FROM ledger.transactions WHERE id = v_existing.transaction_id;
      reversed_tx_ids       := ARRAY(SELECT jsonb_array_elements_text(v_replay_result.reversed_arr))::uuid[];
      new_deal_tx_id        := v_replay_result.new_id;
      new_settle_tx_ids     := ARRAY(SELECT jsonb_array_elements_text(v_replay_result.settle_arr))::uuid[];
      new_recognition_tx_id := v_replay_result.rec_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- 2. Validate target
  IF p_target_tx_id IS NULL THEN
    RAISE EXCEPTION 'target_tx_id required' USING ERRCODE = '22000';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required for update_deal_v2 (audit-trail)' USING ERRCODE = '22000';
  END IF;

  SELECT id, source_kind, status INTO v_target
    FROM ledger.transactions WHERE id = p_target_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target transaction % not found', p_target_tx_id USING ERRCODE = 'P0002';
  END IF;
  IF v_target.source_kind <> 'deal' THEN
    RAISE EXCEPTION 'Target % is not a deal (source_kind=%)',
                    p_target_tx_id, v_target.source_kind USING ERRCODE = '22000';
  END IF;
  IF v_target.status = 'reversed' THEN
    RAISE EXCEPTION 'Cannot update reversed transaction %', p_target_tx_id USING ERRCODE = '22000';
  END IF;

  -- 3. Pre-validate new_payload (C1)
  PERFORM ledger.validate_create_deal_payload(p_new_payload);

  -- 4. Reverse target (NULL idempotency, C2)
  v_reversed_ids := ledger.reverse_transaction(
    p_idempotency_key => NULL,
    p_request_hash    => 'update_deal_v2:reverse:' || p_target_tx_id::text,
    p_target_tx_id    => p_target_tx_id,
    p_reason          => 'edit:' || p_reason,
    p_cascade         => true,
    p_effective_date  => p_effective_date,
    p_metadata        => jsonb_build_object('update_deal_v2', true,
                                            'parent_idempotency_key', p_idempotency_key)
  );

  -- 5. Create new (NULL idempotency, C2)
  SELECT * INTO v_create_result
    FROM ledger.create_deal_v2(
      p_idempotency_key => NULL,
      p_request_hash    => 'update_deal_v2:create:' || p_target_tx_id::text,
      p_client_id       => (p_new_payload->>'client_id')::uuid,
      p_office_id       => (p_new_payload->>'office_id')::uuid,
      p_in_legs         => p_new_payload->'in_legs',
      p_out_legs        => p_new_payload->'out_legs',
      p_commission      => p_new_payload->'commission',
      p_effective_date  => p_effective_date,
      p_description     => p_new_payload->>'description',
      p_metadata        => COALESCE(p_new_payload->'metadata', '{}'::jsonb)
                            || jsonb_build_object(
                                 'replaces_tx_id', p_target_tx_id,
                                 'update_reason', p_reason,
                                 'parent_idempotency_key', p_idempotency_key
                               )
    );
  v_settle_ids     := v_create_result.settle_tx_ids;
  v_recognition_id := v_create_result.recognition_tx_id;

  -- 6. Cross-link metadata
  UPDATE ledger.transactions
     SET metadata = metadata || jsonb_build_object(
                       'replaced_by_tx_id', v_create_result.deal_tx_id,
                       'update_reason', p_reason)
   WHERE id = p_target_tx_id;

  UPDATE ledger.transactions
     SET metadata = metadata || jsonb_build_object(
                       'update_deal_v2_result',
                       jsonb_build_object(
                         'reversed_tx_ids',  to_jsonb(v_reversed_ids),
                         'new_deal_tx_id',   v_create_result.deal_tx_id,
                         'new_settle_tx_ids', to_jsonb(v_settle_ids),
                         'new_recognition_tx_id', COALESCE(v_recognition_id::text, '')))
   WHERE id = v_create_result.deal_tx_id;

  -- 7. Save own idempotency
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ledger.idempotency_keys (key, transaction_id, request_hash)
    VALUES (p_idempotency_key, v_create_result.deal_tx_id, p_request_hash);
  END IF;

  -- 8. Audit
  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('info', 'rpc.update_deal_v2',
          format('Deal %s edited → %s (reversed %s txs)',
                 p_target_tx_id, v_create_result.deal_tx_id, array_length(v_reversed_ids, 1)),
          jsonb_build_object('target_tx_id', p_target_tx_id,
                             'new_deal_tx_id', v_create_result.deal_tx_id,
                             'reversed_tx_ids', v_reversed_ids,
                             'reason', p_reason, 'created_by', auth.uid()));

  reversed_tx_ids       := v_reversed_ids;
  new_deal_tx_id        := v_create_result.deal_tx_id;
  new_settle_tx_ids     := v_settle_ids;
  new_recognition_tx_id := v_recognition_id;
  RETURN NEXT;
END $function$;
