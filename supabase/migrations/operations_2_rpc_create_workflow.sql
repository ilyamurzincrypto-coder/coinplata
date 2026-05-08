-- 2.1 operations.create_workflow

CREATE OR REPLACE FUNCTION operations.create_workflow(
  p_ledger_tx_id   uuid,
  p_initial_status text DEFAULT 'awaiting_release',
  p_open_legs      jsonb DEFAULT '[]'::jsonb,
  p_notes          text DEFAULT NULL,
  p_assigned_to    uuid DEFAULT NULL,
  p_due_date       timestamptz DEFAULT NULL,
  p_metadata       jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = operations, ledger, public
AS $function$
DECLARE
  v_workflow_id uuid;
BEGIN
  IF p_ledger_tx_id IS NULL THEN
    RAISE EXCEPTION 'ledger_tx_id required' USING ERRCODE = '22000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ledger.transactions WHERE id = p_ledger_tx_id) THEN
    RAISE EXCEPTION 'ledger transaction % not found', p_ledger_tx_id USING ERRCODE = 'P0002';
  END IF;
  IF p_initial_status NOT IN ('draft','awaiting_payment','awaiting_release','partial','done','cancelled') THEN
    RAISE EXCEPTION 'Invalid initial_status: %', p_initial_status USING ERRCODE = '22000';
  END IF;
  IF p_open_legs IS NULL OR jsonb_typeof(p_open_legs) <> 'array' THEN
    RAISE EXCEPTION 'open_legs must be a JSONB array' USING ERRCODE = '22000';
  END IF;

  v_workflow_id := gen_random_uuid();

  INSERT INTO operations.deal_workflow
    (id, ledger_tx_id, status, open_legs, notes, assigned_to, due_date, metadata)
  VALUES
    (v_workflow_id, p_ledger_tx_id, p_initial_status, p_open_legs,
     p_notes, p_assigned_to, p_due_date, COALESCE(p_metadata, '{}'::jsonb));

  INSERT INTO operations.workflow_history
    (workflow_id, prev_status, new_status, changed_by, note)
  VALUES
    (v_workflow_id, NULL, p_initial_status, auth.uid(), 'Workflow created');

  RETURN v_workflow_id;
END $function$;

ALTER FUNCTION operations.create_workflow(uuid, text, jsonb, text, uuid, timestamptz, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION operations.create_workflow(uuid, text, jsonb, text, uuid, timestamptz, jsonb)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION operations.create_workflow(uuid, text, jsonb, text, uuid, timestamptz, jsonb)
  TO service_role;
