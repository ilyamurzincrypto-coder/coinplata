import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const mockCtx = vi.fn();
vi.mock("../../../store/ledger.jsx", () => ({ useLedger: () => mockCtx() }));
const emitToast = vi.fn();
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: (...a) => emitToast(...a) }));
const rpcAdj = vi.fn();
vi.mock("../../../lib/newLedger.js", () => ({ rpcCreateAdjustmentV2: (...a) => rpcAdj(...a) }));

import PeriodCloseModal from "./PeriodCloseModal.jsx";

const ACCOUNTS = [
  { id: "spr", code: "4010", name: "Spread USD", type: "revenue", currency: "USD" },
  { id: "com", code: "4011", name: "Commission EUR", type: "revenue", currency: "EUR" },
  { id: "net", code: "5136", name: "Network fee USD", type: "expense", currency: "USD" },
  { id: "cash", code: "1110", name: "Cash USD", type: "asset", currency: "USD" },
];
const BALANCES = [
  { accountId: "spr", balance: 50 },
  { accountId: "com", balance: 10 },
  { accountId: "net", balance: 4 },
  { accountId: "cash", balance: 99999 },
];

describe("PeriodCloseModal", () => {
  beforeEach(() => { rpcAdj.mockReset(); emitToast.mockReset(); });

  it("shows the non-zero revenue/expense lines and net profit; confirm posts one reconciliation adjustment per line", async () => {
    mockCtx.mockReturnValue({ accounts: ACCOUNTS, balances: BALANCES });
    rpcAdj.mockResolvedValue({ adj_tx_id: "x" });
    render(<PeriodCloseModal open onClose={() => {}} />);
    const body = document.body;
    expect(body.textContent).toContain("4010");
    expect(body.textContent).toContain("5136");
    expect(body.textContent).toContain("4011");
    expect(body.textContent).toContain("trv2_pc_net");
    // confirm flow: first click → confirm step, second → run
    fireEvent.click(screen.getByText("trv2_pc_button"));
    fireEvent.click(screen.getByText("trv2_pc_confirm"));
    await waitFor(() => expect(rpcAdj).toHaveBeenCalledTimes(3));
    const calls = rpcAdj.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "4010", amount: 50, currencyCode: "USD", adjustmentKind: "reconciliation" }),
      expect.objectContaining({ accountCode: "4011", amount: 10, currencyCode: "EUR", adjustmentKind: "reconciliation" }),
      expect.objectContaining({ accountCode: "5136", amount: -4, currencyCode: "USD", adjustmentKind: "reconciliation" }),
    ]));
    await waitFor(() => expect(emitToast).toHaveBeenCalledWith("success", expect.stringContaining("trv2_pc_done")));
  });

  it("nothing-to-close state: all revenue/expense balances zero → message + disabled confirm", () => {
    mockCtx.mockReturnValue({ accounts: ACCOUNTS, balances: [{ accountId: "spr", balance: 0 }, { accountId: "cash", balance: 5 }] });
    render(<PeriodCloseModal open onClose={() => {}} />);
    expect(screen.getByText("trv2_pc_nothing")).toBeInTheDocument();
    expect(screen.getByText("trv2_pc_button")).toBeDisabled();
  });

  it("renders nothing when open is false", () => {
    mockCtx.mockReturnValue({ accounts: ACCOUNTS, balances: BALANCES });
    const { container } = render(<PeriodCloseModal open={false} onClose={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("stops and toasts on a mid-loop error, keeping the modal open", async () => {
    mockCtx.mockReturnValue({ accounts: ACCOUNTS, balances: BALANCES });
    rpcAdj.mockResolvedValueOnce({ adj_tx_id: "x" }).mockRejectedValueOnce(new Error("boom"));
    render(<PeriodCloseModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText("trv2_pc_button"));
    fireEvent.click(screen.getByText("trv2_pc_confirm"));
    await waitFor(() => expect(rpcAdj).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(emitToast).toHaveBeenCalledWith("error", expect.stringContaining("trv2_pc_partial")));
  });
});
