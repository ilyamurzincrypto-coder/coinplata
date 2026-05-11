import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../store/accounts.jsx", () => ({ useAccounts: () => ({ balanceOf: () => 11000 }) }));
const mockLedger = vi.fn();
vi.mock("../../store/ledger.jsx", () => ({ useLedger: () => mockLedger() }));

import AccountHistoryModal from "./AccountHistoryModal.jsx";

const LEDGER_ACCOUNTS = [{ id: "la_1110", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null }];
const TRANSACTIONS = [{ id: "tx_1", effectiveDate: "2026-05-10T10:00:00Z", kind: "deal", sourceRefId: "42", reversesTransactionId: null }];
const ENTRIES = [
  { id: "e1", transactionId: "tx_1", accountId: "la_1110", direction: "dr", amount: 1000, currency: "USD", accountCode: "1110", accountName: "Cash USD", createdAt: "2026-05-10T10:00:00Z" },
];

function setLedger() {
  mockLedger.mockReturnValue({ accounts: LEDGER_ACCOUNTS, transactions: TRANSACTIONS, entries: ENTRIES, balances: [] });
}

describe("AccountHistoryModal", () => {
  it("renders v2 journal entries for a ledger-linked account", () => {
    setLedger();
    render(<AccountHistoryModal account={{ id: "pa_1", name: "Cash USD", currency: "USD", ledgerAccountCode: "1110" }} onClose={() => {}} />);
    // entry from tx_1 (sourceRefId 42, kind deal, dr) shows up via AccountInlineEntries
    // (Modal renders into a portal on document.body, so query that, not the render container).
    const body = document.body.textContent;
    expect(body).toContain("42");
    expect(body).toContain("deal");
    expect(body).toContain("trv2_col_dr");
    expect(body).toContain("USD");
    // not the "no ledger link" message
    expect(screen.queryByText("acc_no_ledger_link")).toBeNull();
  });

  it("shows the 'not linked to v2 chart' message for an account without a ledger code", () => {
    setLedger();
    render(<AccountHistoryModal account={{ id: "pa_2", name: "Some legacy bank", currency: "CHF", ledgerAccountCode: null }} onClose={() => {}} />);
    expect(screen.getByText("acc_no_ledger_link")).toBeInTheDocument();
  });

  it("renders nothing when account is null", () => {
    setLedger();
    const { container } = render(<AccountHistoryModal account={null} onClose={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
