import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k, lang: "ru" }) }));
// Deterministic, time-independent window.
vi.mock("../../pages/treasury_v2/PeriodPicker.jsx", () => ({
  __esModule: true,
  default: () => null,
  presetWindow: () => ({ from: "1970-01-01T00:00:00Z", to: "2999-12-31T00:00:00Z" }),
}));
// TransactionRow reaches into useCan via PermissionsProvider — out of scope here.
vi.mock("../../pages/treasury_v2/parts/TransactionRow.jsx", () => ({
  __esModule: true,
  default: ({ node, summaryLine }) => <div data-testid="tx-row" data-summary={summaryLine || ""}>{node.tx.id}</div>,
}));

const mockCtx = vi.fn();
vi.mock("../../store/ledger.jsx", () => ({ useLedger: () => mockCtx() }));

import CashierLedgerDeals from "./CashierLedgerDeals.jsx";

const ACCOUNTS = [
  { id: "a_cash", code: "1110", name: "Касса USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "a_hot", code: "1316", name: "Hot USDT", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: null },
  { id: "a_bank", code: "1130", name: "Банк USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "l_cust", code: "2110", name: "Обязательства", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null },
  { id: "r_spread", code: "4010", name: "Доход: спред", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
];
const TRANSACTIONS = [
  { id: "tx_deal", effectiveDate: "2026-05-10T10:00:00Z", kind: "deal", sourceRefId: null, reversesTransactionId: null, metadata: {} },
  { id: "tx_xfer", effectiveDate: "2026-05-09T10:00:00Z", kind: "transfer", sourceRefId: null, reversesTransactionId: null, metadata: {} },
];
const ENTRIES = [
  // deal: Dr cash 1000 / Cr cust 1000 / Dr cust 950 / Cr hot 950 / Cr spread 50
  { id: "e1", transactionId: "tx_deal", accountId: "a_cash", direction: "dr", amount: 1000, currency: "USD", accountName: "Касса USD" },
  { id: "e2", transactionId: "tx_deal", accountId: "l_cust", direction: "cr", amount: 1000, currency: "USD", accountName: "Обязательства" },
  { id: "e3", transactionId: "tx_deal", accountId: "l_cust", direction: "dr", amount: 950, currency: "USD", accountName: "Обязательства" },
  { id: "e4", transactionId: "tx_deal", accountId: "a_hot", direction: "cr", amount: 950, currency: "USDT", accountName: "Hot USDT" },
  { id: "e5", transactionId: "tx_deal", accountId: "r_spread", direction: "cr", amount: 50, currency: "USD", accountName: "Доход: спред" },
  // transfer: Dr bank 2000 / Cr cash 2000
  { id: "e6", transactionId: "tx_xfer", accountId: "a_bank", direction: "dr", amount: 2000, currency: "USD", accountName: "Банк USD" },
  { id: "e7", transactionId: "tx_xfer", accountId: "a_cash", direction: "cr", amount: 2000, currency: "USD", accountName: "Касса USD" },
];

function setCtx() {
  mockCtx.mockReturnValue({
    accounts: ACCOUNTS, transactions: TRANSACTIONS, entries: ENTRIES, balances: [],
    sinceIso: "1970-01-01T00:00:00Z", extendWindow: () => {},
  });
}

describe("CashierLedgerDeals", () => {
  it("defaults to type=deal — shows only the deal transaction, with a «пришло → ушло · спред» summary", () => {
    setCtx();
    render(<CashierLedgerDeals officeFilter="all" />);
    const rows = screen.getAllByTestId("tx-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("tx_deal");
    const summary = rows[0].getAttribute("data-summary");
    expect(summary).toContain("cashier_deal_in");
    expect(summary).toContain("USD");
    expect(summary).toContain("cashier_deal_out");
    expect(summary).toContain("USDT");
    expect(summary).toContain("cashier_deal_margin");
  });

  it("switching the type chip to «all» shows both transactions; transfer row has no deal summary", () => {
    setCtx();
    render(<CashierLedgerDeals officeFilter="all" />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_journal_type_all" }));
    const rows = screen.getAllByTestId("tx-row");
    expect(rows.map((r) => r.textContent).sort()).toEqual(["tx_deal", "tx_xfer"]);
    const xferRow = rows.find((r) => r.textContent === "tx_xfer");
    expect(xferRow.getAttribute("data-summary")).toBe(""); // kind !== deal → no summary
  });

  it("shows the empty state when there are no matching transactions", () => {
    mockCtx.mockReturnValue({ accounts: ACCOUNTS, transactions: [], entries: [], balances: [], sinceIso: "1970-01-01T00:00:00Z", extendWindow: () => {} });
    render(<CashierLedgerDeals officeFilter="all" />);
    expect(screen.getByText("trv2_journal_no_tx")).toBeInTheDocument();
  });
});
