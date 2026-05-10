import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k, p) => k }) }));

import TurnoverTab from "./TurnoverTab.jsx";

const accounts = [
  { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
];
const transactions = [
  { id: "T1", effectiveDate: new Date().toISOString(), createdAt: new Date().toISOString(), kind: "manual", sourceRefId: null },
];
const entries = [
  { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 50, currency: "USD", createdAt: new Date().toISOString() },
  { id: "e2", transactionId: "T1", accountId: "rev",  direction: "cr", amount: 50, currency: "USD", createdAt: new Date().toISOString() },
];
const balances = [
  { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 50 },
  { accountId: "rev",  currency: "USD", clientId: null, partnerId: null, balance: 50 },
];
const ctx = { accounts, transactions, entries, balances, toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all", sinceIso: "2000-01-01T00:00:00.000Z", extendWindow: () => {} };

describe("TurnoverTab", () => {
  it("renders the ОСВ view by default, with the sub-view toggle", () => {
    render(<TurnoverTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(screen.getByRole("button", { name: "trv2_to_view_osv" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trv2_to_view_chess" })).toBeInTheDocument();
    expect(screen.getByText("1110")).toBeInTheDocument();
  });

  it("toggles to the Шахматка view", () => {
    render(<TurnoverTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_to_view_chess" }));
    expect(screen.getByText("trv2_to_chess_row_total")).toBeInTheDocument();
  });
});
