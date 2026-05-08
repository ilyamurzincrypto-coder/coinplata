-- Cutover Direction 1 — opening transaction + verification + legacy freeze
--
-- Применяется до cutover-day. Содержит 3 SECURITY DEFINER функции в схеме `ledger`:
--   • ledger.create_opening_from_inventory(...) — генератор opening tx из physical inventory JSONB
--   • ledger.verify_opening(p_opening_tx_id)    — TABLE с 2 проверками
--   • ledger.freeze_legacy_tables()             — REVOKE на 7 legacy public.* таблицах
--
-- См. docs/CUTOVER_RUNBOOK.md для пошагового сценария.

-- ════════════════════════════════════════════════════════════════════════
-- 1. ledger.create_opening_from_inventory
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ledger.create_opening_from_inventory(
  p_inventory      jsonb,
  p_effective_date timestamptz DEFAULT now(),
  p_description    text        DEFAULT 'Cutover opening from physical inventory',
  p_metadata       jsonb       DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_tx_id uuid;
  v_metadata_full jsonb;
  rec record;
  v_account record;
  v_amount numeric;
  v_client_id uuid;
  v_partner_id uuid;
  v_dr boolean;
  v_currency_net record;
  v_opening_acc_id uuid;
BEGIN
  IF jsonb_typeof(p_inventory) <> 'array' OR jsonb_array_length(p_inventory) = 0 THEN
    RAISE EXCEPTION 'p_inventory must be a non-empty JSONB array' USING ERRCODE = '22000';
  END IF;

  v_tx_id := gen_random_uuid();
  v_metadata_full := p_metadata || jsonb_build_object(
    'bypass_zero_floor', true,
    'bypass_anomaly', true,
    'cutover_inventory_count', jsonb_array_length(p_inventory)
  );

  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description,
     source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, NULL, p_effective_date, auth.uid(),
          p_description, 'opening', NULL, v_metadata_full);

  -- ── Phase 1: записываем все inventory rows как entries ──
  FOR rec IN SELECT * FROM jsonb_array_elements(p_inventory) AS inv
  LOOP
    SELECT id, code, name, type, subtype, currency_code,
           client_dim_required, partner_dim_required
      INTO v_account
      FROM ledger.accounts WHERE code = (rec.value->>'account_code')::text AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account % not found in chart of accounts', rec.value->>'account_code'
        USING ERRCODE = 'P0002';
    END IF;

    v_amount := (rec.value->>'amount')::numeric;
    IF v_amount = 0 THEN
      CONTINUE;  -- skip zero entries
    END IF;

    v_client_id  := nullif(rec.value->>'client_id', '')::uuid;
    v_partner_id := nullif(rec.value->>'partner_id', '')::uuid;

    -- Validate dim_required
    IF v_account.client_dim_required AND v_client_id IS NULL THEN
      RAISE EXCEPTION 'Account % requires client_id (got NULL)', v_account.code
        USING ERRCODE = '23502';
    END IF;
    IF v_account.partner_dim_required AND v_partner_id IS NULL THEN
      RAISE EXCEPTION 'Account % requires partner_id (got NULL)', v_account.code
        USING ERRCODE = '23502';
    END IF;

    -- direction по типу + знаку amount:
    --   asset/expense + amount>0  → Dr (natural increase)
    --   asset/expense + amount<0  → Cr (overdraft)
    --   liability/equity/revenue + amount>0 → Cr (natural increase)
    --   liability + amount<0      → Dr (claim against counterparty)
    IF v_account.type IN ('asset','expense') THEN
      v_dr := (v_amount > 0);
    ELSE
      v_dr := (v_amount < 0);
    END IF;

    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code,
       client_id, partner_id, note)
    VALUES (
      v_tx_id, v_account.id,
      CASE WHEN v_dr THEN 'dr' ELSE 'cr' END,
      ABS(v_amount), v_account.currency_code,
      v_client_id, v_partner_id,
      'Cutover opening: ' || v_account.code || ' = ' || v_amount::text
    );
  END LOOP;

  -- ── Phase 2: balancing через Opening Equity · X per currency ──
  -- Считаем net Dr−Cr для каждой валюты в этой transaction (без opening
  -- equity entries — они ещё не созданы) и пишем balancing entry:
  --   net > 0 (Dr выше Cr) → нужен Cr на opening equity
  --   net < 0               → нужен Dr (чаще не бывает, но bypass работает)
  FOR v_currency_net IN
    SELECT je.currency_code AS cur,
           SUM(CASE WHEN je.direction='dr' THEN je.amount ELSE -je.amount END) AS net_dr_cr
      FROM ledger.journal_entries je
     WHERE je.transaction_id = v_tx_id
     GROUP BY je.currency_code
     HAVING SUM(CASE WHEN je.direction='dr' THEN je.amount ELSE -je.amount END) <> 0
  LOOP
    SELECT id INTO v_opening_acc_id FROM ledger.accounts
      WHERE subtype = 'opening_balance' AND currency_code = v_currency_net.cur AND active LIMIT 1;
    IF v_opening_acc_id IS NULL THEN
      RAISE EXCEPTION 'Opening Balance Equity for currency % not found', v_currency_net.cur
        USING ERRCODE = 'P0002',
        HINT = 'Add Opening Balance Equity · <currency> account first';
    END IF;

    INSERT INTO ledger.journal_entries
      (transaction_id, account_id, direction, amount, currency_code, note)
    VALUES (
      v_tx_id, v_opening_acc_id,
      CASE WHEN v_currency_net.net_dr_cr > 0 THEN 'cr' ELSE 'dr' END,
      ABS(v_currency_net.net_dr_cr), v_currency_net.cur,
      'Cutover balancing: net capital in ' || v_currency_net.cur
    );
  END LOOP;

  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'cutover.create_opening',
          format('Cutover opening transaction created (%s entries)',
                 (SELECT count(*) FROM ledger.journal_entries WHERE transaction_id = v_tx_id)),
          jsonb_build_object('opening_tx_id', v_tx_id,
                             'effective_date', p_effective_date,
                             'inventory_count', jsonb_array_length(p_inventory)));

  RETURN v_tx_id;
