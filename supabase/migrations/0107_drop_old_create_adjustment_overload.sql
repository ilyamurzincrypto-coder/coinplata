-- Drop pre-dim signature so PostgREST always picks the new one (with p_client_id/p_partner_id).
DROP FUNCTION IF EXISTS ledger.create_adjustment(
  uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb
);
