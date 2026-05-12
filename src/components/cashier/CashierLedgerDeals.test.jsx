import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k, lang: "ru" }) }));
// Deterministic, time-independent window.
vi.mock("../../pages/treasury_v2/PeriodPicker.jsx", () => ({
  __esModule: true,
  default: () => null,
  presetWindow: () => ({ from: "1970-01-01T00:00:00Z", to: "2999-12-31T00:00:00Z" }),
}));
// CashierDealRow pulls in useCan / DealDetail / modals — out of scope here; stub to a
// thin marker so we can assert the Cashier passes only deal nodes to it.
vi.mock("./CashierDealRow.jsx", () => ({
  __esModule: true,
  default: ({ node }) => <div data-testid="deal-row" data-tx={node.tx.id} />,
}));

const mockCtx = vi.fn();
vi.mock("../../store/ledger.jsx", () => ({ useLedger: () => mockCtx() }));

import CashierLedgerDeals from "./CashierLedgerDeals.jsx";

const ACCOUNTS = [
  { id: "a_cash", code: "1110", name: "Касса USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "a_hot", code: "1316", name: "Hot USDT", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: null },
  { id: "a_bank", code: "1130", name: "Банк USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
];
const TRANSACTIONS = [
  { id: "tx_deal", effectiveDate: "2026-05-10T10:00:00Z", kind: "deal", sourceRefId: null, reversesTransactionId: null, metadata: {} },
  { id: "tx_xfer", effectiveDate: "2026-05-09T10:00:00Z", kind: "transfer", sourceRefId: null, reversesTransactionId: null, metadata: {} },
];
const ENTRIES = [
  { id: "e1", transactionId: "tx_deal", accountId: "a_cash", direction: "dr", amount: 1000, currency: "USD", accountName: "Касса USD" },
  { id: "e2", transactionId: "tx_deal", accountId: "a_hot", direction: "cr", amount: 950, currency: "USDT", accountName: "Hot USDT" },
  { id: "e3", transactionId: "tx_xfer", accountId: "a_bank", direction: "dr", amount: 2000, currency: "USD", accountName: "Банк USD" },
  { id: "e4", transactionId: "tx_xfer", accountId: "a_cash", direction: "cr", amount: 2000, currency: "USD", accountName: "Касса USD" },
];

function setCtx(over = {}) {
  mockCtx.mockReturnValue({
    accounts: ACCOUNTS, transactions: TRANSACTIONS, entries: ENTRIES, balances: [],
    counterpartyName: () => "—",
    sinceIso: "1970-01-01T00:00:00Z", extendWindow: () => {},
    ...over,
  });
}

describe("CashierLedgerDeals", () => {
  it("is a deals-only board — only the deal transaction shows (no transfer), no type chips", () => {
    setCtx();
    render(<CashierLedgerDeals officeFilter="all" />);
    const rows = screen.getAllByTestId("deal-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-tx")).toBe("tx_deal");
    expect(screen.queryByRole("button", { name: "trv2_journal_type_all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "trv2_journal_type_transfer" })).toBeNull();
  });

  it("shows the empty state when there are no matching deals", () => {
    setCtx({ transactions: [], entries: [] });
    render(<CashierLedgerDeals officeFilter="all" />);
    expect(screen.getByText("trv2_journal_no_tx")).toBeInTheDocument();
  });
});
