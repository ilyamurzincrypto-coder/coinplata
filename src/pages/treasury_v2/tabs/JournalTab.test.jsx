import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
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
  counterpartyOptions: (k) => k === "client"
    ? [{ id: "client-1", name: "Иван Петров" }, { id: "client-2", name: "Алексей Сидоров" }]
    : [{ id: "p1", name: "OTC Acme" }],
};

describe("JournalTab", () => {
  it("renders both transactions when no counterparty filter is active", () => {
    render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
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
});
