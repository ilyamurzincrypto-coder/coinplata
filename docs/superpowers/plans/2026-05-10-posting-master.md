# Posting Master Implementation Plan (Spec C.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual N-leg journal-entry editor ("Posting Master") as a new, permission-gated tab in the Treasury section, writing balanced single-currency Dr/Cr entries into the `ledger.*` schema via a new owner/accountant-only RPC.

**Architecture:** New `ledger.create_manual_entry` plpgsql RPC (sibling of the 2-leg `ledger.create_adjustment`) + a `public.create_manual_entry` SECURITY DEFINER wrapper granted to `authenticated` (real authz = `public._require_role(['owner','accountant'])` inside). A thin JS wrapper `rpcCreateManualEntryV2` in `src/lib/newLedger.js`. A pure module `src/lib/treasury/postingEntry.js` (balance math + validation + payload build). UI: `PostingTab` editor + `AccountPicker` + `ReverseEntryModal`, plus small wiring into `TreasuryShell`, `JournalTab`, `TransactionRow`, `ledgerReaders.js`, and i18n.

**Tech Stack:** Vite + React 18 + Tailwind 3; Vitest + @testing-library/react (jsdom); Supabase Postgres (plpgsql RPCs applied via the Supabase MCP `apply_migration` tool). No router/state-lib.

**Spec:** `docs/superpowers/specs/2026-05-10-posting-master-design.md`. Builds on Spec B (`src/pages/treasury_v2/`, shipped on `main`).

---

## Phase 0 — Branch + baseline

### Task 0.1: Confirm branch and baseline green

**Files:** none.

- [ ] **Step 1: Confirm the working branch**

```bash
git branch --show-current
```

Expected: `feat/posting-master` (it was created when the spec was committed). If you're on `main`, run `git checkout feat/posting-master`.

- [ ] **Step 2: Baseline test suite**

```bash
npx vitest run --no-file-parallelism
```

Expected: all green (24 files / 229 tests as of the Spec B merge). Note the exact counts — later phases add files; the totals only go up.

- [ ] **Step 3: Baseline build**

```bash
npm run build
```

Expected: succeeds (the chunk-size warning is pre-existing and fine).

---

## Phase 1 — i18n keys

### Task 1.1: Add `trv2_pm_*` keys (en / ru / tr) + `trv2_journal_type_manual`

**Files:**
- Modify: `src/i18n/translations.jsx` (three locale blocks: en near line ~636, ru near line ~1799, tr near line ~2958 — each block already has a `trv2_loading:` line and `trv2_journal_type_reversal:` line; insert near those).

- [ ] **Step 1: Add the English keys**

Find the English block. After the existing line `trv2_journal_type_reversal: "Reversals",` add:

```jsx
    trv2_journal_type_manual: "Manual",
```

After the existing line `trv2_loading: "Loading ledger…",` add:

```jsx
    // Posting Master (Spec C.1) — manual N-leg journal entry
    trv2_pm_tab: "Manual entry",
    trv2_pm_title: "Manual journal entry",
    trv2_pm_effective_date: "Date",
    trv2_pm_currency: "Currency",
    trv2_pm_col_account: "Account",
    trv2_pm_col_dr: "Debit",
    trv2_pm_col_cr: "Credit",
    trv2_pm_add_line: "+ Add line",
    trv2_pm_remove_line: "Remove line",
    trv2_pm_reason: "Reason",
    trv2_pm_reason_ph: "Why this entry (required, goes to the audit trail)",
    trv2_pm_description: "Description (optional)",
    trv2_pm_balance: "Σ Dr {dr} − Σ Cr {cr} = Δ {delta}",
    trv2_pm_balanced: "Balanced ✓",
    trv2_pm_unbalanced: "Does not balance",
    trv2_pm_preview: "Dr/Cr preview",
    trv2_pm_post: "Post entry",
    trv2_pm_system_account_hint: "usually maintained automatically",
    trv2_pm_no_accounts: "No postable accounts for this currency.",
    trv2_pm_posted: "Manual entry posted",
    trv2_pm_err_forbidden: "You don't have permission to post manual entries (owner or accountant only).",
    trv2_pm_err_unbalanced: "Entry does not balance — Σ Debit must equal Σ Credit.",
    trv2_pm_err_generic: "Could not post the entry",
    trv2_pm_reverse: "Reverse",
    trv2_pm_reverse_title: "Reverse this manual entry",
    trv2_pm_reverse_reason_ph: "Reason for the reversal (required)",
    trv2_pm_reverse_confirm: "Reverse",
    trv2_pm_reverse_cancel: "Cancel",
    trv2_pm_reversed_chip: "reversed",
    trv2_pm_reverse_done: "Entry reversed",
```

- [ ] **Step 2: Add the Russian keys**

In the Russian block, after `trv2_journal_type_reversal: "Сторно",` add:

```jsx
    trv2_journal_type_manual: "Ручные",
```

After `trv2_loading: "Загрузка леджера…",` add:

```jsx
    // Posting Master (Spec C.1) — ручная N-плечая проводка
    trv2_pm_tab: "Ручная проводка",
    trv2_pm_title: "Ручная проводка",
    trv2_pm_effective_date: "Дата",
    trv2_pm_currency: "Валюта",
    trv2_pm_col_account: "Счёт",
    trv2_pm_col_dr: "Дебет",
    trv2_pm_col_cr: "Кредит",
    trv2_pm_add_line: "+ Добавить строку",
    trv2_pm_remove_line: "Удалить строку",
    trv2_pm_reason: "Основание",
    trv2_pm_reason_ph: "Зачем эта проводка (обязательно, попадёт в аудит-трейл)",
    trv2_pm_description: "Описание (необязательно)",
    trv2_pm_balance: "Σ Дт {dr} − Σ Кт {cr} = Δ {delta}",
    trv2_pm_balanced: "Сбалансировано ✓",
    trv2_pm_unbalanced: "Не сходится",
    trv2_pm_preview: "Предпросмотр Дт/Кт",
    trv2_pm_post: "Провести",
    trv2_pm_system_account_hint: "обычно ведётся автоматически",
    trv2_pm_no_accounts: "Нет доступных для проводки счетов в этой валюте.",
    trv2_pm_posted: "Проводка проведена",
    trv2_pm_err_forbidden: "Нет прав на ручные проводки (только owner или accountant).",
    trv2_pm_err_unbalanced: "Проводка не сходится — Σ Дебет должна равняться Σ Кредит.",
    trv2_pm_err_generic: "Не удалось провести проводку",
    trv2_pm_reverse: "Сторнировать",
    trv2_pm_reverse_title: "Сторнировать эту ручную проводку",
    trv2_pm_reverse_reason_ph: "Причина сторно (обязательно)",
    trv2_pm_reverse_confirm: "Сторнировать",
    trv2_pm_reverse_cancel: "Отмена",
    trv2_pm_reversed_chip: "сторнирована",
    trv2_pm_reverse_done: "Проводка сторнирована",
```

- [ ] **Step 3: Add the Turkish keys**

In the Turkish block, after `trv2_journal_type_reversal: "Ters kayıtlar",` add:

```jsx
    trv2_journal_type_manual: "Manuel",
```

After `trv2_loading: "Defter yükleniyor…",` add:

```jsx
    // Posting Master (Spec C.1) — manuel N-bacaklı yevmiye kaydı
    trv2_pm_tab: "Manuel kayıt",
    trv2_pm_title: "Manuel yevmiye kaydı",
    trv2_pm_effective_date: "Tarih",
    trv2_pm_currency: "Para birimi",
    trv2_pm_col_account: "Hesap",
    trv2_pm_col_dr: "Borç",
    trv2_pm_col_cr: "Alacak",
    trv2_pm_add_line: "+ Satır ekle",
    trv2_pm_remove_line: "Satırı kaldır",
    trv2_pm_reason: "Gerekçe",
    trv2_pm_reason_ph: "Bu kaydın gerekçesi (zorunlu, denetim kaydına gider)",
    trv2_pm_description: "Açıklama (isteğe bağlı)",
    trv2_pm_balance: "Σ Borç {dr} − Σ Alacak {cr} = Δ {delta}",
    trv2_pm_balanced: "Dengeli ✓",
    trv2_pm_unbalanced: "Denk değil",
    trv2_pm_preview: "Borç/Alacak önizleme",
    trv2_pm_post: "Kaydet",
    trv2_pm_system_account_hint: "genellikle otomatik yönetilir",
    trv2_pm_no_accounts: "Bu para birimi için kayda uygun hesap yok.",
    trv2_pm_posted: "Manuel kayıt oluşturuldu",
    trv2_pm_err_forbidden: "Manuel kayıt yetkiniz yok (yalnızca owner veya accountant).",
    trv2_pm_err_unbalanced: "Kayıt denk değil — Σ Borç, Σ Alacak'a eşit olmalı.",
    trv2_pm_err_generic: "Kayıt oluşturulamadı",
    trv2_pm_reverse: "Ters kaydet",
    trv2_pm_reverse_title: "Bu manuel kaydı ters kaydet",
    trv2_pm_reverse_reason_ph: "Ters kayıt gerekçesi (zorunlu)",
    trv2_pm_reverse_confirm: "Ters kaydet",
    trv2_pm_reverse_cancel: "İptal",
    trv2_pm_reversed_chip: "ters kaydedildi",
    trv2_pm_reverse_done: "Kayıt ters kaydedildi",
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/translations.jsx
git commit -m "i18n(treasury): trv2_pm_* keys + trv2_journal_type_manual (en/ru/tr)"
git push
```

