-- 2.2 operations.update_workflow_status + 2.3 operations.cancel_workflow

CREATE OR REPLACE FUNCTION operations.update_workflow_status(
  p_workflow_id uuid,
  p_new_status  text,
  p_note        text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = operations, public
AS $function$
DECLARE
  v_current_status text;
  v_allowed boolean := false;
BEGIN
  IF p_workflow_id IS NULL THEN
    RAISE EXCEPTION 'workflow_id required' USING ERRCODE = '22000';
  END IF;
  IF p_new_status NOT IN ('draft','awaiting_payment','awaiting_release','partial','done','cancelled') THEN
    RAISE EXCEPTION 'Invalid new_status: %', p_new_status USING ERRCODE = '22000';
  END IF;

  SELECT status INTO v_current_status
    FROM operations.deal_workflow WHERE id = p_workflow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow % not found', p_workflow_id USING ERRCODE = 'P0002';
  END IF;

  v_allowed := CASE
    WHEN v_current_status = 'draft' AND p_new_status IN ('awaiting_payment','awaiting_release','cancelled') THEN true
    WHEN v_current_status = 'awaiting_payment' AND p_new_status IN ('partial','done','cancelled') THEN true
    WHEN v_current_status = 'awaiting_release' AND p_new_status IN ('partial','done','cancelled') THEN true
    WHEN v_current_status = 'partial' AND p_new_status IN ('done','cancelled') THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid transition: % → %', v_current_status, p_new_status
      USING ERRCODE = '22000',
            HINT = 'done/cancelled are terminal states';
  END IF;

  UPDATE operations.deal_workflow
     SET status = p_new_status,
         closed_at = CASE WHEN p_new_status IN ('done','cancelled') THEN now() ELSE closed_at END
   WHERE id = p_workflow_id;

  INSERT INTO operations.workflow_history
    (workflow_id, prev_status, new_status, changed_by, note)
  VALUES
    (p_workflow_id, v_current_status, p_new_status, auth.uid(), p_note);
END $function$;

ALTER FUNCTION operations.update_workflow_status(uuid, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION operations.update_workflow_status(uuid, text, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION operations.update_workflow_status(uuid, text, text, uuid) TO service_role;


CREATE OR REPLACE FUNCTION operations.cancel_workflow(
  p_workflow_id uuid,
  p_reason      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = operations, public
AS $function$
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required for cancel_workflow' USING ERRCODE = '22000';
  END IF;
  PERFORM operations.update_workflow_status(p_workflow_id, 'cancelled', p_reason);
END $function$;

ALTER FUNCTION operations.cancel_workflow(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION operations.cancel_workflow(uuid, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION operations.cancel_workflow(uuid, text) TO service_role;
