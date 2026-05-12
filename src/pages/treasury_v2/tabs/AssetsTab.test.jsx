import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

let canAccountingEdit = true;
vi.mock("../../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));

vi.mock("../../../store/offices.jsx", () => ({
  useOffices: () => ({
    findOffice: (id) => ({ "office-mark": { id: "office-mark", name: "Mark Antalya" } }[id] || null),
    activeOffices: [{ id: "office-mark", name: "Mark Antalya" }],
  }),
}));
vi.mock("../../../store/currencies.jsx", () => ({ useCurrencies: () => ({ codes: ["USD", "USDT", "TRY"] }) }));
vi.mock("../../../lib/supabaseWrite.js", () => ({
  rpcCreateLedgerAccount: vi.fn(async () => "1901"),
  withToast: vi.fn(async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: String(e) }; } }),
}));
// AccountInlineEntries reaches into accountEntries — keep it as a marker.
vi.mock("../parts/AccountInlineEntries.jsx", () => ({
  __esModule: true,
  default: ({ accountId }) => <div data-testid="inline-entries">{accountId}</div>,
}));

import AssetsTab from "./AssetsTab.jsx";

const formatBase = (n) => `$${n}`;

function renderTab(ctx = makeLedgerCtx()) {
  return render(<AssetsTab ctx={ctx} officeFilter="all" formatBase={formatBase} baseCurrency="USD" onOpenTx={() => {}} />);
}

describe("AssetsTab — office → currency → accounts tree", () => {
  beforeEach(() => { canAccountingEdit = true; });

  it("renders top-level office headers (and a 'no office' bucket); leaves are hidden until expanded", () => {
    renderTab();
    // fixture asset accounts: ac_cash_usd_mark (office-mark), ac_hot_usdt_mark (office-mark), ac_treasury_usdt (null office)
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.getByText("trv2_assets_no_office")).toBeInTheDocument();
    // a leaf account name / code is not visible before expansion
    expect(screen.queryByText("1110")).toBeNull();
  });

  it("expanding an office reveals its currency rows; expanding a currency reveals the leaf accounts", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    // currencies for office-mark: USD (cash 11000) and USDT (hot 150)
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText("USDT")).toBeInTheDocument();
    // leaf accounts still hidden
    expect(screen.queryByText("1110")).toBeNull();
    // expand the USD currency row
    fireEvent.click(screen.getByText("USD"));
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("Cash · Mark Antalya · USD")).toBeInTheDocument();
  });

  it("expanding a leaf account shows its inline entries", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    fireEvent.click(screen.getByText("USD"));
    fireEvent.click(screen.getByText("Cash · Mark Antalya · USD"));
    expect(screen.getByTestId("inline-entries")).toHaveTextContent("ac_cash_usd_mark");
  });

  it("shows the '+ Счёт в план' button only with accounting:edit", () => {
    const { unmount } = renderTab();
    expect(screen.getByText("trv2_chart_add_btn")).toBeInTheDocument();
    unmount();
    canAccountingEdit = false;
    renderTab();
    expect(screen.queryByText("trv2_chart_add_btn")).toBeNull();
  });

  it("renders the no-accounts placeholder when there are no asset accounts", () => {
    const ctx = makeLedgerCtx({ accounts: [], balances: [] });
    renderTab(ctx);
    expect(screen.getByText("trv2_no_accounts")).toBeInTheDocument();
  });
});
