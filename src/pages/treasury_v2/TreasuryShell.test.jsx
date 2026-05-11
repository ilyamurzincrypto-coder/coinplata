// Integration smoke for the Treasury shell: real selectors + parts, mocked stores.
// Catches runtime wiring errors (tab switching, account expand, journal drill-down
// modal) that the per-tab render smokes don't cover.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const fx = vi.hoisted(() => {
  const NOW = new Date().toISOString();
  return {
    NOW,
    accounts: [
      { id: "ac_cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
      { id: "ac_liab", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null },
      { id: "ac_open", code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
    ],
    balances: [
      { accountId: "ac_cash", currency: "USD", clientId: null, partnerId: null, balance: 1000 },
      { accountId: "ac_liab", currency: "USD", clientId: null, partnerId: null, balance: -300 },
      { accountId: "ac_open", currency: "USD", clientId: null, partnerId: null, balance: 1300 },
    ],
    transactions: [
      { id: "tx1", effectiveDate: NOW, createdAt: NOW, kind: "deal", sourceRefId: "D-7", reversesTransactionId: null, metadata: { note: "smoke-tx" } },
    ],
    entries: [
      { id: "e1", transactionId: "tx1", accountId: "ac_cash", direction: "dr", amount: 100, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
      { id: "e2", transactionId: "tx1", accountId: "ac_liab", direction: "cr", amount: 100, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    ],
  };
});

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../store/offices.jsx", () => ({ useOffices: () => ({ activeOffices: [], findOffice: () => null }) }));
vi.mock("../../store/openObligations.js", () => ({ useOpenObligations: () => ({ items: [], loading: false }) }));
vi.mock("../../store/baseCurrency.js", () => ({
  useBaseCurrency: () => ({ toBase: (a) => Number(a) || 0, formatBase: (a) => `$${Number(a) || 0}`, base: "USD" }),
}));
vi.mock("../../store/ledger.jsx", () => ({
  useLedger: () => ({
    accounts: fx.accounts, balances: fx.balances, transactions: fx.transactions, entries: fx.entries,
    loading: false, sinceIso: "2000-01-01T00:00:00.000Z", extendWindow: () => {},
  }),
}));

let canAccountingEdit = false;
vi.mock("../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));
vi.mock("../../lib/toast.jsx", () => ({ emitToast: () => {} }));
vi.mock("../../lib/newLedger.js", () => ({ rpcCreateManualEntryV2: () => Promise.resolve("tx-x"), rpcReverseTransactionV2: () => Promise.resolve(["rev-x"]) }));

import TreasuryShell from "./TreasuryShell.jsx";

describe("TreasuryShell integration smoke", () => {
  it("renders the tabs, opens on the Dashboard, and Assets tab content shows on click", () => {
    render(<TreasuryShell />);
    for (const key of ["trv2_tab_dashboard", "trv2_tab_assets", "trv2_tab_liabilities", "trv2_tab_equity", "trv2_tab_pnl", "trv2_tab_journal"]) {
      expect(screen.getByRole("button", { name: key })).toBeInTheDocument();
    }
    // Dashboard is the landing tab → its capital card is visible
    expect(screen.getByText("trv2_dash_capital")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_assets" }));
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("trv2_subtype_cash")).toBeInTheDocument();
  });

  it("expands an account row to reveal its inline Dr/Cr entries", () => {
    const { container } = render(<TreasuryShell />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_assets" }));
    expect(container.textContent).not.toContain("D-7");
    fireEvent.click(screen.getByText("1110"));
    expect(container.textContent).toContain("D-7"); // source-doc link in the inline entry table
  });

  it("switches to Журнал and drills into the transaction-detail modal", () => {
    const { container } = render(<TreasuryShell />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_journal" }));
    fireEvent.click(screen.getByText("deal #D-7")); // expand the tx row
    fireEvent.click(screen.getByRole("button", { name: "trv2_journal_open_source" }));
    expect(container.textContent).toContain("smoke-tx"); // tx metadata rendered in the modal
  });
});

describe("TreasuryShell — Posting Master tab gating", () => {
  it("hides the Manual-entry tab without accounting:edit", () => {
    canAccountingEdit = false;
    render(<TreasuryShell />);
    expect(screen.queryByRole("button", { name: "trv2_pm_tab" })).toBeNull();
  });
  it("shows the Manual-entry tab with accounting:edit and can open it", () => {
    canAccountingEdit = true;
    render(<TreasuryShell />);
    const tab = screen.getByRole("button", { name: "trv2_pm_tab" });
    expect(tab).toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByText("trv2_pm_title")).toBeInTheDocument();
  });
});

describe("TreasuryShell — Обороты tab", () => {
  it("renders the Обороты tab and opening it shows the ОСВ view", () => {
    render(<TreasuryShell />);
    const tab = screen.getByRole("button", { name: "trv2_tab_turnover" });
    expect(tab).toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByRole("button", { name: "trv2_to_view_osv" })).toBeInTheDocument();
  });
});
