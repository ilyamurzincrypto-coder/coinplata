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

// Клиент отдаётся ГЕТТЕРОМ из hoisted-холдера, а не пересобирается через
// resetModules + doMock в каждом тесте. Прежняя схема зависела от порядка
// загрузки модулей: hoisted-мок подставлял supabase: null, и если
// ledgerReaders.js успевал импортироваться раньше, чем срабатывал doMock,
// первый тест падал на `supabase.schema` of null. Ловилось только при
// определённом составе прогона — то есть тест был бомбой замедленного
// действия, а не рабочей проверкой. Геттер снимает гонку: loaders читают
// holder.client в момент вызова.
const holder = vi.hoisted(() => ({ client: null }));

vi.mock("./supabase.js", () => ({
  get supabase() {
    return holder.client;
  },
  isSupabaseConfigured: true,
}));

const { loadLedgerAccounts, loadLedgerBalances, loadLedgerTransactions, loadJournalEntries } =
  await import("./ledgerReaders.js");

describe("ledgerReaders", () => {
  beforeEach(() => {
    holder.client = null;
  });

  it("loadLedgerAccounts maps rows to camelCase shape", async () => {
    holder.client = makeSupabaseMock({
      accounts: [
        { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency_code: "USD", office_id: "o1", client_dim_required: false, partner_dim_required: false, active: true },
      ],
    });
    const out = await loadLedgerAccounts();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "o1" });
  });

  it("loadLedgerBalances maps balance rows", async () => {
    holder.client = makeSupabaseMock({
      balances: [
        { account_id: "a1", currency_code: "USD", client_id: null, partner_id: null, balance: "11000.0" },
      ],
    });
    const out = await loadLedgerBalances();
    expect(out[0]).toMatchObject({ accountId: "a1", currency: "USD", clientId: null, partnerId: null, balance: 11000 });
  });

  it("loadLedgerTransactions maps tx headers", async () => {
    holder.client = makeSupabaseMock({
      transactions: [
        { id: "tx1", effective_date: "2026-05-10T00:00:00Z", created_at: "2026-05-10T14:32:00Z", description: "deal", source_kind: "deal", source_ref_id: "deal-42", reverses_transaction_id: null, metadata: {} },
      ],
    });
    const out = await loadLedgerTransactions();
    expect(out[0]).toMatchObject({ id: "tx1", kind: "deal", sourceRefId: "deal-42", reversesTransactionId: null });
  });

  it("loadJournalEntries maps entry rows", async () => {
    holder.client = makeSupabaseMock({
      journal_entries: [
        { id: "je1", transaction_id: "tx1", account_id: "a1", direction: "dr", amount: "1000.0", currency_code: "USD", client_id: null, partner_id: null, note: "x", created_at: "2026-05-10T14:32:00Z" },
      ],
    });
    const out = await loadJournalEntries();
    expect(out[0]).toMatchObject({ id: "je1", transactionId: "tx1", accountId: "a1", direction: "dr", amount: 1000, currency: "USD" });
  });
});
