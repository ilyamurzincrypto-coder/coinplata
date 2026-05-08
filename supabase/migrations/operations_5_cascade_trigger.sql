-- Auto-cascade triggers:
-- A) journal_entries INSERT с cr-к-asset в leg_settle tx → close one open_leg
-- B) transactions INSERT с reverses_transaction_id → cancel workflow

CREATE OR REPLACE FUNCTION operations.cascade_ledger_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = operations, ledger, public
AS $function$
DECLARE
  v_tx record;
  v_account record;
  v_workflow_id uuid;
  v_current_open_legs jsonb;
  v_remaining jsonb;
  v_remaining_count int;
  v_parent_deal_tx_id uuid;
  v_matched_idx int;
  v_leg jsonb;
  v_idx int;
  v_prev_status text;
BEGIN
  IF NEW.direction <> 'cr' THEN RETURN NEW; END IF;

  SELECT type, subtype INTO v_account FROM ledger.accounts WHERE id = NEW.account_id;
  IF v_account.type <> 'asset' THEN RETURN NEW; END IF;

  SELECT id, source_kind, source_ref_id INTO v_tx
    FROM ledger.transactions WHERE id = NEW.transaction_id;
  IF v_tx.source_kind <> 'leg_settle' THEN RETURN NEW; END IF;

  BEGIN v_parent_deal_tx_id := v_tx.source_ref_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN NEW; END;
  IF v_parent_deal_tx_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, status, open_legs INTO v_workflow_id, v_prev_status, v_current_open_legs
    FROM operations.deal_workflow WHERE ledger_tx_id = v_parent_deal_tx_id LIMIT 1;
  IF v_workflow_id IS NULL THEN RETURN NEW; END IF;

  v_matched_idx := NULL;
  v_idx := 0;
  FOR v_leg IN SELECT value FROM jsonb_array_elements(v_current_open_legs) LOOP
    IF v_leg->>'currency' = NEW.currency_code
       AND (v_leg->>'amount')::numeric = NEW.amount
       AND COALESCE(v_leg->>'kind', 'out') = 'out'
       AND v_matched_idx IS NULL THEN
      v_matched_idx := v_idx;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  IF v_matched_idx IS NULL THEN
    INSERT INTO ledger.audit_alerts (level, source, message, payload)
    VALUES ('info', 'cascade_ledger_settle',
            format('No matching open_leg for settle (deal %s, %s %s)',
                   v_parent_deal_tx_id, NEW.amount, NEW.currency_code),
            jsonb_build_object('settle_tx_id', NEW.transaction_id,
                               'workflow_id', v_workflow_id));
    RETURN NEW;
  END IF;

  SELECT jsonb_agg(elem) INTO v_remaining
    FROM (
      SELECT elem FROM jsonb_array_elements(v_current_open_legs)
        WITH ORDINALITY AS t(elem, ord)
      WHERE ord - 1 <> v_matched_idx
    ) s;
  IF v_remaining IS NULL THEN v_remaining := '[]'::jsonb; END IF;
  v_remaining_count := jsonb_array_length(v_remaining);

  IF v_remaining_count = 0 THEN
    UPDATE operations.deal_workflow
      SET status = 'done', open_legs = '[]'::jsonb, closed_at = now()
      WHERE id = v_workflow_id;
    INSERT INTO operations.workflow_history (workflow_id, prev_status, new_status, note)
    VALUES (v_workflow_id, v_prev_status, 'done',
            format('Auto-closed: all legs settled (last %s %s)', NEW.amount, NEW.currency_code));
  ELSE
    IF v_prev_status NOT IN ('partial','done','cancelled') THEN
      UPDATE operations.deal_workflow
        SET status = 'partial', open_legs = v_remaining
        WHERE id = v_workflow_id;
      INSERT INTO operations.workflow_history (workflow_id, prev_status, new_status, note)
      VALUES (v_workflow_id, v_prev_status, 'partial',
              format('Leg %s %s settled, %s remaining', NEW.amount, NEW.currency_code, v_remaining_count));
    ELSE
      UPDATE operations.deal_workflow SET open_legs = v_remaining WHERE id = v_workflow_id;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

ALTER FUNCTION operations.cascade_ledger_settle() OWNER TO postgres;

CREATE TRIGGER cascade_ledger_settle_trg
  AFTER INSERT ON ledger.journal_entries
  FOR EACH ROW EXECUTE FUNCTION operations.cascade_ledger_settle();


CREATE OR REPLACE FUNCTION operations.cascade_ledger_reversal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = operations, ledger, public
AS $function$
DECLARE
  v_workflow_id uuid;
  v_prev_status text;
BEGIN
  IF NEW.reverses_transaction_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, status INTO v_workflow_id, v_prev_status
    FROM operations.deal_workflow
    WHERE ledger_tx_id = NEW.reverses_transaction_id
      AND status NOT IN ('done', 'cancelled')
    LIMIT 1;
  IF v_workflow_id IS NULL THEN RETURN NEW; END IF;

  UPDATE operations.deal_workflow
    SET status = 'cancelled', closed_at = now(),
        metadata = metadata || jsonb_build_object('cancelled_by_reversal_tx', NEW.id::text)
    WHERE id = v_workflow_id;
  INSERT INTO operations.workflow_history (workflow_id, prev_status, new_status, note)
  VALUES (v_workflow_id, v_prev_status, 'cancelled',
          format('Auto-cancelled: ledger reversal %s', NEW.id));

  RETURN NEW;
END $function$;

ALTER FUNCTION operations.cascade_ledger_reversal() OWNER TO postgres;

CREATE TRIGGER cascade_ledger_reversal_trg
  AFTER INSERT ON ledger.transactions
  FOR EACH ROW EXECUTE FUNCTION operations.cascade_ledger_reversal();
