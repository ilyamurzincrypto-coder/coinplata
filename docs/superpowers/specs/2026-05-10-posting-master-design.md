# Posting Master — Design (Spec C.1)

**Date:** 2026-05-10
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** Spec B (Treasury & P&L on journal entries) — shipped, PR #25 on `main`. Posting Master adds a new tab to the `TreasuryShell` built there and writes into the same `ledger.*` schema.

## Overview

A manual N-leg journal-entry editor inside the Treasury section — the read-write counterpart to the read-only Treasury tabs (Активы / Пассивы / Капитал / P&L / Журнал). It covers postings the automated flows (cashier deals, top-ups, transfers) don't, and that today require either a service-role-only call to the 2-leg `ledger.create_adjustment` or a database script: corrections, reclassifications, accruals, manual fees / write-offs, manual opening balances.

Out of an entry the user gets one `ledger.transactions` row (`source_kind='manual'`) plus N balanced `ledger.journal_entries`, exactly like every other transaction in the v2 ledger — so it shows up in the Журнал tab, contributes to balances and P&L, and is reversible.

This is "Posting Master / Конструктор проводок" in the Crassula/1C sense, scoped to v1: a raw, balanced, single-currency, N-leg entry editor. Templates / typical-operation wizards, multi-currency entries, draft documents, and period close are explicitly deferred (see Out of scope).

## Permissions / authorization

Reuse what already exists in the project — no new permission section, no new server-side authz mechanism.

**Client (`src/store/permissions.jsx`):** the `accounting` section already exists (currently gates the legacy "accounting review" feed). Defaults: `owner` = `edit`, `accountant` = `edit`, `admin` = `view`, `manager` = `disabled`. The Posting Master tab and the "Сторнировать" action render only when `can("accounting", "edit")` → visible to owner and accountant.

**Server:** follow the established `public.f_role()` pattern (used by `accounting_review`, the rate-override RPCs, user-management RPCs). The new `ledger.create_manual_entry` checks `public.f_role() IN ('owner','accountant')` near the top and `RAISE EXCEPTION ... USING ERRCODE = '42501'` (insufficient_privilege) otherwise. The `public.create_manual_entry` wrapper is `GRANT EXECUTE ... TO authenticated` (consistent with the other `public.*` v2 wrappers — the real authz is the `f_role()` check inside, not the grant). Every successful posting writes a `ledger.audit_alerts` row at level `warn` and stamps `transactions.created_by = auth.uid()`.

Rationale: manual journal posting is the single most sensitive mutation in the system (it can move money between any two accounts), so it belongs in the same authz tier as the project's other admin RPCs — not in the "granted to authenticated, client-only authz" tier the v2 cashier RPCs use.

## New RPC: `ledger.create_manual_entry`

Plus a thin `public.create_manual_entry` SECURITY DEFINER wrapper (mirrors the existing pattern in `direction2_3_public_wrappers_for_v2_rpcs.sql`).

**Signature:**

```
ledger.create_manual_entry(
  p_idempotency_key uuid,
  p_request_hash    text,
  p_lines           jsonb,    -- [{ account_code, direction:'dr'|'cr', amount, client_id?, partner_id? }, ...]
  p_currency_code   text,
  p_reason          text,
  p_effective_date  timestamptz DEFAULT now(),
  p_description     text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid   -- tx_id
```

**Validation order** (after idempotency-key lookup, before any write):

1. `f_role()` ∈ (`owner`, `accountant`) — else `42501`.
2. `p_currency_code` exists in `ledger.currencies` (catches typos) — else `P0002`.
3. `p_reason` non-empty (audit trail) — else `22000`.
4. `p_lines` is a non-empty array with ≥ 2 elements — else `22000`.
5. For each line: `amount` is numeric and `> 0` — else `22000`.
6. For each line: account with that `code` exists, is `active`, and `currency_code = p_currency_code` — else `P0002` / `22000` (currency mismatch).
7. For each line: if the account's `client_dim_required` is true, `client_id` must be present; same for `partner_dim_required` / `partner_id`. (Defense in depth — the v1 UI never offers such accounts; see Frontend.)
8. Σ(amount where direction='dr') = Σ(amount where direction='cr') within 0.01 — else `22000` ("entry does not balance: Dr {x} ≠ Cr {y}").
9. At least one `dr` line and at least one `cr` line — else `22000`.

**On success:**

