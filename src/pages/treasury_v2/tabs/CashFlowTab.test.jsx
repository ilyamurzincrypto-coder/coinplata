import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// t returns the key (with the optional second arg as fallback when given)
vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k, fb) => (fb != null ? fb : k) }) }));

import CashFlowTab from "./CashFlowTab.jsx";

const NOW = new Date().toISOString();

// A tiny ledger: opening Dr cash 1000 / Cr equity 1000; then a deal moves
// Dr cash 200 (in) and a topup Cr cash 50 (out) — both this month.
function makeCtx(overrides = {}) {
  const accounts = [
    { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "ofA", clientDimRequired: false, partnerDimRequired: false },
    { id: "hot", code: "1316", name: "Hot USDT", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: "ofA", clientDimRequired: false, partnerDimRequired: false },
    { id: "clear", code: "1900", name: "Clearing USD", type: "asset", subtype: "clearing", currency: "USD", officeId: "ofA", clientDimRequired: false, partnerDimRequired: false },
    { id: "eq", code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
  ];
  const transactions = [
    { id: "tO", effectiveDate: NOW, createdAt: NOW, kind: "opening", sourceRefId: null, reversesTransactionId: null, metadata: {} },
    { id: "tD", effectiveDate: NOW, createdAt: NOW, kind: "deal", sourceRefId: "D-1", reversesTransactionId: null, metadata: {} },
    { id: "tT", effectiveDate: NOW, createdAt: NOW, kind: "topup", sourceRefId: null, reversesTransactionId: null, metadata: {} },
  ];
  const entries = [
    { id: "e1", transactionId: "tO", accountId: "cash", direction: "dr", amount: 1000, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e2", transactionId: "tO", accountId: "eq", direction: "cr", amount: 1000, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e3", transactionId: "tD", accountId: "cash", direction: "dr", amount: 200, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e4", transactionId: "tD", accountId: "clear", direction: "cr", amount: 200, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e5", transactionId: "tT", accountId: "cash", direction: "cr", amount: 50, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e6", transactionId: "tT", accountId: "clear", direction: "dr", amount: 50, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
  ];
  const balances = [
    { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 1150 },
    { accountId: "clear", currency: "USD", clientId: null, partnerId: null, balance: -150 },
    { accountId: "eq", currency: "USD", clientId: null, partnerId: null, balance: 1000 },
  ];
  const rate = (c) => ({ USD: 1, USDT: 1 }[String(c).toUpperCase()] ?? 0);
  return {
    accounts, transactions, entries, balances,
    toBase: (a, c) => Number(a) * rate(c),
    baseCurrency: "USD", officeFilter: "all",
    extendWindow: () => {}, sinceIso: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderTab(ctx = makeCtx(), officeFilter = "all") {
  return render(<CashFlowTab ctx={ctx} officeFilter={officeFilter} formatBase={(n) => `$${n}`} baseCurrency="USD" />);
}

// toLocaleString's group separator varies across ICU builds (',' / space / NBSP).
const loose = (digits, suffix) => new RegExp(digits.split("").join("[\\s,]?") + " " + suffix);

describe("CashFlowTab", () => {
  it("computes inflow / outflow / net change in base currency for the period", () => {
    renderTab();
    // inflow: opening Dr 1000 + deal Dr 200 = 1200 ; outflow: topup Cr 50 = 50 ; net = +1150
    expect(screen.getAllByText("trv2_cf_inflow").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(loose("1200", "USD")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/[−-]50 USD/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(loose("1150", "USD")).length).toBeGreaterThanOrEqual(1);
  });

  it("breaks the flow down by source category and by currency", () => {
    renderTab();
    expect(screen.getByText("trv2_cf_by_category")).toBeInTheDocument();
    // categories: opening (+1000), deal (+200), topup (−50) — labels fall back to the raw kind
    expect(screen.getByText("opening")).toBeInTheDocument();
    expect(screen.getByText("deal")).toBeInTheDocument();
    expect(screen.getByText("topup")).toBeInTheDocument();
    expect(screen.getByText("trv2_cf_by_currency")).toBeInTheDocument();
  });

  it("ignores entries on internal clearing accounts (not cash/crypto)", () => {
    // The clearing legs (e4 Cr 200, e6 Dr 50) must not affect inflow/outflow.
    renderTab();
    // if clearing were counted, inflow would be 1250 and outflow 250 — assert it isn't
    expect(screen.queryByText(loose("1250", "USD"))).toBeNull();
  });

  it("shows the empty state when there are no entries at all", () => {
    renderTab(makeCtx({ entries: [], transactions: [] }));
    expect(screen.getByText("trv2_cf_empty")).toBeInTheDocument();
  });

  it("respects the office filter", () => {
    // move the cash/crypto accounts to a different office → no cash/crypto entries for ofA
    const ctx = makeCtx();
    ctx.accounts = ctx.accounts.map((a) => (a.id === "cash" || a.id === "hot" ? { ...a, officeId: "ofB" } : a));
    renderTab(ctx, "ofA");
    expect(screen.getByText("trv2_cf_empty")).toBeInTheDocument();
  });
});
