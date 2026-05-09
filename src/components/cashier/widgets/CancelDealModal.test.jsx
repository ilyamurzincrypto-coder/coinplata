// CancelDealModal tests (T_C1, T_C2, T_C3).

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

import CancelDealModal from "./CancelDealModal.jsx";

describe("CancelDealModal", () => {
  it("T_C1: renders с workflow data", () => {
    render(
      <CancelDealModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        workflow={{
          id: "wf-1",
          ledger_tx_id: "deal-12345678abcdef",
          counterparty_name: "Test Client",
          status: "awaiting_release",
        }}
      />
    );
    expect(screen.getByText("cancel_modal_title")).toBeInTheDocument();
    expect(screen.getByText(/Test Client/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting_release/)).toBeInTheDocument();
    expect(screen.getByText(/deal-123/)).toBeInTheDocument();
  });

  it("T_C2: submit disabled пока reason < 5 chars", () => {
    const onConfirm = vi.fn();
    render(
      <CancelDealModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        workflow={{ id: "wf", counterparty_name: "X" }}
      />
    );
    const submit = screen.getByText("cancel_modal_submit_button").closest("button");
    expect(submit).toBeDisabled();

    // 4 chars — still disabled
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "abcd" } });
    expect(submit).toBeDisabled();

    // 5 chars — enabled
    fireEvent.change(textarea, { target: { value: "abcde" } });
    expect(submit).not.toBeDisabled();
  });

  it("T_C3: submit вызывает onConfirm с trimmed reason", async () => {
    const onConfirm = vi.fn().mockResolvedValue();
    render(
      <CancelDealModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        workflow={{ id: "wf", counterparty_name: "X" }}
      />
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  legitimate reason  " } });
    fireEvent.click(screen.getByText("cancel_modal_submit_button").closest("button"));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("legitimate reason"));
  });

  it("isOpen=false → not rendered", () => {
    const { container } = render(
      <CancelDealModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} workflow={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("Back button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <CancelDealModal isOpen={true} onClose={onClose} onConfirm={vi.fn()} workflow={{ id: "wf" }} />
    );
    fireEvent.click(screen.getByText("cancel_modal_back_button"));
    expect(onClose).toHaveBeenCalled();
  });
});