- `INSERT INTO ledger.transactions (id, idempotency_key, effective_date, created_by, description, source_kind, source_ref_id, metadata)` — `source_kind='manual'`, `created_by=auth.uid()`, `source_ref_id=NULL`, `description = COALESCE(p_description, 'Manual entry: ' || p_reason)`, `metadata = COALESCE(p_metadata,'{}') || jsonb_build_object('reason', p_reason, 'line_count', count)`.
- `INSERT INTO ledger.journal_entries` one row per line — `direction`, `amount`, `currency_code = p_currency_code`, `client_id`, `partner_id`, `note = 'Manual: ' || p_reason`.
- `INSERT INTO ledger.audit_alerts (level, source, message, payload)` — `level='warn'`, `source='rpc.create_manual_entry'`, payload includes tx_id, lines, currency, reason, created_by.
- Save the idempotency key.

**Constraints:**

- Single currency per entry. Multi-currency manual entries are deferred — a cross-currency reclassification is done either with an explicit FX gain/loss leg in the same currency, or as two separate manual entries.
- `p_effective_date` defaults to `now()`. The DB already enforces `tx_backdate_sanity` (`effective_date >= created_at - 90 days` unless `metadata.allow_deep_backdate` is true) and `tx_forwarddate_sanity` (`effective_date <= created_at + 24h`), so the editor's date picker is limited to `[today − 90 days, today]`; deep backdating is out of scope for v1.
- `ledger.transactions.source_kind` is a free-text column (no CHECK constraint), so `'manual'` needs no schema change.

Migrations are applied directly via the Supabase MCP `apply_migration` tool (per project workflow), then also committed as files under `supabase/migrations/`.

## JS wrapper

`rpcCreateManualEntryV2(payload)` added to `src/lib/newLedger.js`, following the existing wrapper pattern: generate `newIdempotencyKey()`, compute `requestHash({...payload, idempotencyKey: undefined})`, build the `p_*` params, call `invokeLedger("create_manual_entry", params)`, return the `uuid`. Payload shape: `{ lines: [{accountCode, direction, amount, clientId?, partnerId?}], currencyCode, reason, effectiveDate?, description?, metadata?, idempotencyKey? }`.

It is **not** routed through `newLedgerAdapter` — there is no legacy equivalent — and is called directly from the Posting Master component (the same way the `operations.*` workflow RPCs are called directly from the obligations widget).

## Frontend

### New tab in `TreasuryShell`

Add `{ id: "posting", labelKey: "trv2_pm_tab", component: PostingTab }` to the `TABS` array, positioned last (after `journal`). The tab button and panel render only when `can("accounting", "edit")` — `TreasuryShell` reads `useCan()` and filters `TABS` accordingly. (The Treasury page itself is already gated by `canShow("capital")` for view access; the Posting Master tab is the only edit surface and is further gated by `accounting:edit`.)

### `src/pages/treasury_v2/tabs/PostingTab.jsx` — the editor

- **Header bar:** effective-date picker (default = today), single currency selector (applies to all lines; changing it clears line accounts that no longer match).
- **Lines table:** each row = `[ account picker | Dr amount | Cr amount | × remove ]`.
  - A line is either Dr or Cr, not both — entering a value in one column clears the other.
  - "+ Добавить строку" button; minimum 2 lines (remove disabled at 2).
