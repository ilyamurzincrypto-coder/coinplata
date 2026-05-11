import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const emitToast = vi.fn();
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: (...a) => emitToast(...a) }));
const rpcReverse = vi.fn();
vi.mock("../../../lib/newLedger.js", () => ({ rpcReverseTransactionV2: (...a) => rpcReverse(...a) }));

import ReverseEntryModal from "./ReverseEntryModal.jsx";

const tx = { id: "tx-1", description: "deal #42", kind: "deal" };

describe("ReverseEntryModal", () => {
  it("passes cascade=true when reversing a deal; requires a reason; shows success toast", async () => {
    rpcReverse.mockReset(); emitToast.mockReset();
    rpcReverse.mockResolvedValue({ reversal_tx_id: "rev-1" });
    const onClose = vi.fn();
    render(<ReverseEntryModal tx={tx} cascade onClose={onClose} />);
    // confirm disabled with empty reason
    const confirmBtn = screen.getByText("trv2_pm_reverse_confirm");
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reverse_reason_ph"), { target: { value: "ошибся" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(rpcReverse).toHaveBeenCalledWith({ targetTxId: "tx-1", reason: "ошибся", cascade: true }));
    await waitFor(() => expect(emitToast).toHaveBeenCalledWith("success", "trv2_pm_reverse_done"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("defaults cascade to false (manual-entry reversal)", async () => {
    rpcReverse.mockReset();
    rpcReverse.mockResolvedValue({});
    render(<ReverseEntryModal tx={{ id: "tx-2", description: "manual", kind: "manual" }} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reverse_reason_ph"), { target: { value: "fix" } });
    fireEvent.click(screen.getByText("trv2_pm_reverse_confirm"));
    await waitFor(() => expect(rpcReverse).toHaveBeenCalledWith({ targetTxId: "tx-2", reason: "fix", cascade: false }));
  });

  it("maps a 42501 RPC error to the forbidden toast", async () => {
    rpcReverse.mockReset(); emitToast.mockReset();
    rpcReverse.mockRejectedValue(new Error("permission denied (42501)"));
    render(<ReverseEntryModal tx={tx} cascade onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reverse_reason_ph"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("trv2_pm_reverse_confirm"));
    await waitFor(() => expect(emitToast).toHaveBeenCalledWith("error", "trv2_pm_err_forbidden"));
  });
});
