// SubmitCTA component tests (P1 T5 + P2 T8 + P2 T11).

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

import SubmitCTA from "./SubmitCTA.jsx";

describe("SubmitCTA", () => {
  it("T5: disabled при invalid form — кнопка не click'абельна", () => {
    const onSubmit = vi.fn();
    render(
      <SubmitCTA
        onSubmit={onSubmit}
        disabled={true}
        disabledTitle="Fix errors"
      />
    );
    const primary = screen.getByRole("button", { name: /submit_create_deal/i });
    expect(primary).toBeDisabled();
    fireEvent.click(primary);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("T8: split-button dropdown — primary + 2 actions", () => {
    const onSubmit = vi.fn();
    const onSubmitDraft = vi.fn();
    const onSubmitAndNotify = vi.fn();
    render(
      <SubmitCTA
        onSubmit={onSubmit}
        onSubmitDraft={onSubmitDraft}
        onSubmitAndNotify={onSubmitAndNotify}
      />
    );
    // Primary button
    const primary = screen.getByRole("button", { name: /submit_create_deal/i });
    fireEvent.click(primary);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Dropdown closed initially
    expect(screen.queryByText("submit_save_draft")).not.toBeInTheDocument();

    // Click chevron → dropdown opens
    const chevron = screen.getByLabelText("More actions");
    fireEvent.click(chevron);

    expect(screen.getByText("submit_save_draft")).toBeInTheDocument();
    expect(screen.getByText("submit_create_and_notify")).toBeInTheDocument();

    // Click draft option
    fireEvent.click(screen.getByText("submit_save_draft"));
    expect(onSubmitDraft).toHaveBeenCalledTimes(1);
    // После клика dropdown закрывается
    expect(screen.queryByText("submit_save_draft")).not.toBeInTheDocument();
  });

  it("T11: loading state — primary показывает spinner + disabled", () => {
    const onSubmit = vi.fn();
    render(<SubmitCTA onSubmit={onSubmit} loading={true} />);
    const primary = screen.getByRole("button", { name: /deal_loading/i });
    expect(primary).toBeDisabled();
    fireEvent.click(primary);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
