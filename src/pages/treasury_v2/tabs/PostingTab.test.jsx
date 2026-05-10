import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const emitToastMock = vi.fn();
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: (...a) => emitToastMock(...a) }));
const rpcMock = vi.fn();
vi.mock("../../../lib/newLedger.js", () => ({ rpcCreateManualEntryV2: (...a) => rpcMock(...a) }));

import PostingTab from "./PostingTab.jsx";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a2", code: "4010", name: "Spread USD", subtype: "spread", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
];
const ctx = { accounts: ACCOUNTS };

describe("PostingTab", () => {
  beforeEach(() => { rpcMock.mockReset(); emitToastMock.mockReset(); });

  it("renders the editor with two starter lines and a disabled Post button", () => {
    render(<PostingTab ctx={ctx} />);
    expect(screen.getByText("trv2_pm_title")).toBeInTheDocument();
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    expect(post).toBeDisabled();
    // two account selects (one per starter line) + currency select
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(3);
  });

  it("posts a balanced entry, toasts success, resets the form", async () => {
    rpcMock.mockResolvedValue("tx-1");
    render(<PostingTab ctx={ctx} />);
    const accountSelects = screen.getAllByRole("combobox").filter((el) => [...el.options].some((o) => /1110|4010/.test(o.value)));
    fireEvent.change(accountSelects[0], { target: { value: "1110" } });
    fireEvent.change(accountSelects[1], { target: { value: "4010" } });
    const numericInputs = screen.getAllByRole("textbox").filter((el) => el.getAttribute("inputmode") === "decimal");
    fireEvent.change(numericInputs[0], { target: { value: "100" } }); // line 1 Dr
    fireEvent.change(numericInputs[3], { target: { value: "100" } }); // line 2 Cr ([l1Dr, l1Cr, l2Dr, l2Cr])
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "manual fee" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const payload = rpcMock.mock.calls[0][0];
    expect(payload.currencyCode).toBe("USD");
    expect(payload.reason).toBe("manual fee");
    expect(payload.lines).toEqual([
      { accountCode: "1110", direction: "dr", amount: 100 },
      { accountCode: "4010", direction: "cr", amount: 100 },
    ]);
    expect(emitToastMock).toHaveBeenCalledWith("success", "trv2_pm_posted");
    await waitFor(() => expect(screen.getByPlaceholderText("trv2_pm_reason_ph").value).toBe(""));
  });

  it("maps a 42501 RPC error to the forbidden toast", async () => {
    rpcMock.mockRejectedValue(new Error("Not authenticated"));
    render(<PostingTab ctx={ctx} />);
    const accountSelects = screen.getAllByRole("combobox").filter((el) => [...el.options].some((o) => /1110|4010/.test(o.value)));
    fireEvent.change(accountSelects[0], { target: { value: "1110" } });
    fireEvent.change(accountSelects[1], { target: { value: "4010" } });
    const numericInputs = screen.getAllByRole("textbox").filter((el) => el.getAttribute("inputmode") === "decimal");
    fireEvent.change(numericInputs[0], { target: { value: "50" } });
    fireEvent.change(numericInputs[3], { target: { value: "50" } });
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "x" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(emitToastMock).toHaveBeenCalledWith("error", "trv2_pm_err_forbidden"));
  });
});