---

## Phase 2 — Backend: `create_manual_entry` RPC + public wrapper

### Task 2.1: Migration — `ledger.create_manual_entry` + `public.create_manual_entry`

**Files:**
- Create: `supabase/migrations/posting_master_1_create_manual_entry.sql`
- Apply via the Supabase MCP `apply_migration` tool (migration name: `posting_master_1_create_manual_entry`), then commit the `.sql` file.

Context for the implementer: `ledger.transactions.source_kind` is a free-text column (no CHECK constraint) — `'manual'` needs no schema change. The DB already enforces `tx_backdate_sanity` (`effective_date >= created_at - 90d`) and `tx_forwarddate_sanity` (`effective_date <= created_at + 24h`). The 2-leg sibling `ledger.create_adjustment` lives in `supabase/migrations/direction2_2_3_create_adjustment.sql` — this RPC mirrors its idempotency / audit-alert / Dr-Cr-insert structure but for N lines, and is owner/accountant-callable (via `public._require_role`) rather than service-role-only. `public._require_role(text[])` is defined in `supabase/migrations/0042_rpc_authorization.sql` (raises `42501 'Not authenticated'` when `auth.uid()` is NULL, raises `42501` when the caller's role isn't in the array, otherwise returns the role).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/posting_master_1_create_manual_entry.sql`:

```sql
-- posting_master_1_create_manual_entry.sql
--
-- ledger.create_manual_entry — N-leg manual journal entry (Posting Master, Spec C.1).
-- Sibling of ledger.create_adjustment (2-leg, service-role-only). Supports an arbitrary
-- number of balanced Dr/Cr lines in a single currency, callable by owner/accountant via
-- public.create_manual_entry.
--
-- Validation order (after idempotency lookup, before any write):
--   1. caller role ∈ (owner, accountant)             -> 42501  (via public._require_role)
--   2. p_currency_code exists in ledger.currencies    -> P0002
--   3. p_reason non-empty                              -> 22000
--   4. p_lines is a jsonb array with >= 2 elements     -> 22000
--   5. each line: direction ∈ (dr,cr), amount numeric > 0   -> 22000
--   6. each line: account exists & active & currency_code = p_currency_code  -> P0002 / 22000
--   7. each line: client_id required if account.client_dim_required (same for partner) -> 22000
--   8. >= 1 dr line AND >= 1 cr line                   -> 22000
--   9. Σ dr amounts = Σ cr amounts (±0.01)             -> 22000
--
-- On success: 1 ledger.transactions (source_kind='manual') + N ledger.journal_entries
--             + 1 ledger.audit_alerts (level='warn') + idempotency key saved.

CREATE OR REPLACE FUNCTION ledger.create_manual_entry(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_lines           jsonb,
  p_currency_code   text,
  p_reason          text,
  p_effective_date  timestamptz DEFAULT now(),
  p_description     text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, public
AS $function$
DECLARE
  v_existing    record;
  v_caller_role text;
  v_tx_id       uuid;
  v_line        jsonb;
  v_idx         int := 0;
  v_dir         text;
  v_amt         numeric;
  v_code        text;
  v_acc         record;
  v_client      uuid;
  v_partner     uuid;
  v_sum_dr      numeric := 0;
  v_sum_cr      numeric := 0;
  v_n_dr        int := 0;
  v_n_cr        int := 0;
  v_n_lines     int;
  v_metadata    jsonb;
BEGIN
  -- 1. Idempotency lookup
  IF p_idempotency_key IS NOT NULL THEN
    SELECT transaction_id, request_hash INTO v_existing
      FROM ledger.idempotency_keys
     WHERE key = p_idempotency_key AND expires_at > now() FOR UPDATE;
    IF FOUND THEN
      IF v_existing.request_hash <> p_request_hash THEN
        RAISE EXCEPTION 'Idempotency key reused with different payload (key=%)', p_idempotency_key
          USING ERRCODE = 'P0422';
      END IF;
      RETURN v_existing.transaction_id;
    END IF;
  END IF;

  -- 2. Caller role (raises 42501 for not-authenticated / wrong role)
  v_caller_role := public._require_role(ARRAY['owner','accountant']);

  -- 3. Validate currency
  IF NOT EXISTS (SELECT 1 FROM ledger.currencies WHERE code = p_currency_code) THEN
    RAISE EXCEPTION 'Unknown currency %', p_currency_code USING ERRCODE = 'P0002',
      DETAIL = format('Currency %s is not registered in ledger.currencies', p_currency_code);
  END IF;

  -- 4. Validate reason
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required (audit-trail)' USING ERRCODE = '22000';
  END IF;

  -- 5. Validate lines container
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be a JSON array' USING ERRCODE = '22000';
  END IF;
  v_n_lines := jsonb_array_length(p_lines);
  IF v_n_lines < 2 THEN
    RAISE EXCEPTION 'a manual entry needs at least 2 lines (got %)', v_n_lines USING ERRCODE = '22000';
  END IF;

  -- 6. Validate each line
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;

    v_dir := lower(v_line->>'direction');
    IF v_dir IS NULL OR v_dir NOT IN ('dr','cr') THEN
      RAISE EXCEPTION 'line %: direction must be dr|cr (got %)', v_idx, v_line->>'direction'
        USING ERRCODE = '22000';
    END IF;

    BEGIN
      v_amt := (v_line->>'amount')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'line %: amount is not a number (got %)', v_idx, v_line->>'amount'
        USING ERRCODE = '22000';
    END;
    IF v_amt IS NULL OR v_amt <= 0 THEN
      RAISE EXCEPTION 'line %: amount must be > 0 (got %)', v_idx, v_amt USING ERRCODE = '22000';
    END IF;

    v_code := v_line->>'account_code';
    SELECT id, code, currency_code, client_dim_required, partner_dim_required
      INTO v_acc
      FROM ledger.accounts WHERE code = v_code AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line %: account % not found or inactive', v_idx, v_code USING ERRCODE = 'P0002';
    END IF;
    IF v_acc.currency_code <> p_currency_code THEN
      RAISE EXCEPTION 'line %: account % currency (%) does not match entry currency (%)',
        v_idx, v_code, v_acc.currency_code, p_currency_code USING ERRCODE = '22000';
    END IF;

    v_client  := NULLIF(v_line->>'client_id','')::uuid;
    v_partner := NULLIF(v_line->>'partner_id','')::uuid;
    IF v_acc.client_dim_required AND v_client IS NULL THEN
      RAISE EXCEPTION 'line %: account % requires a client_id', v_idx, v_code USING ERRCODE = '22000';
    END IF;
    IF v_acc.partner_dim_required AND v_partner IS NULL THEN
      RAISE EXCEPTION 'line %: account % requires a partner_id', v_idx, v_code USING ERRCODE = '22000';
    END IF;

    IF v_dir = 'dr' THEN v_sum_dr := v_sum_dr + v_amt; v_n_dr := v_n_dr + 1;
                    ELSE v_sum_cr := v_sum_cr + v_amt; v_n_cr := v_n_cr + 1; END IF;
  END LOOP;

  -- 7. Composition + balance
  IF v_n_dr = 0 OR v_n_cr = 0 THEN
    RAISE EXCEPTION 'a manual entry needs at least one Dr and one Cr line' USING ERRCODE = '22000';
  END IF;
  IF abs(v_sum_dr - v_sum_cr) > 0.01 THEN
    RAISE EXCEPTION 'entry does not balance: Dr % <> Cr %', v_sum_dr, v_sum_cr USING ERRCODE = '22000';
  END IF;

  -- 8. Insert transaction
  v_tx_id := gen_random_uuid();
  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'reason', p_reason, 'line_count', v_n_lines, 'posted_by_role', v_caller_role
  );
  INSERT INTO ledger.transactions
    (id, idempotency_key, effective_date, created_by, description, source_kind, source_ref_id, metadata)
  VALUES (v_tx_id, p_idempotency_key, p_effective_date, auth.uid(),
          COALESCE(NULLIF(trim(p_description), ''), 'Manual entry: ' || p_reason),
          'manual', NULL, v_metadata);

  -- 9. Insert journal entries (lines already validated above)
  INSERT INTO ledger.journal_entries
    (transaction_id, account_id, direction, amount, currency_code, client_id, partner_id, note)
  SELECT v_tx_id, a.id, lower(l->>'direction'), (l->>'amount')::numeric, p_currency_code,
         NULLIF(l->>'client_id','')::uuid, NULLIF(l->>'partner_id','')::uuid, 'Manual: ' || p_reason
    FROM jsonb_array_elements(p_lines) AS l
    JOIN ledger.accounts a ON a.code = l->>'account_code' AND a.active;

  -- 10. Save idempotency key
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ledger.idempotency_keys (key, transaction_id, request_hash)
    VALUES (p_idempotency_key, v_tx_id, p_request_hash);
  END IF;

  -- 11. Audit alert (warn — manual postings are rare and should be visible)
  INSERT INTO ledger.audit_alerts (level, source, message, payload)
  VALUES ('warn', 'rpc.create_manual_entry',
          format('Manual entry posted: %s lines, %s %s (reason: %s)', v_n_lines, v_sum_dr, p_currency_code, p_reason),
          jsonb_build_object(
            'tx_id', v_tx_id, 'currency', p_currency_code, 'sum', v_sum_dr,
            'reason', p_reason, 'lines', p_lines, 'created_by', auth.uid(), 'role', v_caller_role
          ));

  RETURN v_tx_id;
