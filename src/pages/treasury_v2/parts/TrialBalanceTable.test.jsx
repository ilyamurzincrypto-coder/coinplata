import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const exportCSVMock = vi.fn(() => true);
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVMock(...a) }));

import TrialBalanceTable from "./TrialBalanceTable.jsx";

const accounts = [
  { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "eq",   code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
  { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
];
const transactions = [
  { id: "T1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "deal", sourceRefId: "D1" },
];
const entries = [
  { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 200, currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
  { id: "e2", transactionId: "T1", accountId: "rev",  direction: "cr", amount: 200, currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
];
const balances = [
  { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 200 },
  { accountId: "rev",  currency: "USD", clientId: null, partnerId: null, balance: 200 },
  { accountId: "eq",   currency: "USD", clientId: null, partnerId: null, balance: 0 },
];
const ctx = { accounts, transactions, entries, balances, toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all" };
const win = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };

describe("TrialBalanceTable", () => {
  it("renders class sections and account rows with turnover", () => {
    render(<TrialBalanceTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("Cash USD")).toBeInTheDocument();
    expect(screen.getByText("4010")).toBeInTheDocument();
    expect(screen.getByText("trv2_tab_assets")).toBeInTheDocument();
    expect(screen.getByText("trv2_to_class_revenue")).toBeInTheDocument();
  });

  it("expands an account row to show its inline entries for the period", () => {
    const { container } = render(<TrialBalanceTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(container.textContent).not.toContain("D1");
    fireEvent.click(screen.getByText("1110"));
    expect(container.textContent).toContain("D1");
  });

  it("Export CSV button calls exportCSV with rows", () => {
    render(<TrialBalanceTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_to_export_csv" }));
    expect(exportCSVMock).toHaveBeenCalledTimes(1);
    const arg = exportCSVMock.mock.calls[0][0];
    expect(Array.isArray(arg.rows)).toBe(true);
    expect(arg.rows.some((r) => r.code === "1110")).toBe(true);
  });

  it("shows the empty state when no account has activity", () => {
    const emptyCtx = { ...ctx, entries: [], balances: [] };
    render(<TrialBalanceTable ctx={emptyCtx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(screen.getByText("trv2_to_empty_osv")).toBeInTheDocument();
  });
});
