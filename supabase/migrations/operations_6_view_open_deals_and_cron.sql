-- 4) View operations.v_open_deals
CREATE OR REPLACE VIEW operations.v_open_deals AS
SELECT
  w.id, w.status, w.assigned_to, w.notes,
  w.due_date, w.open_legs, w.created_at, w.updated_at,
  w.ledger_tx_id,
  t.created_at AS deal_at,
  t.metadata->>'office_id' AS office_id,
  t.metadata->>'client_id' AS client_id_raw,
  c.nickname AS counterparty_name,
  c.id AS counterparty_id,
  jsonb_array_length(w.open_legs) AS open_count,
  (SELECT COALESCE(SUM((leg->>'amount')::numeric), 0)
     FROM jsonb_array_elements(w.open_legs) leg
     WHERE leg->>'kind' = 'out') AS pending_out_total
FROM operations.deal_workflow w
JOIN ledger.transactions t ON t.id = w.ledger_tx_id
LEFT JOIN public.clients c
  ON c.id = nullif(t.metadata->>'client_id','')::uuid
WHERE w.status IN ('awaiting_payment','awaiting_release','partial')
ORDER BY
  COALESCE(w.due_date, w.created_at) ASC,
  w.created_at ASC;

GRANT SELECT ON operations.v_open_deals TO authenticated;


-- 5) Cron flag stale workflows (>7 days idle)
CREATE OR REPLACE FUNCTION operations.flag_stale_workflows()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = operations, ledger, public
AS $function$
DECLARE
  v_stale_count int;
  v_stale_ids uuid[];
BEGIN
  SELECT count(*), array_agg(id)
    INTO v_stale_count, v_stale_ids
    FROM operations.deal_workflow
    WHERE status NOT IN ('done', 'cancelled')
      AND updated_at < now() - INTERVAL '7 days';

  IF v_stale_count > 0 THEN
    INSERT INTO ledger.audit_alerts (level, source, message, payload)
    VALUES (
      'warn', 'cron.flag_stale_workflows',
      format('Stale workflows detected (count=%s)', v_stale_count),
      jsonb_build_object('count', v_stale_count, 'workflow_ids', v_stale_ids)
    );
  END IF;
END $function$;

ALTER FUNCTION operations.flag_stale_workflows() OWNER TO postgres;

SELECT cron.schedule(
  'operations_flag_stale_workflows',
  '0 3 * * *',
  $cron$SELECT operations.flag_stale_workflows()$cron$
);
