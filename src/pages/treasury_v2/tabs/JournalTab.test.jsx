import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const exportCSVMock = vi.fn();
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVMock(...a) }));
// PeriodPicker is unrelated to the counterparty-filter behaviour we're testing here;
// stub it so a wide "all-time" window is used and the test isn't time-sensitive.
vi.mock("../PeriodPicker.jsx", () => ({
  __esModule: true,
  default: () => null,
  presetWindow: () => ({ from: "1970-01-01T00:00:00Z", to: "2999-12-31T00:00:00Z" }),
}));
// TransactionRow reaches into useAuth/useCan via PermissionsProvider — out of scope
// for these filter tests. Stub it with a thin row that emits a known test id we can
// count.
vi.mock("../parts/TransactionRow.jsx", () => ({
  __esModule: true,
  default: ({ node }) => <div data-testid="tx-row">{node.tx.id}</div>,
}));
// Modal renders via a portal — keep it inline so we can assert on its children.
vi.mock("../../../components/ui/Modal.jsx", () => ({
  __esModule: true,
  default: ({ open, title, children }) => (open ? <div data-testid="modal" data-title={title}>{children}</div> : null),
}));
// PostingTab is exercised by its own test; here we just need a marker + a way to
// trigger its onDone callback.
vi.mock("./PostingTab.jsx", () => ({
  __esModule: true,
  default: ({ onDone }) => <button data-testid="posting-tab" onClick={() => onDone?.()}>posting-tab</button>,
}));

let canAccountingEdit = true;
vi.mock("../../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));

import JournalTab from "./JournalTab.jsx";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "a2", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null, clientDimRequired: true },
];
const TRANSACTIONS = [
  { id: "tx_a", effectiveDate: "2026-05-01T00:00:00Z", kind: "deal", sourceRefId: null, reversesTransactionId: null, metadata: {} },
  { id: "tx_b", effectiveDate: "2026-05-02T00:00:00Z", kind: "deal", sourceRefId: null, reversesTransactionId: null, metadata: {} },
];
const ENTRIES = [
  { id: "e1", transactionId: "tx_a", accountId: "a1", direction: "dr", amount: 100, currency: "USD", clientId: null, partnerId: null },
  { id: "e2", transactionId: "tx_a", accountId: "a2", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null },
  { id: "e3", transactionId: "tx_b", accountId: "a1", direction: "dr", amount: 50, currency: "USD", clientId: null, partnerId: null },
  { id: "e4", transactionId: "tx_b", accountId: "a2", direction: "cr", amount: 50, currency: "USD", clientId: "client-2", partnerId: null },
];

const ctx = {
  accounts: ACCOUNTS,
  transactions: TRANSACTIONS,
  entries: ENTRIES,
  balances: [],
  baseCurrency: "USD",
  toBase: (n) => n,
  sinceIso: "1970-01-01T00:00:00Z",
  extendWindow: () => {},
  counterpartyName: (id) => ({ "client-1": "Иван Петров", "client-2": "Алексей Сидоров" }[id] || id),
  counterpartyOptions: (k) => k === "client"
    ? [{ id: "client-1", name: "Иван Петров" }, { id: "client-2", name: "Алексей Сидоров" }]
    : [{ id: "p1", name: "OTC Acme" }],
};

describe("JournalTab", () => {
  it("renders both transactions when no counterparty filter is active", () => {
    render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
  });

  it("Export CSV emits one row per journal_entry for the currently-filtered tree", () => {
    exportCSVMock.mockReset();
    render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_journal_export_csv" }));
    expect(exportCSVMock).toHaveBeenCalledTimes(1);
    const call = exportCSVMock.mock.calls[0][0];
    // 2 transactions × 2 entries each = 4 rows.
    expect(call.rows).toHaveLength(4);
    // Columns include the audit-trail essentials.
    const cols = call.columns.map((c) => c.key);
    expect(cols).toEqual(expect.arrayContaining(["tx_id", "side", "account_code", "amount", "currency", "client_id"]));
    // Σ ids include both transactions.
    expect(new Set(call.rows.map((r) => r.tx_id))).toEqual(new Set(["tx_a", "tx_b"]));
    // Dt/Кт labels are rendered (no English "dr"/"cr" leaks).
    expect(new Set(call.rows.map((r) => r.side))).toEqual(new Set(["Дт", "Кт"]));
  });

  it("counterparty picker filters the tree to only transactions touching the chosen client", () => {
    render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
    // Open the counterparty picker and pick "Иван Петров (client)".
    fireEvent.click(screen.getByRole("button", { name: /trv2_journal_filter_cp_any/ }));
    fireEvent.click(screen.getByText(/Иван Петров/));
    // tx_a touches client-1 → kept; tx_b touches client-2 → filtered out.
    const rows = screen.getAllByTestId("tx-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("tx_a");
    // Clearing brings both back.
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
  });

  it("free-text search filters the tree (debounced); a no-match query shows the search empty state", () => {
    vi.useFakeTimers();
    try {
      render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
      const input = screen.getByPlaceholderText("trv2_search_placeholder");
      // search by account name "Cash" — both tx touch account 1110 "Cash USD"
      fireEvent.change(input, { target: { value: "cash" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
      // search by counterparty name resolved via ctx.counterpartyName
      fireEvent.change(input, { target: { value: "иван" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getAllByTestId("tx-row").map((r) => r.textContent)).toEqual(["tx_a"]);
      // search by a transaction id
      fireEvent.change(input, { target: { value: "tx_b" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getAllByTestId("tx-row").map((r) => r.textContent)).toEqual(["tx_b"]);
      // no match → distinct empty state
      fireEvent.change(input, { target: { value: "zzz-nope" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.queryAllByTestId("tx-row")).toHaveLength(0);
      expect(screen.getByText("trv2_search_no_results")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("'+ Ручная проводка' button is hidden without accounting:edit", () => {
    canAccountingEdit = false;
    render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
    expect(screen.queryByRole("button", { name: "trv2_journal_new_manual" })).toBeNull();
    canAccountingEdit = true;
  });

  it("'+ Ручная проводка' opens the PostingTab in a modal; PostingTab.onDone closes it", () => {
    canAccountingEdit = true;
    render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
    const btn = screen.getByRole("button", { name: "trv2_journal_new_manual" });
    expect(screen.queryByTestId("modal")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId("modal")).toHaveAttribute("data-title", "trv2_pm_title");
    expect(screen.getByTestId("posting-tab")).toBeInTheDocument();
    // PostingTab calls onDone after a successful post → modal closes.
    fireEvent.click(screen.getByTestId("posting-tab"));
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});
