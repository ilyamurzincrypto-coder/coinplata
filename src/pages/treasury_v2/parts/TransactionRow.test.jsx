import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../../store/permissions.jsx", () => ({ useCan: () => () => false }));

import TransactionRow from "./TransactionRow.jsx";

const node = {
  tx: { id: "tx-abcdef0123", effectiveDate: "2026-05-10T10:00:00Z", kind: "deal", sourceRefId: "42", reversesTransactionId: null, status: null, description: null },
  entries: [
    { id: "e1", accountId: "a1", direction: "dr", amount: 1000, currency: "USD", accountCode: "1110", accountName: "Касса USD" },
    { id: "e2", accountId: "a2", direction: "cr", amount: 1000, currency: "USD", accountCode: "2110", accountName: "Обязательства" },
  ],
};
const SUMMARY = "пришло 1 000 USD → ушло 950 USDT";

// The collapsible header is the lone .cursor-pointer div in the component.
const expand = (container) => fireEvent.click(container.querySelector("div.cursor-pointer"));

describe("TransactionRow", () => {
  it("renders the summaryLine under the title while collapsed; hides it when expanded", () => {
    const { container } = render(<TransactionRow node={node} summaryLine={SUMMARY} />);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expand(container);
    expect(screen.queryByText(SUMMARY)).toBeNull();
  });

  it("does not render the summary line when summaryLine is absent", () => {
    const { container } = render(<TransactionRow node={node} />);
    expect(container.textContent).not.toContain("пришло");
  });

  it("hides the 'open source' link when onOpenSource is not provided", () => {
    const { container } = render(<TransactionRow node={node} />);
    expand(container);
    expect(screen.queryByText("trv2_journal_open_source")).toBeNull();
  });

  it("shows the 'open source' link when onOpenSource is provided and fires it on click", () => {
    const onOpenSource = vi.fn();
    const { container } = render(<TransactionRow node={node} onOpenSource={onOpenSource} />);
    expand(container);
    fireEvent.click(screen.getByText("trv2_journal_open_source"));
    expect(onOpenSource).toHaveBeenCalledWith(node.tx);
  });
});
