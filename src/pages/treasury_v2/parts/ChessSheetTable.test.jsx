import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k, p) => k }) }));

import ChessSheetTable from "./ChessSheetTable.jsx";

const accounts = [
  { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null, active: true },
  { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null, active: true },
  { id: "eq",   code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null, active: true },
];
const transactions = [
  { id: "T1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "manual", sourceRefId: null },
];
const entries = [
  { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 100, currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
  { id: "e2", transactionId: "T1", accountId: "rev",  direction: "cr", amount: 30,  currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
  { id: "e3", transactionId: "T1", accountId: "eq",   direction: "cr", amount: 70,  currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
];
const ctx = { accounts, transactions, entries, balances: [], toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all" };
const win = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };

describe("ChessSheetTable", () => {
  it("renders the matrix: account codes on both axes and the allocated cell values", () => {
    const { container } = render(<ChessSheetTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => String(n)} baseCurrency="USD" />);
    expect(screen.getAllByText("1110").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("4010").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("30");
    expect(container.textContent).toContain("70");
    expect(container.textContent).toContain("100");
    expect(screen.getByText("trv2_to_chess_row_total")).toBeInTheDocument();
    expect(screen.getByText("trv2_to_chess_col_total")).toBeInTheDocument();
  });

  it("shows the empty state when no transactions in the period", () => {
    render(<ChessSheetTable ctx={{ ...ctx, transactions: [], entries: [] }} window={win} officeFilter="all" formatBase={(n) => String(n)} baseCurrency="USD" />);
    expect(screen.getByText("trv2_to_empty_chess")).toBeInTheDocument();
  });

  it("has a currency selector; switching to a native currency shows the cross-currency caveat", () => {
    const { container } = render(<ChessSheetTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" />);
    // base view: no native caveat, amounts via formatBase ($ prefix)
    expect(screen.queryByText("trv2_to_chess_native_note")).toBeNull();
    expect(container.textContent).toContain("$100");
    // switch to native "USD"
    const sel = container.querySelector("select");
    expect(sel).toBeTruthy();
    fireEvent.change(sel, { target: { value: "USD" } });
    expect(screen.getByText("trv2_to_chess_native_note")).toBeInTheDocument();
    // native amounts are "100 USD" style, not "$100"
    expect(container.textContent).toContain("100 USD");
  });
});