END $function$;

ALTER FUNCTION ledger.create_manual_entry(uuid, text, jsonb, text, text, timestamptz, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION ledger.create_manual_entry(uuid, text, jsonb, text, text, timestamptz, text, jsonb) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION ledger.create_manual_entry(uuid, text, jsonb, text, text, timestamptz, text, jsonb) TO service_role;

-- ─── public.create_manual_entry — thin wrapper (real authz = _require_role inside) ───
CREATE OR REPLACE FUNCTION public.create_manual_entry(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_lines           jsonb,
  p_currency_code   text,
  p_reason          text,
  p_effective_date  timestamptz DEFAULT now(),
  p_description     text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ledger.create_manual_entry(
    p_idempotency_key, p_request_hash, p_lines, p_currency_code,
    p_reason, p_effective_date, p_description, p_metadata
  );
$$;

REVOKE ALL ON FUNCTION public.create_manual_entry(uuid, text, jsonb, text, text, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_manual_entry(uuid, text, jsonb, text, text, timestamptz, text, jsonb) TO authenticated;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool `mcp__supabase__apply_migration` with `name: "posting_master_1_create_manual_entry"` and `query:` the full SQL above.

- [ ] **Step 3: Verify the functions exist**

Use `mcp__supabase__execute_sql`:

```sql
SELECT n.nspname AS schema, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'create_manual_entry'
ORDER BY 1;
```

Expected: two rows — `ledger | create_manual_entry` and `public | create_manual_entry`.

- [ ] **Step 4: Verify the auth gate fires**

Use `mcp__supabase__execute_sql` (this runs with no `auth.uid()`, so `_require_role` should reject):

```sql
SELECT public.create_manual_entry(
  gen_random_uuid(), 'smoke',
  '[{"account_code":"X","direction":"dr","amount":1},{"account_code":"Y","direction":"cr","amount":1}]'::jsonb,
  'USD', 'smoke test', now(), null, '{}'::jsonb
);
```

Expected: an error with SQLSTATE `42501` and message `Not authenticated` (the `_require_role` guard rejects before any account lookup). If you instead get a "currency" or "account not found" error, the role gate is in the wrong place — move the `_require_role` call above step 3.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/posting_master_1_create_manual_entry.sql
git commit -m "feat(ledger): create_manual_entry RPC + public wrapper (Posting Master)"
git push
```

---

## Phase 3 — JS wrapper `rpcCreateManualEntryV2`

### Task 3.1: Add the wrapper to `src/lib/newLedger.js` (TDD)

**Files:**
- Modify: `src/lib/newLedger.js` (add `rpcCreateManualEntryV2` near the other `create*` wrappers, e.g. after `rpcCreateAdjustmentV2`)
- Test: `src/lib/newLedger.manualEntry.test.js` (new)

Context: every wrapper in this file follows the same shape — generate `newIdempotencyKey()` if none passed, compute `await requestHash({...payload, idempotencyKey: undefined})`, build the `p_*` params, call `await invokeLedger("<rpc_name_without_schema_prefix>", params)`, return its result. `invokeLedger` already calls `bumpDataVersion()` on success and throws an `Error` with a formatted message (`message · details · hint`) on failure. `requestHash`, `newIdempotencyKey`, `canonicalJson` are exported from this file.

- [ ] **Step 1: Write the failing test**

Create `src/lib/newLedger.manualEntry.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("./supabase.js", () => ({
  supabase: { rpc: (...a) => rpcMock(...a) },
  isSupabaseConfigured: true,
}));
vi.mock("./dataVersion.jsx", () => ({ bumpDataVersion: vi.fn() }));

import { rpcCreateManualEntryV2 } from "./newLedger.js";

describe("rpcCreateManualEntryV2", () => {
  beforeEach(() => rpcMock.mockReset());

  it("maps the payload to p_* params, snake-cases lines, drops empty dims, returns tx_id", async () => {
    rpcMock.mockResolvedValue({ data: "tx-123", error: null });
    const txId = await rpcCreateManualEntryV2({
      lines: [
        { accountCode: "1110", direction: "dr", amount: 100 },
        { accountCode: "4010", direction: "cr", amount: 100, clientId: "", partnerId: null },
      ],
      currencyCode: "USD",
      reason: "manual fee",
      effectiveDate: "2026-05-10T00:00:00.000Z",
      description: " ",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(txId).toBe("tx-123");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, params] = rpcMock.mock.calls[0];
    expect(name).toBe("create_manual_entry");
    expect(params.p_idempotency_key).toBe("11111111-1111-4111-8111-111111111111");
    expect(typeof params.p_request_hash).toBe("string");
    expect(params.p_request_hash.length).toBe(64); // sha-256 hex
    expect(params.p_currency_code).toBe("USD");
    expect(params.p_reason).toBe("manual fee");
    expect(params.p_effective_date).toBe("2026-05-10T00:00:00.000Z");
    expect(params.p_lines).toEqual([
      { account_code: "1110", direction: "dr", amount: 100 },
      { account_code: "4010", direction: "cr", amount: 100 },
    ]);
  });

  it("generates an idempotency key when none is passed", async () => {
    rpcMock.mockResolvedValue({ data: "tx-9", error: null });
    await rpcCreateManualEntryV2({
      lines: [{ accountCode: "A", direction: "dr", amount: 1 }, { accountCode: "B", direction: "cr", amount: 1 }],
      currencyCode: "USD", reason: "x",
    });
    const [, params] = rpcMock.mock.calls[0];
    expect(params.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("surfaces RPC errors as thrown Error with the DB message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "entry does not balance: Dr 1 <> Cr 2", code: "22000" } });
    await expect(rpcCreateManualEntryV2({
      lines: [{ accountCode: "A", direction: "dr", amount: 1 }, { accountCode: "B", direction: "cr", amount: 2 }],
      currencyCode: "USD", reason: "x",
    })).rejects.toThrow(/does not balance/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/lib/newLedger.manualEntry.test.js
```

Expected: FAIL — `rpcCreateManualEntryV2 is not a function` / `is not exported`.

- [ ] **Step 3: Implement the wrapper**

In `src/lib/newLedger.js`, after the `rpcCreateAdjustmentV2` function, add:

```js
/**
 * ledger.create_manual_entry (via public.create_manual_entry) — N-leg manual journal
 * entry (Posting Master). Owner/accountant-only (enforced server-side by _require_role).
 *
 * @param {Object} payload
 * @param {Array<{accountCode:string, direction:'dr'|'cr', amount:number|string, clientId?:string, partnerId?:string}>} payload.lines
 * @param {string} payload.currencyCode
 * @param {string} payload.reason            — required (audit trail)
 * @param {string} [payload.effectiveDate]   — ISO string; defaults to now()
 * @param {string} [payload.description]
 * @param {Object} [payload.metadata]
 * @param {string} [payload.idempotencyKey]
 * @returns {Promise<string>} tx_id
 */
export async function rpcCreateManualEntryV2(payload) {
  const key = payload.idempotencyKey || newIdempotencyKey();
  const params = {
    p_idempotency_key: key,
    p_request_hash: await requestHash({ ...payload, idempotencyKey: undefined }),
    p_lines: (payload.lines || []).map((l) => {
      const out = { account_code: l.accountCode, direction: l.direction, amount: l.amount };
      if (l.clientId) out.client_id = l.clientId;
      if (l.partnerId) out.partner_id = l.partnerId;
      return out;
    }),
    p_currency_code: payload.currencyCode,
    p_reason: payload.reason,
    p_effective_date: payload.effectiveDate || new Date().toISOString(),
    p_description: payload.description ?? null,
    p_metadata: payload.metadata ?? {},
  };
  return await invokeLedger("create_manual_entry", params);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/lib/newLedger.manualEntry.test.js
```

Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/newLedger.js src/lib/newLedger.manualEntry.test.js
git commit -m "feat(ledger): rpcCreateManualEntryV2 JS wrapper"
git push
```

---

## Phase 4 — Pure module: balance math + validation + payload build (TDD)

### Task 4.1: Write the failing tests for `src/lib/treasury/postingEntry.js`

**Files:**
- Test: `src/lib/treasury/postingEntry.test.js` (new)
- (Module created in Task 4.2: `src/lib/treasury/postingEntry.js`)

Data shapes used here:
- An **account** (from `useLedger().accounts`, mapped by `ledgerReaders.loadLedgerAccounts`): `{ id, code, name, type, subtype, currency, officeId, clientDimRequired, partnerDimRequired, allowNegative, active }`.
- A **draft** (the editor's form state): `{ currency: string, effectiveDate: string, reason: string, description: string, lines: Array<{ id, accountCode, side: 'dr'|'cr', amount: string|number, clientId?, partnerId? }> }`.

- [ ] **Step 1: Write the test**

Create `src/lib/treasury/postingEntry.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  SYSTEM_DRIVEN_SUBTYPES,
  deriveCurrencies,
  accountsForCurrency,
  postingBalance,
  validatePostingDraft,
  buildManualEntryPayload,
} from "./postingEntry.js";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a2", code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a3", code: "5010", name: "Office rent USD", type: "expense", subtype: "rent", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a4", code: "1340", name: "Treasury USDT", type: "asset", subtype: "crypto_input", currency: "USDT", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a5", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", clientDimRequired: true, partnerDimRequired: false, active: true },
  { id: "a6", code: "1199", name: "Old account", type: "asset", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: false },
];
const byCode = (code) => ACCOUNTS.find((a) => a.code === code) || null;

const draft = (over = {}) => ({
  currency: "USD",
  effectiveDate: "2026-05-10T00:00:00.000Z",
  reason: "manual fee",
  description: "",
  lines: [
    { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
    { id: "l2", accountCode: "4010", side: "cr", amount: "100" },
  ],
  ...over,
});

describe("deriveCurrencies", () => {
  it("returns sorted unique currencies of active accounts only", () => {
    expect(deriveCurrencies(ACCOUNTS)).toEqual(["USD", "USDT"]);
  });
});

describe("accountsForCurrency", () => {
  it("returns active accounts for the currency, excluding ones with a required dimension", () => {
    const r = accountsForCurrency(ACCOUNTS, "USD").map((a) => a.code);
    expect(r).toEqual(["1110", "4010", "5010"]); // 2110 excluded (clientDimRequired), 1199 excluded (inactive)
  });
  it("flags system-driven subtypes via SYSTEM_DRIVEN_SUBTYPES", () => {
    expect(SYSTEM_DRIVEN_SUBTYPES.has("crypto_input")).toBe(true);
    expect(SYSTEM_DRIVEN_SUBTYPES.has("cash")).toBe(false);
  });
});

describe("postingBalance", () => {
  it("sums Dr and Cr and returns the delta", () => {
    expect(postingBalance([{ side: "dr", amount: "100" }, { side: "cr", amount: "60" }, { side: "cr", amount: "40" }]))
      .toEqual({ dr: 100, cr: 100, delta: 0 });
  });
  it("treats blank/invalid amounts as 0", () => {
    expect(postingBalance([{ side: "dr", amount: "" }, { side: "cr", amount: "x" }])).toEqual({ dr: 0, cr: 0, delta: 0 });
  });
});

describe("validatePostingDraft", () => {
  it("ok for a balanced 2-line draft", () => {
    expect(validatePostingDraft(draft(), byCode)).toEqual({ ok: true, errors: [] });
  });
  it("rejects unbalanced", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "4010", side: "cr", amount: "90" },
    ] }), byCode);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "unbalanced")).toBe(true);
  });
  it("rejects fewer than 2 lines", () => {
    const r = validatePostingDraft(draft({ lines: [{ id: "l1", accountCode: "1110", side: "dr", amount: "100" }] }), byCode);
    expect(r.errors.some((e) => e.code === "too_few_lines")).toBe(true);
  });
  it("rejects empty reason", () => {
    const r = validatePostingDraft(draft({ reason: "  " }), byCode);
    expect(r.errors.some((e) => e.code === "reason_required")).toBe(true);
  });
  it("rejects a non-positive amount with a per-line error", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "0" },
      { id: "l2", accountCode: "4010", side: "cr", amount: "0" },
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "amount_positive" && e.lineId === "l1")).toBe(true);
  });
  it("rejects a missing / unknown / inactive account", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "", side: "dr", amount: "100" },
      { id: "l2", accountCode: "1199", side: "cr", amount: "100" },
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "account_required" && e.lineId === "l1")).toBe(true);
    expect(r.errors.some((e) => e.code === "account_unknown" && e.lineId === "l2")).toBe(true);
  });
  it("rejects a currency mismatch", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "1340", side: "cr", amount: "100" }, // USDT account in a USD entry
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "currency_mismatch" && e.lineId === "l2")).toBe(true);
  });
  it("rejects an account that requires a subconto dimension (not postable in v1)", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "2110", side: "cr", amount: "100" },
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "dim_not_supported" && e.lineId === "l2")).toBe(true);
  });
  it("requires at least one Dr and one Cr line", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "50" },
      { id: "l2", accountCode: "5010", side: "dr", amount: "50" },
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "need_dr_and_cr")).toBe(true);
  });
});

describe("buildManualEntryPayload", () => {
  it("maps a draft to the rpcCreateManualEntryV2 payload (numeric amounts, trimmed reason)", () => {
    expect(buildManualEntryPayload(draft({ reason: "  manual fee  ", description: " note " }))).toEqual({
      lines: [
        { accountCode: "1110", direction: "dr", amount: 100 },
        { accountCode: "4010", direction: "cr", amount: 100 },
      ],
      currencyCode: "USD",
      reason: "manual fee",
      effectiveDate: "2026-05-10T00:00:00.000Z",
      description: "note",
    });
  });
  it("omits description when blank", () => {
    expect(buildManualEntryPayload(draft({ description: "   " })).description).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/lib/treasury/postingEntry.test.js
```

Expected: FAIL — cannot resolve `./postingEntry.js`.

### Task 4.2: Implement `src/lib/treasury/postingEntry.js`

**Files:**
- Create: `src/lib/treasury/postingEntry.js`

- [ ] **Step 1: Implement the module**

Create `src/lib/treasury/postingEntry.js`:

```js
// src/lib/treasury/postingEntry.js
// Pure helpers for the Posting Master editor: which accounts/currencies are
// postable, the live Dr/Cr balance, full draft validation, and mapping a draft
// to the rpcCreateManualEntryV2 payload. No React, no Supabase.

// Account subtypes that are normally driven by automated flows (cashier deals,
// transfers, settlements). Posting to them by hand is allowed (informational
// warning chip), EXCEPT customer_liab / partner_liab which require a subconto
// dimension and are excluded from the v1 picker entirely.
export const SYSTEM_DRIVEN_SUBTYPES = new Set([
  "customer_liab", "partner_liab", "clearing", "fx_clearing", "crypto_input", "crypto_output",
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function deriveCurrencies(accounts) {
  const set = new Set();
  for (const a of accounts || []) if (a.active) set.add(a.currency);
  return [...set].sort();
}

// Accounts offered in the picker for a given entry currency: active, matching
// currency, and without a required client/partner dimension (v1 limitation).
export function accountsForCurrency(accounts, currency) {
  return (accounts || []).filter(
    (a) => a.active && a.currency === currency && !a.clientDimRequired && !a.partnerDimRequired
  );
}

export function postingBalance(lines) {
  let dr = 0, cr = 0;
  for (const l of lines || []) {
    if (l.side === "dr") dr += num(l.amount);
    else if (l.side === "cr") cr += num(l.amount);
  }
  return { dr, cr, delta: dr - cr };
}

// resolveAccount: (code) => account | null  — typically a closure over useLedger().accounts.
export function validatePostingDraft(draft, resolveAccount) {
  const errors = [];
  const d = draft || {};
  const lines = d.lines || [];

  if (!d.currency) errors.push({ code: "currency_required", field: "currency", message: "Pick a currency" });
  if (!d.reason || String(d.reason).trim().length === 0)
    errors.push({ code: "reason_required", field: "reason", message: "Reason is required" });
  if (lines.length < 2)
    errors.push({ code: "too_few_lines", field: "lines", message: "A manual entry needs at least 2 lines" });

  let nDr = 0, nCr = 0;
  for (const l of lines) {
    if (l.side !== "dr" && l.side !== "cr")
      errors.push({ code: "side_required", lineId: l.id, field: "side", message: "Pick Debit or Credit" });
    else if (l.side === "dr") nDr++; else nCr++;

    const amt = num(l.amount);
    if (!(amt > 0))
      errors.push({ code: "amount_positive", lineId: l.id, field: "amount", message: "Amount must be > 0" });

    if (!l.accountCode) {
      errors.push({ code: "account_required", lineId: l.id, field: "account", message: "Pick an account" });
    } else {
      const acc = resolveAccount(l.accountCode);
      if (!acc || !acc.active) {
        errors.push({ code: "account_unknown", lineId: l.id, field: "account", message: "Unknown or inactive account" });
      } else if (acc.currency !== d.currency) {
        errors.push({ code: "currency_mismatch", lineId: l.id, field: "account", message: "Account currency does not match the entry currency" });
      } else if (acc.clientDimRequired || acc.partnerDimRequired) {
        errors.push({ code: "dim_not_supported", lineId: l.id, field: "account", message: "Accounts with a required subconto dimension can't be posted from here yet" });
      }
    }
  }
  if (lines.length >= 2 && (nDr === 0 || nCr === 0))
    errors.push({ code: "need_dr_and_cr", field: "lines", message: "Need at least one Debit and one Credit line" });

  const { delta } = postingBalance(lines);
  if (lines.length >= 2 && Math.abs(delta) > 0.01)
    errors.push({ code: "unbalanced", field: "lines", message: "Σ Debit must equal Σ Credit" });

  return { ok: errors.length === 0, errors };
}

export function buildManualEntryPayload(draft) {
  const d = draft || {};
  const desc = (d.description || "").trim();
  const payload = {
    lines: (d.lines || []).map((l) => ({
      accountCode: l.accountCode,
      direction: l.side,
      amount: num(l.amount),
      ...(l.clientId ? { clientId: l.clientId } : {}),
      ...(l.partnerId ? { partnerId: l.partnerId } : {}),
    })),
    currencyCode: d.currency,
    reason: (d.reason || "").trim(),
    effectiveDate: d.effectiveDate,
  };
  if (desc) payload.description = desc;
  return payload;
}
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/lib/treasury/postingEntry.test.js
```

Expected: all green (~16 assertions across the describe blocks).

- [ ] **Step 3: Commit**

```bash
git add src/lib/treasury/postingEntry.js src/lib/treasury/postingEntry.test.js
git commit -m "feat(treasury): postingEntry — balance/validate/build pure module"
git push
```

---

## Phase 5 — `<AccountPicker>` component

### Task 5.1: `src/pages/treasury_v2/parts/AccountPicker.jsx` (+ test)

**Files:**
- Create: `src/pages/treasury_v2/parts/AccountPicker.jsx`
- Test: `src/pages/treasury_v2/parts/AccountPicker.test.jsx`

A small searchable `<select>`-style dropdown. Keep it simple — a text input that filters + a list, or just a native `<select>` with `<optgroup>`s if search isn't essential for v1. **Decision: native `<select>` for v1** (the chart of accounts is ~170 entries grouped by subtype — a grouped native select is fine and avoids reinventing a combobox; matches the lightweight style of `src/components/cashier/AccountInlineSelect.jsx`). The system-driven warning chip is rendered *next to* the select by the parent row, based on the selected account's subtype — but to keep `AccountPicker` self-contained, it renders the chip itself when a system-driven (but still postable) subtype is selected.

- [ ] **Step 1: Write the failing test**

Create `src/pages/treasury_v2/parts/AccountPicker.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import AccountPicker from "./AccountPicker.jsx";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a2", code: "4010", name: "Spread USD", subtype: "spread", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a4", code: "1340", name: "Treasury USDT", subtype: "crypto_input", currency: "USDT", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a5", code: "2110", name: "Customer Liab USD", subtype: "customer_liab", currency: "USD", clientDimRequired: true, partnerDimRequired: false, active: true },
];

describe("AccountPicker", () => {
  it("lists only active, currency-matching, dimension-free accounts", () => {
    render(<AccountPicker accounts={ACCOUNTS} currency="USD" value="" onChange={() => {}} />);
    expect(screen.getByRole("option", { name: /1110/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /4010/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /1340/ })).toBeNull(); // wrong currency
    expect(screen.queryByRole("option", { name: /2110/ })).toBeNull(); // requires a client dim
  });

  it("fires onChange with the picked account code", () => {
    const onChange = vi.fn();
    render(<AccountPicker accounts={ACCOUNTS} currency="USD" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "4010" } });
    expect(onChange).toHaveBeenCalledWith("4010");
  });

  it("shows the system-driven hint chip when a crypto/clearing-type account is selected", () => {
    const accts = [...ACCOUNTS, { id: "a6", code: "1316", name: "Hot USDT", subtype: "crypto_input", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true }];
    render(<AccountPicker accounts={accts} currency="USD" value="1316" onChange={() => {}} />);
    expect(screen.getByText("trv2_pm_system_account_hint")).toBeInTheDocument();
  });

  it("shows the empty-state when no accounts match", () => {
    render(<AccountPicker accounts={ACCOUNTS} currency="EUR" value="" onChange={() => {}} />);
    expect(screen.getByText("trv2_pm_no_accounts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/pages/treasury_v2/parts/AccountPicker.test.jsx
```

Expected: FAIL — cannot resolve `./AccountPicker.jsx`.

- [ ] **Step 3: Implement the component**

Create `src/pages/treasury_v2/parts/AccountPicker.jsx`:

```jsx
// src/pages/treasury_v2/parts/AccountPicker.jsx
// Native grouped <select> over postable ledger accounts for a given currency.
// "Postable" = active, currency matches, no required client/partner dimension
// (see postingEntry.accountsForCurrency). Shows an informational chip when the
// selected account is a system-driven subtype (crypto/clearing) that's usually
// moved by automated flows.
import React, { useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { accountsForCurrency, SYSTEM_DRIVEN_SUBTYPES } from "../../../lib/treasury/postingEntry.js";

export default function AccountPicker({ accounts, currency, value, onChange }) {
  const { t } = useTranslation();
  const options = useMemo(() => accountsForCurrency(accounts, currency), [accounts, currency]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const a of options) {
      const k = a.subtype || "other";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const selected = options.find((a) => a.code === value) || null;
  const showSystemHint = selected && SYSTEM_DRIVEN_SUBTYPES.has(selected.subtype);

  if (options.length === 0) {
    return <span className="text-[12px] text-slate-400">{t("trv2_pm_no_accounts")}</span>;
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[8px] px-2 py-1.5 text-[12.5px] outline-none"
      >
        <option value="">— {t("trv2_pm_col_account")} —</option>
        {groups.map(([subtype, accts]) => (
          <optgroup key={subtype} label={subtype}>
            {accts.map((a) => (
              <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {showSystemHint && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
          {t("trv2_pm_system_account_hint")}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS** + build

```bash
npx vitest run src/pages/treasury_v2/parts/AccountPicker.test.jsx
npm run build
```

Expected: tests green; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/treasury_v2/parts/AccountPicker.jsx src/pages/treasury_v2/parts/AccountPicker.test.jsx
git commit -m "feat(treasury): AccountPicker — postable-account dropdown"
git push
```

---

## Phase 6 — `<PostingTab>` editor

### Task 6.1: `src/pages/treasury_v2/tabs/PostingTab.jsx`

**Files:**
- Create: `src/pages/treasury_v2/tabs/PostingTab.jsx`

This is the editor. It gets `ctx` from `TreasuryShell` (built in Spec B: `{ accounts, balances, transactions, entries, toBase, baseCurrency, officeFilter, sinceIso, extendWindow }`) — it only needs `ctx.accounts`. Standalone state: `currency`, `effectiveDate`, `reason`, `description`, `lines`. On submit calls `rpcCreateManualEntryV2` (which already triggers `bumpDataVersion()` via `invokeLedger`). On success: `emitToast("success", t("trv2_pm_posted"))` and reset the form.

- [ ] **Step 1: Implement the component**

Create `src/pages/treasury_v2/tabs/PostingTab.jsx`:

```jsx
// src/pages/treasury_v2/tabs/PostingTab.jsx
// Posting Master — manual N-leg journal-entry editor (Spec C.1). Renders only
// when the host (TreasuryShell) decides the user has accounting:edit; it does no
// extra permission check of its own (the RPC also enforces owner/accountant).
import React, { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { rpcCreateManualEntryV2 } from "../../../lib/newLedger.js";
import {
  deriveCurrencies, postingBalance, validatePostingDraft, buildManualEntryPayload,
} from "../../../lib/treasury/postingEntry.js";
import AccountPicker from "../parts/AccountPicker.jsx";
import TransactionEntries from "../parts/TransactionEntries.jsx";

let _lineSeq = 0;
const newLine = () => ({ id: `pm${++_lineSeq}`, accountCode: "", side: "dr", amount: "" });
const todayInputValue = () => new Date().toISOString().slice(0, 10);
// DB tx_backdate_sanity allows effective_date >= created_at - 90d.
const minDateInputValue = () => new Date(Date.now() - 89 * 24 * 3600 * 1000).toISOString().slice(0, 10);

function fmtNum(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function PostingTab({ ctx }) {
  const { t } = useTranslation();
  const accounts = ctx?.accounts || [];
  const currencies = useMemo(() => deriveCurrencies(accounts), [accounts]);

  const [currency, setCurrency] = useState(() => currencies[0] || "USD");
  const [dateStr, setDateStr] = useState(todayInputValue);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState(() => [newLine(), { ...newLine(), side: "cr" }]);
  const [submitting, setSubmitting] = useState(false);

  const accByCode = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.code, a]));
    return (code) => m.get(code) || null;
  }, [accounts]);

  const draft = { currency, effectiveDate: new Date(`${dateStr}T00:00:00.000Z`).toISOString(), reason, description, lines };
  const { dr, cr, delta } = postingBalance(lines);
  const validation = validatePostingDraft(draft, accByCode);
  const lineErr = (id, field) => validation.errors.find((e) => e.lineId === id && e.field === field);

  function patchLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function setAmount(id, side, raw) {
    // a line is either Dr or Cr — typing in one column flips `side`, so the
    // other column's <input> (which reads `l.side === <other> ? l.amount : ""`) clears
    patchLine(id, { side, amount: raw });
  }
  function addLine() { setLines((ls) => [...ls, newLine()]); }
  function removeLine(id) { setLines((ls) => (ls.length <= 2 ? ls : ls.filter((l) => l.id !== id))); }

  // When the currency changes, drop any line whose account no longer matches.
  function changeCurrency(c) {
    setCurrency(c);
    setLines((ls) => ls.map((l) => {
      const a = accByCode(l.accountCode);
      return a && a.currency === c ? l : { ...l, accountCode: "" };
    }));
  }

  function resetForm() {
    _lineSeq = 0;
    setLines([newLine(), { ...newLine(), side: "cr" }]);
    setReason(""); setDescription(""); setDateStr(todayInputValue());
  }

  async function submit() {
    if (!validation.ok || submitting) return;
    setSubmitting(true);
    try {
      await rpcCreateManualEntryV2(buildManualEntryPayload(draft));
      emitToast("success", t("trv2_pm_posted"));
      resetForm();
    } catch (e) {
      const msg = String(e?.message || "");
      if (/42501|permission|authenticated|Not authenticated|role/i.test(msg)) emitToast("error", t("trv2_pm_err_forbidden"));
      else if (/balance/i.test(msg)) emitToast("error", t("trv2_pm_err_unbalanced"));
      else emitToast("error", `${t("trv2_pm_err_generic")}: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Preview rows in the TransactionEntries shape (accountCode/accountName/direction/amount/currency).
  const previewEntries = lines
    .filter((l) => l.accountCode && Number(l.amount) > 0)
    .map((l, i) => {
      const a = accByCode(l.accountCode);
      return { id: `prev${i}`, direction: l.side, amount: Number(l.amount), currency, accountCode: a?.code || l.accountCode, accountName: a?.name || "?" };
    });

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-bold">{t("trv2_pm_title")}</h2>

      <div className="bg-white border border-slate-200/70 rounded-[12px] p-4 space-y-4">
        {/* header: date + currency */}
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-[12.5px]">
            <span className="text-slate-500">{t("trv2_pm_effective_date")}</span>
            <input type="date" value={dateStr} min={minDateInputValue()} max={todayInputValue()}
              onChange={(e) => setDateStr(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1.5 outline-none" />
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <span className="text-slate-500">{t("trv2_pm_currency")}</span>
            <select value={currency} onChange={(e) => changeCurrency(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1.5 outline-none">
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {/* lines table */}
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
              <th className="text-left px-2 py-1">{t("trv2_pm_col_account")}</th>
              <th className="text-right px-2 py-1 w-32">{t("trv2_pm_col_dr")}</th>
              <th className="text-right px-2 py-1 w-32">{t("trv2_pm_col_cr")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1.5">
                  <AccountPicker accounts={accounts} currency={currency} value={l.accountCode}
                    onChange={(code) => patchLine(l.id, { accountCode: code })} />
                  {(lineErr(l.id, "account")) && <div className="text-[10px] text-rose-600 mt-0.5">{lineErr(l.id, "account").message}</div>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input inputMode="decimal" value={l.side === "dr" ? l.amount : ""}
                    onChange={(e) => setAmount(l.id, "dr", e.target.value)}
                    className={`w-28 text-right bg-slate-50 border rounded-[8px] px-2 py-1 outline-none ${l.side === "dr" && lineErr(l.id, "amount") ? "border-rose-300" : "border-slate-200"}`} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input inputMode="decimal" value={l.side === "cr" ? l.amount : ""}
                    onChange={(e) => setAmount(l.id, "cr", e.target.value)}
                    className={`w-28 text-right bg-slate-50 border rounded-[8px] px-2 py-1 outline-none ${l.side === "cr" && lineErr(l.id, "amount") ? "border-rose-300" : "border-slate-200"}`} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button type="button" title={t("trv2_pm_remove_line")} disabled={lines.length <= 2}
                    onClick={() => removeLine(l.id)}
                    className="p-1 rounded text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={addLine} className="text-[12px] text-indigo-600 hover:underline">{t("trv2_pm_add_line")}</button>

        {/* balance indicator */}
        <div className={`rounded-[10px] px-3 py-2 text-[12.5px] font-medium ${Math.abs(delta) < 0.01 && (dr > 0) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {t("trv2_pm_balance").replace("{dr}", fmtNum(dr)).replace("{cr}", fmtNum(cr)).replace("{delta}", fmtNum(delta))}
          {" — "}{Math.abs(delta) < 0.01 && dr > 0 ? t("trv2_pm_balanced") : t("trv2_pm_unbalanced")}
        </div>

        {/* reason + description */}
        <div className="space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder={t("trv2_pm_reason_ph")}
            className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-2.5 py-2 text-[12.5px] outline-none" />
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={t("trv2_pm_description")}
            className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none" />
        </div>

        {/* preview */}
        {previewEntries.length >= 2 && (
          <div className="border border-slate-100 rounded-[10px]">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">{t("trv2_pm_preview")}</div>
            <TransactionEntries entries={previewEntries} />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="button" disabled={!validation.ok || submitting} onClick={submit}
            className="px-4 py-2 rounded-[10px] text-[13px] font-semibold bg-slate-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {t("trv2_pm_post")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Note on `setAmount`: a line carries one `side` + one `amount`. Typing in the Dr column calls `setAmount(id,"dr",raw)`, which sets `side:"dr"` and `amount:raw`; the Cr `<input>` reads `l.side === "cr" ? l.amount : ""`, so it shows empty. Typing in the Cr column flips `side` to `"cr"`. That's the "either Dr or Cr, not both" behaviour with no extra clearing logic needed.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

### Task 6.2: `PostingTab` smoke + happy-path submit test

**Files:**
- Test: `src/pages/treasury_v2/tabs/PostingTab.test.jsx`

- [ ] **Step 1: Write the test**

Create `src/pages/treasury_v2/tabs/PostingTab.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const emitToastMock = vi.fn();
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: (...a) => emitToastMock(...a) }));
const rpcMock = vi.fn();
vi.mock("../../../lib/newLedger.js", () => ({ rpcCreateManualEntryV2: (...a) => rpcMock(...a) }));

import PostingTab from "./PostingTab.jsx";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a2", code: "4010", name: "Spread USD", subtype: "spread", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
];
const ctx = { accounts: ACCOUNTS };

describe("PostingTab", () => {
  beforeEach(() => { rpcMock.mockReset(); emitToastMock.mockReset(); });

  it("renders the editor with two starter lines and a disabled Post button", () => {
    render(<PostingTab ctx={ctx} />);
    expect(screen.getByText("trv2_pm_title")).toBeInTheDocument();
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    expect(post).toBeDisabled();
    // two account selects (one per starter line)
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(3); // 2 account pickers + currency
  });

  it("posts a balanced entry, toasts success, resets the form", async () => {
    rpcMock.mockResolvedValue("tx-1");
    render(<PostingTab ctx={ctx} />);
    const accountSelects = screen.getAllByRole("combobox").filter((el) => [...el.options].some((o) => /1110|4010/.test(o.value)));
    fireEvent.change(accountSelects[0], { target: { value: "1110" } });
    fireEvent.change(accountSelects[1], { target: { value: "4010" } });
    // Dr 100 on line 1, Cr 100 on line 2
    const drInputs = screen.getAllByRole("textbox").filter((el) => el.tagName === "INPUT"); // amount inputs + maybe description
    // Find the Dr/Cr amount inputs by position: each row has a Dr then a Cr input.
    const numericInputs = screen.getAllByRole("textbox").filter((el) => el.getAttribute("inputmode") === "decimal");
    fireEvent.change(numericInputs[0], { target: { value: "100" } }); // line 1 Dr
    fireEvent.change(numericInputs[3], { target: { value: "100" } }); // line 2 Cr (line idx 1 → Cr input is the 4th decimal input: [l1Dr, l1Cr, l2Dr, l2Cr])
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "manual fee" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const payload = rpcMock.mock.calls[0][0];
    expect(payload.currencyCode).toBe("USD");
    expect(payload.reason).toBe("manual fee");
    expect(payload.lines).toEqual([
      { accountCode: "1110", direction: "dr", amount: 100 },
      { accountCode: "4010", direction: "cr", amount: 100 },
    ]);
    expect(emitToastMock).toHaveBeenCalledWith("success", "trv2_pm_posted");
    // form reset → reason cleared
    await waitFor(() => expect(screen.getByPlaceholderText("trv2_pm_reason_ph").value).toBe(""));
  });

  it("maps a 42501 RPC error to the forbidden toast", async () => {
    rpcMock.mockRejectedValue(new Error("Not authenticated"));
    render(<PostingTab ctx={ctx} />);
    const accountSelects = screen.getAllByRole("combobox").filter((el) => [...el.options].some((o) => /1110|4010/.test(o.value)));
    fireEvent.change(accountSelects[0], { target: { value: "1110" } });
    fireEvent.change(accountSelects[1], { target: { value: "4010" } });
    const numericInputs = screen.getAllByRole("textbox").filter((el) => el.getAttribute("inputmode") === "decimal");
    fireEvent.change(numericInputs[0], { target: { value: "50" } });
    fireEvent.change(numericInputs[3], { target: { value: "50" } });
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "x" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(emitToastMock).toHaveBeenCalledWith("error", "trv2_pm_err_forbidden"));
  });
});
```

Note: if the `numericInputs` indexing turns out brittle in practice, switch to querying by row — `screen.getAllByRole("row")` then within each row `getAllByRole("textbox")` — but the `[l1Dr, l1Cr, l2Dr, l2Cr]` order is stable given the JSX (Dr `<input>` before Cr `<input>` in each `<tr>`).

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/pages/treasury_v2/tabs/PostingTab.test.jsx
```

Expected: 3 pass. (If the amount-input indexing fails, fix per the note above, re-run.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury_v2/tabs/PostingTab.jsx src/pages/treasury_v2/tabs/PostingTab.test.jsx
git commit -m "feat(treasury): PostingTab — manual N-leg journal-entry editor"
git push
```

---

## Phase 7 — Wire into TreasuryShell + Журнал (manual filter, reversed chip, reverse action)

### Task 7.1: Add the gated `posting` tab to `TreasuryShell`

**Files:**
- Modify: `src/pages/treasury_v2/TreasuryShell.jsx`

Context: `TreasuryShell` currently has a static `TABS` array of 5 entries and maps it for the tab bar + active panel. We add a 6th entry that's only included when `useCan()(`"accounting", "edit"`)`. `useCan` is exported from `src/store/permissions.jsx` and returns a predicate `can(section, level="view")`.

- [ ] **Step 1: Edit `TreasuryShell.jsx`**

Add the import near the other tab imports:

```jsx
import { useCan } from "../../store/permissions.jsx";
import PostingTab from "./tabs/PostingTab.jsx";
```

Change the `TABS` constant from a fixed array to a builder, and inside the component compute the visible tabs:

```jsx
const BASE_TABS = [
  { id: "assets", labelKey: "trv2_tab_assets", component: AssetsTab },
  { id: "liabilities", labelKey: "trv2_tab_liabilities", component: LiabilitiesTab },
  { id: "equity", labelKey: "trv2_tab_equity", component: EquityTab },
  { id: "pnl", labelKey: "trv2_tab_pnl", component: PnLTab },
  { id: "journal", labelKey: "trv2_tab_journal", component: JournalTab },
];
```

Inside `export default function TreasuryShell()`, after `const { t } = useTranslation();`:

```jsx
  const can = useCan();
  const canPost = can("accounting", "edit");
  const TABS = useMemo(
    () => (canPost ? [...BASE_TABS, { id: "posting", labelKey: "trv2_pm_tab", component: PostingTab }] : BASE_TABS),
    [canPost]
  );
```

Then replace the existing references: `const ActiveComp = TABS.find((x) => x.id === activeTab)?.component || AssetsTab;` stays as-is (now reads the new `TABS`); the tab-bar `.map` over `TABS` stays as-is. Make sure `useMemo` is already imported (it is). One edge: if the user is on the `posting` tab and `canPost` flips false (role change in the demo switcher), `activeTab` would point at a missing tab — the `|| AssetsTab` fallback handles the panel; also add right after the `TABS` memo:

```jsx
  // if the active tab disappeared (e.g. lost accounting:edit), fall back to assets
  React.useEffect(() => {
    if (!TABS.some((x) => x.id === activeTab)) setActiveTab("assets");
  }, [TABS, activeTab]);
```

(`activeTab`/`setActiveTab` already exist in the component. `React` is imported as the default — `React.useEffect` works; or add `useEffect` to the existing `import React, { useState, useMemo } from "react";` line and use it bare. Either is fine.)

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

### Task 7.2: Extend `TreasuryShell.test.jsx` for the gated tab

**Files:**
- Modify: `src/pages/treasury_v2/TreasuryShell.test.jsx`

Context: this file already mocks `../../i18n/translations.jsx`, `../../store/offices.jsx`, `../../store/baseCurrency.js`, `../../store/ledger.jsx`. Add a mock for `../../store/permissions.jsx` whose `useCan` returns a `can` predicate driven by a module-level flag, and a mock for `../../lib/toast.jsx` and `../../lib/newLedger.js` (PostingTab imports them, so the module graph needs them resolvable even if unused in the test).

- [ ] **Step 1: Add mocks + two tests**

At the top of `TreasuryShell.test.jsx`, alongside the existing `vi.mock` calls, add:

```jsx
let canAccountingEdit = false;
vi.mock("../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));
vi.mock("../../lib/toast.jsx", () => ({ emitToast: () => {} }));
vi.mock("../../lib/newLedger.js", () => ({ rpcCreateManualEntryV2: () => Promise.resolve("tx-x"), rpcReverseTransactionV2: () => Promise.resolve(["rev-x"]) }));
```

Then add a new `describe` block at the end of the file:

```jsx
describe("TreasuryShell — Posting Master tab gating", () => {
  it("hides the Manual-entry tab without accounting:edit", () => {
    canAccountingEdit = false;
    render(<TreasuryShell />);
    expect(screen.queryByRole("button", { name: "trv2_pm_tab" })).toBeNull();
  });
  it("shows the Manual-entry tab with accounting:edit and can open it", () => {
    canAccountingEdit = true;
    render(<TreasuryShell />);
    const tab = screen.getByRole("button", { name: "trv2_pm_tab" });
    expect(tab).toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByText("trv2_pm_title")).toBeInTheDocument();
  });
});
```

(`fireEvent` is already imported at the top of this test file.)

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/pages/treasury_v2/TreasuryShell.test.jsx
```

Expected: the existing 3 smoke tests + 2 new = 5 pass. (The earlier tests passed `<TreasuryShell />` without `canAccountingEdit` set — it defaults `false`, so the posting tab is absent there, which is fine for those assertions.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury_v2/TreasuryShell.jsx src/pages/treasury_v2/TreasuryShell.test.jsx
git commit -m "feat(treasury): wire Posting Master tab into TreasuryShell (gated by accounting:edit)"
git push
```

### Task 7.3: Журнал — `manual` filter + reversed chip + `loadLedgerTransactions` status

**Files:**
- Modify: `src/lib/ledgerReaders.js` (select `status` in `loadLedgerTransactions`, expose `status` on the mapped object)
- Modify: `src/pages/treasury_v2/tabs/JournalTab.jsx` (add `"manual"` to the `TYPES` array)
- Modify: `src/pages/treasury_v2/parts/TransactionRow.jsx` (a muted "reversed" chip when `tx.status === 'reversed'`; the "Reverse" button when `tx.source_kind === 'manual' && can("accounting","edit")` → opens `ReverseEntryModal`)

- [ ] **Step 1: `loadLedgerTransactions` — add `status`**

In `src/lib/ledgerReaders.js`, in `loadLedgerTransactions`, change the `.select(...)` to include `status`:

```js
    .select("id, effective_date, created_at, description, source_kind, source_ref_id, reverses_transaction_id, status, metadata")
```

and in the `.map(...)` add:

```js
      status: r.status || "posted",
```

- [ ] **Step 2: `JournalTab` — add the `manual` filter**

In `src/pages/treasury_v2/tabs/JournalTab.jsx`, change:

```jsx
const TYPES = ["all", "deal", "transfer", "topup", "adjustment", "reversal"];
```

to:

```jsx
const TYPES = ["all", "deal", "transfer", "topup", "adjustment", "manual", "reversal"];
```

(The `trv2_journal_type_manual` i18n key was added in Phase 1; `transactionTree`'s type filter matches `t.kind === type`, and manual entries have `source_kind='manual'` → `kind='manual'`, so this Just Works. No selector change needed.)

- [ ] **Step 3: `TransactionRow` — reversed chip + reverse action**

In `src/pages/treasury_v2/parts/TransactionRow.jsx`, add imports:

```jsx
import { useCan } from "../../../store/permissions.jsx";
import ReverseEntryModal from "./ReverseEntryModal.jsx";
```

Inside the component, add:

```jsx
  const can = useCan();
  const [reverseOpen, setReverseOpen] = useState(false);
  const isReversed = tx.status === "reversed";
  const canReverseManual = tx.source_kind === "manual" && !isReversed && can("accounting", "edit");
```

In the row header JSX, next to the existing `{isReversal && (...)}` reversal badge, add a reversed chip:

```jsx
        {isReversed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t("trv2_pm_reversed_chip")}</span>}
```

In the expanded section, after the existing "open source" block, add:

```jsx
          {canReverseManual && (
            <div className="px-6 pb-2">
              <button onClick={() => setReverseOpen(true)} className="text-[12px] text-rose-600 hover:underline">
                {t("trv2_pm_reverse")}
              </button>
            </div>
          )}
```

And render the modal at the end of the component's returned fragment (after the `{expanded && (...)}` block, still inside the outer `<div>`):

```jsx
      {reverseOpen && <ReverseEntryModal tx={tx} onClose={() => setReverseOpen(false)} />}
```

(`tx`, `t`, `useState` are already in scope in `TransactionRow`.)

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: succeeds (will fail until Task 7.4 creates `ReverseEntryModal.jsx` — if you're doing tasks strictly in order, swap 7.3 step 4 and 7.4 so the build runs after the modal exists; or just build once at the end of 7.4).

### Task 7.4: `<ReverseEntryModal>`

**Files:**
- Create: `src/pages/treasury_v2/parts/ReverseEntryModal.jsx`

- [ ] **Step 1: Implement the modal**

Create `src/pages/treasury_v2/parts/ReverseEntryModal.jsx`:

```jsx
// src/pages/treasury_v2/parts/ReverseEntryModal.jsx
// Confirm-with-reason modal for reversing a manual journal entry. Calls
// rpcReverseTransactionV2 (cascade:false) which already triggers bumpDataVersion()
// via invokeLedger, so the Журнал refreshes on its own.
import React, { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { rpcReverseTransactionV2 } from "../../../lib/newLedger.js";

export default function ReverseEntryModal({ tx, onClose }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length > 0;

  async function confirm() {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await rpcReverseTransactionV2({ targetTxId: tx.id, reason: reason.trim(), cascade: false });
      emitToast("success", t("trv2_pm_reverse_done"));
      onClose();
    } catch (e) {
      const msg = String(e?.message || "");
      if (/42501|permission|authenticated|role/i.test(msg)) emitToast("error", t("trv2_pm_err_forbidden"));
      else emitToast("error", `${t("trv2_pm_err_generic")}: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-[14px] max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[14px] font-bold">{t("trv2_pm_reverse_title")}</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </header>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-slate-500">{tx.description || tx.id}</p>
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder={t("trv2_pm_reverse_reason_ph")}
            className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-2.5 py-2 text-[12.5px] outline-none" />
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-[8px] text-[12.5px] text-slate-600 hover:bg-slate-100">{t("trv2_pm_reverse_cancel")}</button>
            <button onClick={confirm} disabled={!ok || busy}
              className="px-3 py-1.5 rounded-[8px] text-[12.5px] font-semibold bg-rose-600 text-white disabled:opacity-40">
              {t("trv2_pm_reverse_confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + test suite**

```bash
npm run build
npx vitest run --no-file-parallelism
```

Expected: build clean; all tests green (the `TreasuryShell.test.jsx` mocks now also cover `rpcReverseTransactionV2` via the `newLedger.js` mock added in Task 7.2; `TransactionRow` is exercised through `TreasuryShell.test.jsx`'s journal-tab smoke, which doesn't open the reverse modal — fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ledgerReaders.js src/pages/treasury_v2/tabs/JournalTab.jsx src/pages/treasury_v2/parts/TransactionRow.jsx src/pages/treasury_v2/parts/ReverseEntryModal.jsx
git commit -m "feat(treasury): Журнал — manual filter, reversed chip, reverse-entry modal"
git push
```

---

## Phase 8 — Final integration + PR

### Task 8.1: Full suite + build + local smoke

**Files:** none.

- [ ] **Step 1: Full test suite**

```bash
npx vitest run --no-file-parallelism
```

Expected: all green. New files since baseline: `newLedger.manualEntry.test.js` (3), `treasury/postingEntry.test.js` (~16 assertions), `AccountPicker.test.jsx` (4), `PostingTab.test.jsx` (3), `TreasuryShell.test.jsx` (+2). Totals only increase from the baseline.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: succeeds; gzip bundle delta should be small (a few KB).

- [ ] **Step 3: Local smoke (manual — note in the PR if skipped)**

`npm run dev`, open `http://localhost:5173` as an owner/accountant, go to Казначейство → there should be a 6th tab "Ручная проводка". Add lines, pick accounts, enter Dr/Cr, see the balance Δ go to 0, fill a reason, Post → success toast, the entry appears in the Журнал tab (filter type "Ручные"), expand it → "Сторнировать" → reason → reversed; the original shows a "сторнирована" chip and a `↺` reverse-tx appears. Switch the demo user to a `manager` → the tab disappears.

- [ ] **Step 4: Commit any stragglers** (e.g. if a test tweak was needed)

```bash
git add -A && git commit -m "test(treasury): posting-master test fixups" && git push
```

(Skip if the working tree is clean.)

### Task 8.2: Open the PR

**Files:** none.

- [ ] **Step 1: Open PR via gh**

```bash
gh pr create --base main --head feat/posting-master --title "feat(treasury): Posting Master — manual N-leg journal entry editor (Spec C.1)" --body "$(cat <<'EOF'
## Summary
Adds a manual N-leg journal-entry editor ("Posting Master") as a 6th, permission-gated tab in the Treasury section (Spec C.1, builds on the Spec B Treasury shipped in #25).

- New `ledger.create_manual_entry` RPC + `public.create_manual_entry` wrapper — N balanced Dr/Cr lines, single currency, owner/accountant-only (server-side `_require_role`), one `ledger.transactions` (`source_kind='manual'`) + N `journal_entries` + a `warn` audit_alert per entry.
- `rpcCreateManualEntryV2` JS wrapper; `src/lib/treasury/postingEntry.js` pure module (balance math + validation + payload build).
- `PostingTab` editor (lines table, account picker, live Σ Dr − Σ Cr = Δ indicator, Dr/Cr preview), gated by `can("accounting","edit")` — visible to owner & accountant.
- `AccountPicker` (postable-account dropdown — active, currency-matching, no required subconto dim), `ReverseEntryModal` (reverse a manual entry with a reason, `cascade:false`).
- Журнал: new "Manual" type filter, a "сторнирована" chip on reversed transactions (`loadLedgerTransactions` now reads `status`), and a "Сторнировать" action on manual entries.
- i18n `trv2_pm_*` + `trv2_journal_type_manual` (en/ru/tr).

## Test plan
- [x] Full test suite green (new: rpcCreateManualEntryV2 3, postingEntry ~16, AccountPicker 4, PostingTab 3, TreasuryShell +2)
- [x] `npm run build` clean
- [ ] Local smoke as owner/accountant: 6th tab renders, balanced entry posts, appears in Журнал, reverse works, tab hidden for `manager`

## Out of scope (Spec C.2+)
Templates/typical-operation wizard; multi-currency entries; per-line subconto/counterparty picker (accounts with a required dim aren't postable from the v1 UI); draft documents (unpost/repost); period close; bulk import; reversing non-`manual` transactions from the UI.

Spec: `docs/superpowers/specs/2026-05-10-posting-master-design.md`
Plan: `docs/superpowers/plans/2026-05-10-posting-master.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the PR URL.

---

## Self-review checklist (run before declaring the plan complete)

**Spec coverage:**
- ✅ New `ledger.create_manual_entry` RPC (N-leg, single-currency, balanced, owner/accountant-only, audit alert) → Task 2.1
- ✅ `public.create_manual_entry` wrapper granted to `authenticated` → Task 2.1
- ✅ `rpcCreateManualEntryV2` JS wrapper → Task 3.1
- ✅ Pure validator / payload builder / balance math → Tasks 4.1–4.2
- ✅ `PostingTab` editor (lines table, account picker, balance Δ, reason/desc, preview, submit→RPC→toast→reset) → Tasks 6.1–6.2
- ✅ `AccountPicker` (active + currency-matching + no required dim; system-subtype chip) → Task 5.1
- ✅ New tab in `TreasuryShell` gated by `can("accounting","edit")` → Task 7.1
- ✅ Журнал `manual` type filter → Task 7.3
- ✅ Reverse a manual entry from Журнал + reversed chip → Tasks 7.3–7.4
- ✅ i18n `trv2_pm_*` + `trv2_journal_type_manual` (en/ru/tr) → Task 1.1
- ✅ Tests: pure module, AccountPicker, PostingTab smoke+submit, TreasuryShell gating extension → Tasks 4, 5, 6, 7.2
- ✅ Backdate window matches DB `tx_backdate_sanity` (date picker `min` = today−89d) → Task 6.1
- ⏸ Templates / multi-currency / subconto picker / drafts / period close — deferred (noted in Out of scope & the PR body)

**Type/name consistency:** `rpcCreateManualEntryV2` (Tasks 3.1, 6.1, 6.2, 7.2 mock); `validatePostingDraft` / `buildManualEntryPayload` / `postingBalance` / `deriveCurrencies` / `accountsForCurrency` / `SYSTEM_DRIVEN_SUBTYPES` (Tasks 4.1/4.2 ↔ 5.1 ↔ 6.1); draft shape `{ currency, effectiveDate, reason, description, lines:[{id,accountCode,side,amount}] }` consistent across 4 & 6; account shape `{ code, name, subtype, currency, clientDimRequired, partnerDimRequired, active }` matches `ledgerReaders.loadLedgerAccounts`'s output; `ReverseEntryModal` (Tasks 7.3 import ↔ 7.4 create); `useCan` predicate signature `(section, level)` consistent (7.1, 7.2, 7.3).

**Placeholder scan:** none — every code step has full code; every command has expected output.

## Execution Handoff

(See the skill's handoff prompt — choose subagent-driven or inline execution before starting Phase 0.)
