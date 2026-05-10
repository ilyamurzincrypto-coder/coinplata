import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client. Each loader calls supabase.schema('ledger').from(X).select(...)
function makeSupabaseMock(rowsByTable) {
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation((table) => {
      const rows = rowsByTable[table] || [];
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return chain;
    }),
  };
}

vi.mock("./supabase.js", () => ({
  supabase: null, // overridden per-test via vi.doMock
  isSupabaseConfigured: true,
}));

describe("ledgerReaders", () => {
  it("loadLedgerAccounts maps rows to camelCase shape", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        accounts: [
          { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency_code: "USD", office_id: "o1", client_dim_required: false, partner_dim_required: false, active: true },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadLedgerAccounts } = await import("./ledgerReaders.js");
    const out = await loadLedgerAccounts();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "o1" });
  });

  it("loadLedgerBalances maps balance rows", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        balances: [
          { account_id: "a1", currency_code: "USD", client_id: null, partner_id: null, balance: "11000.0" },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadLedgerBalances } = await import("./ledgerReaders.js");
    const out = await loadLedgerBalances();
    expect(out[0]).toMatchObject({ accountId: "a1", currency: "USD", clientId: null, partnerId: null, balance: 11000 });
  });

  it("loadLedgerTransactions maps tx headers", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        transactions: [
          { id: "tx1", effective_date: "2026-05-10T00:00:00Z", created_at: "2026-05-10T14:32:00Z", description: "deal", source_kind: "deal", source_ref_id: "deal-42", reverses_transaction_id: null, metadata: {} },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadLedgerTransactions } = await import("./ledgerReaders.js");
    const out = await loadLedgerTransactions();
    expect(out[0]).toMatchObject({ id: "tx1", kind: "deal", sourceRefId: "deal-42", reversesTransactionId: null });
  });

  it("loadJournalEntries maps entry rows", async () => {
    vi.resetModules();
    vi.doMock("./supabase.js", () => ({
      supabase: makeSupabaseMock({
        journal_entries: [
          { id: "je1", transaction_id: "tx1", account_id: "a1", direction: "dr", amount: "1000.0", currency_code: "USD", client_id: null, partner_id: null, note: "x", created_at: "2026-05-10T14:32:00Z" },
        ],
      }),
      isSupabaseConfigured: true,
    }));
    const { loadJournalEntries } = await import("./ledgerReaders.js");
    const out = await loadJournalEntries();
    expect(out[0]).toMatchObject({ id: "je1", transactionId: "tx1", accountId: "a1", direction: "dr", amount: 1000, currency: "USD" });
  });
});
