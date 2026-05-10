// src/lib/ledgerReaders.js
// Read-only queries for the `ledger.*` schema (chart of accounts, balances,
// transactions, journal entries). Used exclusively by the Treasury section.
// Mirror of supabaseReaders.js but for the v2 double-entry tables.

import { supabase, isSupabaseConfigured } from "./supabase.js";

function ledger() {
  // PostgREST exposes ledger.* tables when the schema is added to the
  // exposed-schemas config. supabase-js: .schema('ledger').from('table').
  return supabase.schema("ledger");
}

export async function loadLedgerAccounts() {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await ledger()
    .from("accounts")
    .select("id, code, name, type, subtype, currency_code, custody_type, provider, office_id, parent_account_id, client_dim_required, partner_dim_required, allow_negative, active");
  if (error) throw new Error(`loadLedgerAccounts: ${error.message}`);
  return (data || []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    subtype: r.subtype || null,
    currency: r.currency_code,
    custodyType: r.custody_type || null,
    provider: r.provider || null,
    officeId: r.office_id || null,
    parentAccountId: r.parent_account_id || null,
    clientDimRequired: r.client_dim_required === true,
    partnerDimRequired: r.partner_dim_required === true,
    allowNegative: r.allow_negative === true,
    active: r.active === true,
  }));
}

export async function loadLedgerBalances() {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await ledger()
    .from("balances")
    .select("account_id, currency_code, client_id, partner_id, balance");
  if (error) throw new Error(`loadLedgerBalances: ${error.message}`);
  return (data || []).map((r) => ({
    accountId: r.account_id,
    currency: r.currency_code,
    clientId: r.client_id || null,
    partnerId: r.partner_id || null,
    balance: Number(r.balance) || 0,
  }));
}

// opts: { sinceIso?: string }  — load transactions effective_date >= since (default: 90d ago)
export async function loadLedgerTransactions(opts = {}) {
  if (!isSupabaseConfigured) return [];
  const since = opts.sinceIso || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await ledger()
    .from("transactions")
    .select("id, effective_date, created_at, description, source_kind, source_ref_id, reverses_transaction_id, metadata")
    .gte("effective_date", since)
    .order("effective_date", { ascending: false });
  if (error) throw new Error(`loadLedgerTransactions: ${error.message}`);
  return (data || []).map((r) => ({
    id: r.id,
    effectiveDate: r.effective_date,
    createdAt: r.created_at,
    description: r.description || "",
    kind: r.source_kind || "unknown",
    sourceRefId: r.source_ref_id || null,
    reversesTransactionId: r.reverses_transaction_id || null,
    metadata: r.metadata || {},
  }));
}

// opts: { sinceIso?: string }  — entries from transactions effective_date >= since
export async function loadJournalEntries(opts = {}) {
  if (!isSupabaseConfigured) return [];
  const since = opts.sinceIso || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await ledger()
    .from("journal_entries")
    .select("id, transaction_id, account_id, direction, amount, currency_code, client_id, partner_id, note, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`loadJournalEntries: ${error.message}`);
  return (data || []).map((r) => ({
    id: r.id,
    transactionId: r.transaction_id,
    accountId: r.account_id,
    direction: r.direction, // 'dr' | 'cr'
    amount: Number(r.amount) || 0,
    currency: r.currency_code,
    clientId: r.client_id || null,
    partnerId: r.partner_id || null,
    note: r.note || "",
    createdAt: r.created_at,
  }));
}