- **Account picker (`src/pages/treasury_v2/parts/AccountPicker.jsx`, new):** searchable dropdown over `useLedger().accounts` filtered to `currency === selectedCurrency && active && !client_dim_required && !partner_dim_required`, showing `code · name · subtype`. Accounts with a required subconto dimension (`customer_liab` / `partner_liab` accounts) are **not selectable in v1** — they're driven by automated flows, and a per-line counterparty picker is deferred to Spec C.2 (subconto). A soft amber chip ("обычно ведётся автоматически") is shown on the remaining system-driven subtypes — `clearing`, `fx_clearing`, `crypto_input`, `crypto_output` — informational only, does not block selection. (`AccountSelect.jsx` in the cashier is for legacy `public.accounts`; this is a fresh small component for `ledger.accounts`.)
- **Live balance indicator:** `Σ Dr {x} − Σ Cr {y} = Δ {z}`, green ✓ when Δ = 0, amber otherwise. (Same spirit as DealForm's `computeRemaining` readout.)
- **Reason** textarea — required. **Description** — optional.
- **"Предпросмотр Dr/Cr":** renders the current lines using the existing `TransactionEntries.jsx` component (or a lightweight inline equivalent) so the user sees exactly what will be posted.
- **Submit** — disabled until: balanced (Δ=0), reason non-empty, ≥1 dr and ≥1 cr line, every line valid (account chosen, positive amount). On click → `rpcCreateManualEntryV2(...)`:
  - success → success toast, `bumpDataVersion()` (so the Журнал and balance-sheet tabs refresh via the existing `onDataBump` mechanism), reset the form.
  - error → map the RPC error to a friendly message (reuse the approach from `src/lib/dealForm/errorMapper.js` if it generalizes; otherwise an inline mapping for the `42501` / `P0002` / `22000` cases).

### Reverse a manual entry from Журнал

In the existing `src/pages/treasury_v2/parts/TransactionRow.jsx`: when `tx.source_kind === 'manual'` **and** `can("accounting", "edit")`, show a "Сторнировать" button in the expanded row. It opens a small modal asking for a reason, then calls `rpcReverseTransactionV2({ targetTxId: tx.id, reason, cascade: false })` and `bumpDataVersion()`. Only `manual` transactions are reversible from the UI in v1 (deals are edited/reversed through the cashier flow, as today).

## i18n

New `trv2_pm_*` keys in `src/i18n/translations.jsx` (en / ru / tr): tab label, "add line" / "remove line", Dr / Cr column headers, account, reason, description, currency, effective date, balance Δ readout, submit button, the system-driven-subtype warning chip, success toast, error messages (auth denied / unknown currency / does-not-balance / generic), "Сторнировать" + the reverse-reason modal labels. Plus `trv2_journal_type_manual` and add `'manual'` to the `TYPES` array in `JournalTab.jsx` so the Журнал type filter has a "Manual entries" button.

## Testing

Following the repo's pattern (JS tests against fixtures; no pgTAP):

- **Client-side payload builder / validator** (`src/pages/treasury_v2/postingEntry.js` or similar — the pure function that turns form state into `p_lines` and runs the pre-flight checks): ~8–10 cases — balanced vs unbalanced, missing reason, < 2 lines, zero / negative amount, currency mismatch caught client-side, required client/partner dim, multiple Dr + multiple Cr balances, all-Dr (no Cr) rejected. Modelled on `src/lib/dealForm/validateTx.test.js`.
- **`PostingTab` render smoke** + a happy-path submit of a balanced entry with `rpcCreateManualEntryV2` mocked (modelled on `src/components/cashier/widgets/OpenObligationsWidget.test.jsx` — `vi.mock` the store hooks).
- **`TreasuryShell.test.jsx` extension:** the Posting Master tab renders when `can("accounting","edit")` is mocked `true`, and is absent when `false`.
- **`AccountPicker`** — filter-by-currency / search / system-subtype chip render test.

## Out of scope (deferred — Spec C.2+)

- **Templates / typical-operation wizard** ("Мастер" in the full 1C sense — pick "office rent payment" and get pre-filled legs). v1 is a raw editor only.
- **Multi-currency entries** — single currency per entry in v1.
- **Per-line subconto / counterparty picker** — accounts with a required client/partner dimension aren't postable from the v1 UI; the picker is Spec C.2.
- **Draft documents** (save unposted, post / unpost later, repost). v1 posts immediately; the undo is `reverse_transaction`.
- **Period close** — no concept in v2 yet; backdating is unrestricted.
- **Bulk import** of journal entries (CSV / paste).
- **Reversing deals (or any non-`manual` transaction) from the UI** — deals are handled by the cashier edit flow.
- **Шахматка / subconto-drill / forecast / payment calendar** — separate Spec C items.

## References

- Spec B: `docs/superpowers/specs/2026-05-10-treasury-pnl-on-journal-entries-design.md` (foreshadows this: "A future spec for 'Posting Master' / manual journal entries would introduce [an `accounting:edit` level]").
- Existing 2-leg adjustment RPC: `supabase/migrations/direction2_2_3_create_adjustment.sql` (the closest prior art; this RPC is its N-leg, owner/accountant-callable sibling).
- Public wrapper pattern: `supabase/migrations/direction2_3_public_wrappers_for_v2_rpcs.sql`.
- JS RPC-wrapper pattern: `src/lib/newLedger.js`.
- `f_role()` authz pattern: `supabase/migrations/0001_init.sql` (definition), `0021_office_rate_overrides.sql` / `0086_accounting_audits.sql` (usage).
- Project direction memory: v2 ledger is the product; owner wants Crassula-depth accounting tools.
