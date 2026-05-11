import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../../store/offices.jsx", () => ({ useOffices: () => ({ findOffice: (id) => ({ "office-mark": { name: "Mark Antalya" } }[id] || null) }) }));
const obligHook = vi.fn();
vi.mock("../../../store/openObligations.js", () => ({ useOpenObligations: () => obligHook() }));

import DashboardTab from "./DashboardTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

function renderTab(ctx = makeLedgerCtx({ extendWindow: () => {}, sinceIso: "2000-01-01T00:00:00.000Z" })) {
  return render(<DashboardTab ctx={ctx} officeFilter="all" baseCurrency="USD" formatBase={(n) => `$${n}`} onOpenSource={() => {}} />);
}

beforeEach(() => {
  obligHook.mockReturnValue({ items: [], loading: false });
});

describe("DashboardTab", () => {
  it("renders the capital card with assets / liabilities / equity figures in base currency", () => {
    renderTab();
    expect(screen.getByText("trv2_dash_capital")).toBeInTheDocument();
    // assets in the fixture: 11000 cash + 150 + 1000 USDT = 12150 USD
    expect(screen.getByText(/12,150|12 150|12150/)).toBeInTheDocument();
    // liabilities = customer_liab balance -500 → -500 USD
    expect(screen.getByText(/-500|−500/)).toBeInTheDocument();
  });

  it("shows the balance-identity badge (off in the fixture — no period close)", () => {
    renderTab();
    // assets 12150 vs liab+equity 10500 → identity off → the 'off' badge key renders
    expect(screen.getByText("trv2_dash_identity_off")).toBeInTheDocument();
  });

  it("renders the by-office breakdown using office names", () => {
    renderTab();
    expect(screen.getByText("trv2_dash_by_office")).toBeInTheDocument();
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.getByText("trv2_dash_no_office")).toBeInTheDocument();
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
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
  });

  it("shows the 'no deals' empty state when the period has none", () => {
    // a ctx with no deal transactions in the recent period
    const ctx = makeLedgerCtx({
      extendWindow: () => {},
      sinceIso: "2000-01-01T00:00:00.000Z",
      transactions: [],
      entries: [],
    });
    renderTab(ctx);
    expect(screen.getByText("trv2_dash_no_deals")).toBeInTheDocument();
  });
});