END $function$;

-- Owned by postgres; revoke from authenticated
ALTER FUNCTION ledger.create_opening_from_inventory(jsonb, timestamptz, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.create_opening_from_inventory(jsonb, timestamptz, text, jsonb)
  FROM PUBLIC, authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════
-- 2. ledger.verify_opening
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ledger.verify_opening(p_opening_tx_id uuid)
RETURNS TABLE(check_name text, passed boolean, details jsonb)
LANGUAGE plpgsql
STABLE
SET search_path = ledger, public
AS $function$
DECLARE
  v_imbalances jsonb;
  v_imbalance_count int;
  v_mismatch_count int;
  v_mismatch_payload jsonb;
BEGIN
  -- Check 1: per-currency Σ Dr = Σ Cr внутри opening-tx
  WITH per_currency AS (
    SELECT je.currency_code AS cur,
           SUM(CASE WHEN je.direction='dr' THEN je.amount ELSE 0 END) AS dr,
           SUM(CASE WHEN je.direction='cr' THEN je.amount ELSE 0 END) AS cr
      FROM ledger.journal_entries je
     WHERE je.transaction_id = p_opening_tx_id
     GROUP BY je.currency_code
  )
  SELECT count(*) FILTER (WHERE ABS(dr - cr) > 0.00000001),
         COALESCE(jsonb_agg(jsonb_build_object('currency', cur, 'dr', dr, 'cr', cr, 'imbalance', dr - cr))
                  FILTER (WHERE ABS(dr - cr) > 0.00000001), '[]'::jsonb)
    INTO v_imbalance_count, v_imbalances
    FROM per_currency;

  RETURN QUERY SELECT
    'per_currency_balance'::text,
    (v_imbalance_count = 0),
    jsonb_build_object(
      'imbalance_count', v_imbalance_count,
      'imbalances', v_imbalances,
      'message', CASE WHEN v_imbalance_count = 0
                      THEN 'All currencies balanced'
                      ELSE format('%s currency(ies) imbalanced', v_imbalance_count)
                 END
    );

  -- Check 2: balances ↔ journal_entries consistency (по всей БД)
  SELECT count(*),
         COALESCE(jsonb_agg(row_to_json(v))
                  FILTER (WHERE ABS(v.diff) > 0.00000001), '[]'::jsonb)
    INTO v_mismatch_count, v_mismatch_payload
    FROM (SELECT * FROM ledger.v_balance_check WHERE ABS(diff) > 0.00000001 LIMIT 100) v;

  RETURN QUERY SELECT
    'balances_consistency'::text,
    (v_mismatch_count = 0),
    jsonb_build_object(
      'mismatch_count', v_mismatch_count,
      'mismatches', v_mismatch_payload,
      'message', CASE WHEN v_mismatch_count = 0
                      THEN '0 mismatches between balances and journal_entries'
                      ELSE format('%s mismatches found', v_mismatch_count)
                 END
    );
END $function$;


-- ════════════════════════════════════════════════════════════════════════
-- 3. ledger.freeze_legacy_tables
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ledger.freeze_legacy_tables()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'account_movements',
    'partner_account_movements',
    'obligations',
    'deals',
    'deal_legs',
    'deal_in_payments',
    'deal_leg_payments'
  ];
  v_results jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    BEGIN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated, anon, service_role', v_table);
      v_results := v_results || jsonb_build_array(jsonb_build_object('table', v_table, 'frozen', true));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('table', v_table, 'frozen', false, 'error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'cutover.freeze_legacy',
          format('Legacy tables frozen (%s)', array_length(v_tables, 1)),
          v_results);

  RETURN v_results;
END $function$;

ALTER FUNCTION ledger.freeze_legacy_tables() OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.freeze_legacy_tables() FROM PUBLIC, authenticated, anon;
