import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../../store/offices.jsx", () => ({ useOffices: () => ({ findOffice: (id) => ({ "office-mark": { name: "Mark Antalya" } }[id] || null) }) }));
const obligHook = vi.fn();
vi.mock("../../../store/openObligations.js", () => ({ useOpenObligations: () => obligHook() }));

import DashboardTab from "./DashboardTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

// The fixture resolves client ids via ctx.counterpartyName; add a tiny resolver so the
// client-funds branch renders a readable name.
function ctxWith(overrides = {}) {
  return makeLedgerCtx({
    extendWindow: () => {},
    sinceIso: "2000-01-01T00:00:00.000Z",
    counterpartyName: (id) => ({ "client-1": "Иван Петров" }[id] || id),
    ...overrides,
  });
}

function renderTab(ctx = ctxWith()) {
  return render(<DashboardTab ctx={ctx} officeFilter="all" baseCurrency="USD" formatBase={(n) => `$${n}`} onOpenSource={() => {}} />);
}

beforeEach(() => {
  obligHook.mockReturnValue({ items: [], loading: false });
});

describe("DashboardTab — funds tree", () => {
  it("renders the two top-level sections with base totals", () => {
    renderTab();
    expect(screen.getByText("trv2_dash_available_funds")).toBeInTheDocument();
    expect(screen.getByText("trv2_dash_client_funds")).toBeInTheDocument();
    // available = 11000 USD cash + (150+1000) USDT = 12150 in base (USDT@1) — shows in
    // the section header AND the totals row, so >= 1 match.
    expect(screen.getAllByText(/12,150|12 150|12150/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows the totals row: assets · client liabilities · net capital", () => {
    renderTab();
    expect(screen.getByText("trv2_dash_totals")).toBeInTheDocument();
    expect(screen.getByText("trv2_dash_total_assets")).toBeInTheDocument();
    expect(screen.getByText("trv2_dash_total_client_liab")).toBeInTheDocument();
    expect(screen.getByText("trv2_dash_net_capital")).toBeInTheDocument();
    // net = 12150 − (−500) = 12650
    expect(screen.getByText(/12,650|12 650|12650/)).toBeInTheDocument();
  });

  it("expanding the available-funds section reveals its currency rows", () => {
    renderTab();
    // collapsed by default — no currency rows yet
    expect(screen.queryByText("USDT")).toBeNull();
    fireEvent.click(screen.getByText("trv2_dash_available_funds"));
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText("USDT")).toBeInTheDocument();
    // drill into USDT → leaf rows by account
    fireEvent.click(screen.getByText("USDT"));
    expect(screen.getByText(/Hot · USDT TRC20 · Mark/)).toBeInTheDocument();
    expect(screen.getByText(/trv2_dash_no_office · Treasury · USDT TRC20/)).toBeInTheDocument();
  });

  it("expanding the client-funds section reveals currency rows and per-client leaves", () => {
    renderTab();
    fireEvent.click(screen.getByText("trv2_dash_client_funds"));
    // client funds: USD −500 for client-1
    const usdRows = screen.getAllByText("USD");
    expect(usdRows.length).toBeGreaterThanOrEqual(1);
    // drill into the client-funds USD currency row → "Иван Петров" (also shows in the
    // recent-deals card, so the leaf is the *second* occurrence)
    fireEvent.click(usdRows[usdRows.length - 1]);
    expect(screen.getAllByText("Иван Петров").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the empty-funds state when there are no balances of that kind", () => {
    const ctx = ctxWith({ balances: [] });
    renderTab(ctx);
    fireEvent.click(screen.getByText("trv2_dash_available_funds"));
    expect(screen.getAllByText("trv2_dash_empty_funds").length).toBeGreaterThanOrEqual(1);
  });
});

describe("DashboardTab — support cards", () => {
  it("renders the P&L card and the Σ Дт = Σ Кт identity indicator", () => {
    renderTab();
    expect(screen.getByText("trv2_dash_pnl")).toBeInTheDocument();
    expect(screen.getByText("trv2_dash_capital")).toBeInTheDocument();
    // fixture identity is off (no period close)
    expect(screen.getByText("trv2_dash_identity_off")).toBeInTheDocument();
  });

  it("shows the 'no open obligations' empty state when there are none", () => {
    obligHook.mockReturnValue({ items: [], loading: false });
    renderTab();
    expect(screen.getByText("trv2_dash_oblig_none")).toBeInTheDocument();
  });

  it("renders the obligations count + bucket breakdown when there are open obligations", () => {
    obligHook.mockReturnValue({
      items: [
        { id: "o1", due_date: null, office_id: null, status: "open", open_legs: [{ currency: "USDT", amount: 450 }] },
      ],
      loading: false,
    });
    renderTab();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/450 USDT/)).toBeInTheDocument();
  });

  it("renders recent deals from the period", () => {
    renderTab();
    expect(screen.getByText("trv2_dash_recent_deals")).toBeInTheDocument();
    // the fixture has one deal dated 2026-05-10 with client_nickname "Иван Петров"
    const card = screen.getByText("trv2_dash_recent_deals").closest("div");
    expect(within(card).getByText("Иван Петров")).toBeInTheDocument();
  });

  it("shows the 'no deals' empty state when the period has none", () => {
    const ctx = ctxWith({ transactions: [], entries: [] });
    renderTab(ctx);
    expect(screen.getByText("trv2_dash_no_deals")).toBeInTheDocument();
  });
});
