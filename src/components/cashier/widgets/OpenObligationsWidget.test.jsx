// OpenObligationsWidget render tests (T_W1, T_W2, T_W9 from spec).

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({
  useTranslation: () => ({ t: (k, p) => k }),
}));
vi.mock("../../../store/auth.jsx", () => ({
  useAuth: () => ({ currentUser: { id: "u1", role: "manager" } }),
}));
vi.mock("../../../store/offices.jsx", () => ({
  useOffices: () => ({ activeOffices: [] }),
}));
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), from: vi.fn() },
  isSupabaseConfigured: false,
}));
vi.mock("../../../lib/newLedger.js", () => ({
  rpcUpdateWorkflowStatusV2: vi.fn().mockResolvedValue(),
  rpcCancelWorkflowV2: vi.fn().mockResolvedValue(),
}));
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: vi.fn() }));
vi.mock("../../../utils/money.js", () => ({
  fmt: (v) => String(v),
  curSymbol: () => "",
}));

const mockItems = [];
vi.mock("../../../store/openObligations.js", () => ({
  useOpenObligations: () => ({ items: mockItems, loading: false, refetch: vi.fn() }),
  formatAge: () => "1h",
}));

import OpenObligationsWidget from "./OpenObligationsWidget.jsx";

describe("OpenObligationsWidget", () => {
  it("T_W9: empty state when no obligations", () => {
    mockItems.length = 0;
    render(<OpenObligationsWidget officeId={null} />);
    expect(screen.getByText("open_obligations_empty")).toBeInTheDocument();
  });

  it("T_W1: renders rows with status chip", () => {
    mockItems.length = 0;
    mockItems.push({
      id: "wf-1",
      status: "awaiting_release",
      counterparty_name: "Test Client",
      open_count: 1,
      pending_out_total: 30000,
      open_legs: [{ leg_id: "out_0", currency: "TRY", amount: 30000 }],
      created_at: new Date().toISOString(),
    });
    render(<OpenObligationsWidget officeId={null} />);
    expect(screen.getByText("Test Client")).toBeInTheDocument();
    expect(screen.getByText("open_obligations_status_awaiting_release")).toBeInTheDocument();
  });

  it("T_W2: expand row shows action buttons", () => {
    mockItems.length = 0;
    mockItems.push({
      id: "wf-2",
      status: "awaiting_payment",
      counterparty_name: "Pay Client",
      open_count: 0,
      pending_out_total: 0,
      open_legs: [],
      created_at: new Date().toISOString(),
    });
    render(<OpenObligationsWidget />);
    // Click on row to expand
    fireEvent.click(screen.getByText("Pay Client"));
    expect(screen.getByText("open_obligations_action_mark_paid")).toBeInTheDocument();
    expect(screen.getByText("open_obligations_action_cancel")).toBeInTheDocument();
  });
});
