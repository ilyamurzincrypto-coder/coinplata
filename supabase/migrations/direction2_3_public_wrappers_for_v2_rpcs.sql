-- direction2_3_public_wrappers_for_v2_rpcs
--
-- ROOT CAUSE FIX for production "0 deals in ledger.transactions":
-- PostgREST exposes only `public, graphql_public` schemas. Frontend calls
-- `supabase.rpc("create_deal_v2", ...)` (no schema prefix), which routes to
-- public.create_deal_v2. That function did not exist → PGRST202 error → form
-- crashed silently → managers stopped using v2 → cutover stalled.
--
-- Verified failure via direct curl 2026-05-09:
--   POST /rest/v1/rpc/create_deal_v2 →
--   {"code":"PGRST202","message":"Could not find the function public.create_deal_v2"}
--
-- This migration creates 14 thin SECURITY DEFINER wrappers in `public` that
-- forward straight to the real implementations in `ledger` / `operations`.
-- No business logic here. All permission/RLS/idempotency/audit checks remain
-- in the wrapped functions.
--
-- Reversibility: each wrapper can be DROP-ed independently. Underlying
-- ledger.* / operations.* functions are not touched.
--
-- Naming collision note: public.create_transfer already exists with a legacy
-- signature (p_from_account_id, p_to_account_id, …). The new wrapper uses
-- the v2 signature (p_idempotency_key, p_request_hash, …). Postgres function
-- overloading allows both — PostgREST dispatches by named parameters, so the
-- two never collide on actual calls.

BEGIN;

