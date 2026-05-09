-- Extend v_open_deals с computed age_hours + is_stale для widget filters

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
     WHERE leg->>'kind' = 'out') AS pending_out_total,
  EXTRACT(EPOCH FROM (now() - w.created_at)) / 3600 AS age_hours,
  (w.updated_at < now() - INTERVAL '7 days') AS is_stale
FROM operations.deal_workflow w
JOIN ledger.transactions t ON t.id = w.ledger_tx_id
LEFT JOIN public.clients c
  ON c.id = nullif(t.metadata->>'client_id','')::uuid
WHERE w.status IN ('awaiting_payment','awaiting_release','partial')
ORDER BY
  COALESCE(w.due_date, w.created_at) ASC,
  w.created_at ASC;

GRANT SELECT ON operations.v_open_deals TO authenticated;
