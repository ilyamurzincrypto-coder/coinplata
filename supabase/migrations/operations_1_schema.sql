-- Operations Workflow Layer — Schema migration
--
-- Two-layer model:
--   Layer 1 (existing): ledger.transactions — immutable, double-entry,
--                       status: posted | reversed
--   Layer 2 (new):       operations.deal_workflow — mutable, операционный
--                       state для менеджеров. Связь via ledger_tx_id.

CREATE SCHEMA IF NOT EXISTS operations;

CREATE OR REPLACE FUNCTION operations.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TABLE operations.deal_workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_tx_id uuid NOT NULL REFERENCES ledger.transactions(id),
  status text NOT NULL CHECK (status IN (
    'draft', 'awaiting_payment', 'awaiting_release',
    'partial', 'done', 'cancelled'
  )),
  open_legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  assigned_to uuid REFERENCES auth.users(id),
  due_date timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX deal_workflow_status_idx ON operations.deal_workflow(status)
  WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX deal_workflow_assigned_idx ON operations.deal_workflow(assigned_to)
  WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX deal_workflow_due_idx ON operations.deal_workflow(due_date)
  WHERE due_date IS NOT NULL AND status NOT IN ('done', 'cancelled');
CREATE INDEX deal_workflow_ledger_tx_idx ON operations.deal_workflow(ledger_tx_id);

CREATE TRIGGER deal_workflow_updated_at
  BEFORE UPDATE ON operations.deal_workflow
  FOR EACH ROW EXECUTE FUNCTION operations.set_updated_at();

ALTER TABLE operations.deal_workflow ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_authenticated_read ON operations.deal_workflow
  FOR SELECT TO authenticated USING (true);
CREATE POLICY workflow_admin_write ON operations.deal_workflow
  FOR ALL TO service_role USING (true);

CREATE TABLE operations.workflow_history (
  id bigserial PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES operations.deal_workflow(id),
  prev_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  note text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_history_id_idx
  ON operations.workflow_history(workflow_id, changed_at DESC);

ALTER TABLE operations.workflow_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_history_read ON operations.workflow_history
  FOR SELECT TO authenticated USING (true);

GRANT USAGE ON SCHEMA operations TO authenticated, service_role;
GRANT SELECT ON operations.deal_workflow, operations.workflow_history TO authenticated;