-- ─── ledger.create_deal_v2 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_deal_v2(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_client_id       uuid,
  p_office_id       uuid,
  p_in_legs         jsonb,
  p_out_legs        jsonb,
  p_commission      jsonb,
  p_effective_date  timestamptz DEFAULT now(),
  p_description     text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(deal_tx_id uuid, settle_tx_ids uuid[], recognition_tx_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM ledger.create_deal_v2(
    p_idempotency_key, p_request_hash, p_client_id, p_office_id,
    p_in_legs, p_out_legs, p_commission, p_effective_date, p_description, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_deal_v2(uuid, text, uuid, uuid, jsonb, jsonb, jsonb, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_deal_v2(uuid, text, uuid, uuid, jsonb, jsonb, jsonb, timestamptz, text, jsonb) TO anon, authenticated;

-- ─── ledger.create_topup ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_topup(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_client_id       uuid,
  p_account_code    text,
  p_amount          numeric,
  p_currency_code   text,
  p_effective_date  timestamptz DEFAULT now(),
  p_description     text DEFAULT 'Customer topup',
  p_external_ref    text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.create_topup(
    p_idempotency_key, p_request_hash, p_client_id, p_account_code,
    p_amount, p_currency_code, p_effective_date, p_description,
    p_external_ref, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_topup(uuid, text, uuid, text, numeric, text, timestamptz, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_topup(uuid, text, uuid, text, numeric, text, timestamptz, text, text, jsonb) TO anon, authenticated;

-- ─── ledger.create_withdrawal ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_withdrawal(
  p_idempotency_key   uuid,
  p_request_hash      text,
  p_client_id         uuid,
  p_currency_code     text,
  p_amount            numeric,
  p_destination_account text,
  p_network_fee       jsonb DEFAULT NULL,
  p_external_ref      text DEFAULT NULL,
  p_effective_date    timestamptz DEFAULT now(),
  p_description       text DEFAULT 'Customer withdrawal',
  p_metadata          jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.create_withdrawal(
    p_idempotency_key, p_request_hash, p_client_id, p_currency_code,
    p_amount, p_destination_account, p_network_fee, p_external_ref,
    p_effective_date, p_description, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_withdrawal(uuid, text, uuid, text, numeric, text, jsonb, text, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_withdrawal(uuid, text, uuid, text, numeric, text, jsonb, text, timestamptz, text, jsonb) TO anon, authenticated;

-- ─── ledger.create_transfer (v2 — overloads existing legacy public.create_transfer) ──
CREATE OR REPLACE FUNCTION public.create_transfer(
  p_idempotency_key   uuid,
  p_request_hash      text,
  p_from_account_code text,
  p_to_account_code   text,
  p_amount            numeric,
  p_currency_code     text,
  p_fee               jsonb DEFAULT NULL,
  p_effective_date    timestamptz DEFAULT now(),
  p_description       text DEFAULT 'Internal transfer',
  p_metadata          jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.create_transfer(
    p_idempotency_key, p_request_hash, p_from_account_code, p_to_account_code,
    p_amount, p_currency_code, p_fee, p_effective_date, p_description, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_transfer(uuid, text, text, text, numeric, text, jsonb, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, text, text, text, numeric, text, jsonb, timestamptz, text, jsonb) TO anon, authenticated;

-- ─── ledger.create_adjustment ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_adjustment(
  p_idempotency_key  uuid,
  p_request_hash     text,
  p_account_code     text,
  p_amount           numeric,
  p_currency_code    text,
  p_reason           text,
  p_adjustment_kind  text,
  p_balancing_account text DEFAULT NULL,
  p_effective_date   timestamptz DEFAULT now(),
  p_metadata         jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.create_adjustment(
    p_idempotency_key, p_request_hash, p_account_code, p_amount,
    p_currency_code, p_reason, p_adjustment_kind, p_balancing_account,
    p_effective_date, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_adjustment(uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb) FROM PUBLIC;
-- Underlying ledger.create_adjustment is service_role-only (no anon/auth grant). Keep parity:
GRANT EXECUTE ON FUNCTION public.create_adjustment(uuid, text, text, numeric, text, text, text, text, timestamptz, jsonb) TO service_role;

-- ─── ledger.complete_deal_leg ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_deal_leg(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_deal_id         uuid,
  p_currency_code   text,
  p_amount          numeric,
  p_account_code    text,
  p_effective_date  timestamptz DEFAULT now(),
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(settle_tx_id uuid, recognition_tx_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM ledger.complete_deal_leg(
    p_idempotency_key, p_request_hash, p_deal_id, p_currency_code,
    p_amount, p_account_code, p_effective_date, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.complete_deal_leg(uuid, text, uuid, text, numeric, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_deal_leg(uuid, text, uuid, text, numeric, text, timestamptz, jsonb) TO anon, authenticated;

-- ─── ledger.create_reservation ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_reservation(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_source_account  text,
  p_amount          numeric,
  p_currency_code   text,
  p_purpose_ref     text,
  p_effective_date  timestamptz DEFAULT now(),
  p_description     text DEFAULT 'Reservation hold',
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.create_reservation(
    p_idempotency_key, p_request_hash, p_source_account, p_amount,
    p_currency_code, p_purpose_ref, p_effective_date, p_description, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_reservation(uuid, text, text, numeric, text, text, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, numeric, text, text, timestamptz, text, jsonb) TO anon, authenticated;

-- ─── ledger.release_reservation ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_reservation(
  p_idempotency_key   uuid,
  p_request_hash      text,
  p_reservation_tx_id uuid,
  p_effective_date    timestamptz DEFAULT now(),
  p_description       text DEFAULT 'Reservation release',
  p_metadata          jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.release_reservation(
    p_idempotency_key, p_request_hash, p_reservation_tx_id,
    p_effective_date, p_description, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.release_reservation(uuid, text, uuid, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_reservation(uuid, text, uuid, timestamptz, text, jsonb) TO anon, authenticated;

-- ─── ledger.reverse_transaction ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_transaction(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_target_tx_id    uuid,
  p_reason          text,
  p_cascade         boolean DEFAULT true,
  p_effective_date  timestamptz DEFAULT now(),
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.reverse_transaction(
    p_idempotency_key, p_request_hash, p_target_tx_id, p_reason,
    p_cascade, p_effective_date, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.reverse_transaction(uuid, text, uuid, text, boolean, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_transaction(uuid, text, uuid, text, boolean, timestamptz, jsonb) TO anon, authenticated;

-- ─── ledger.update_deal_v2 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_deal_v2(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_target_tx_id    uuid,
  p_new_payload     jsonb,
  p_reason          text,
  p_effective_date  timestamptz DEFAULT now(),
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(reversed_tx_ids uuid[], new_deal_tx_id uuid, new_settle_tx_ids uuid[], new_recognition_tx_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM ledger.update_deal_v2(
    p_idempotency_key, p_request_hash, p_target_tx_id, p_new_payload,
    p_reason, p_effective_date, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.update_deal_v2(uuid, text, uuid, jsonb, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_deal_v2(uuid, text, uuid, jsonb, text, timestamptz, jsonb) TO anon, authenticated;

-- ─── ledger.update_tx_metadata ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_tx_metadata(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_tx_id           uuid,
  p_patch           jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.update_tx_metadata(p_idempotency_key, p_request_hash, p_tx_id, p_patch);
$$;

REVOKE ALL ON FUNCTION public.update_tx_metadata(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tx_metadata(uuid, text, uuid, jsonb) TO anon, authenticated;

-- ─── operations.create_workflow ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_workflow(
  p_ledger_tx_id    uuid,
  p_initial_status  text DEFAULT 'awaiting_release',
  p_open_legs       jsonb DEFAULT '[]'::jsonb,
  p_notes           text DEFAULT NULL,
  p_assigned_to     uuid DEFAULT NULL,
  p_due_date        timestamptz DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT operations.create_workflow(
    p_ledger_tx_id, p_initial_status, p_open_legs, p_notes,
    p_assigned_to, p_due_date, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_workflow(uuid, text, jsonb, text, uuid, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workflow(uuid, text, jsonb, text, uuid, timestamptz, jsonb) TO anon, authenticated;

-- ─── operations.update_workflow_status ──────────────────────────────
CREATE OR REPLACE FUNCTION public.update_workflow_status(
  p_workflow_id     uuid,
  p_new_status      text,
  p_note            text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT operations.update_workflow_status(p_workflow_id, p_new_status, p_note, p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION public.update_workflow_status(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_workflow_status(uuid, text, text, uuid) TO anon, authenticated;

-- ─── operations.cancel_workflow ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_workflow(
  p_workflow_id uuid,
  p_reason      text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT operations.cancel_workflow(p_workflow_id, p_reason);
$$;

REVOKE ALL ON FUNCTION public.cancel_workflow(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_workflow(uuid, text) TO anon, authenticated;

COMMIT;

-- Smoke: 13 user-facing wrappers + 1 service-role-only (create_adjustment) = 14 total.
-- Assert they exist:
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_deal_v2','create_topup','create_withdrawal','create_transfer',
      'create_adjustment','complete_deal_leg','create_reservation',
      'release_reservation','reverse_transaction','update_deal_v2',
      'update_tx_metadata','create_workflow','update_workflow_status','cancel_workflow'
    );
  IF cnt < 14 THEN
    RAISE EXCEPTION 'Expected 14 wrapper functions in public schema, found %', cnt;
  END IF;
END $$;
