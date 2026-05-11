import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
let canFn = () => false;
vi.mock("../../../store/permissions.jsx", () => ({ useCan: () => canFn }));
// ReverseEntryModal pulls in newLedger/toast — stub it to a thin marker so we can
// assert it opens without exercising the RPC path.
vi.mock("./ReverseEntryModal.jsx", () => ({
  __esModule: true,
  default: ({ tx, cascade }) => <div data-testid="reverse-modal" data-tx={tx.id} data-cascade={String(!!cascade)} />,
}));

import TransactionRow from "./TransactionRow.jsx";

const mkNode = (kind, overrides = {}) => ({
  tx: { id: "tx-abcdef0123", effectiveDate: "2026-05-10T10:00:00Z", kind, sourceRefId: "42", reversesTransactionId: null, status: null, description: null, ...overrides },
  entries: [
    { id: "e1", accountId: "a1", direction: "dr", amount: 1000, currency: "USD", accountCode: "1110", accountName: "Касса USD" },
    { id: "e2", accountId: "a2", direction: "cr", amount: 1000, currency: "USD", accountCode: "2110", accountName: "Обязательства" },
  ],
});
const SUMMARY = "пришло 1 000 USD → ушло 950 USDT";
const expand = (container) => fireEvent.click(container.querySelector("div.cursor-pointer"));

describe("TransactionRow", () => {
  beforeEach(() => { canFn = () => false; });

  it("renders the summaryLine under the title while collapsed; hides it when expanded", () => {
    const { container } = render(<TransactionRow node={mkNode("deal")} summaryLine={SUMMARY} />);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expand(container);
    expect(screen.queryByText(SUMMARY)).toBeNull();
  });

  it("does not render the summary line when summaryLine is absent", () => {
    const { container } = render(<TransactionRow node={mkNode("deal")} />);
    expect(container.textContent).not.toContain("пришло");
  });

  it("hides the 'open source' link when onOpenSource is not provided; shows + fires it when provided", () => {
    const { container, unmount } = render(<TransactionRow node={mkNode("deal")} />);
    expand(container);
    expect(screen.queryByText("trv2_journal_open_source")).toBeNull();
    unmount();
    const onOpenSource = vi.fn();
    const { container: c2 } = render(<TransactionRow node={mkNode("deal")} onOpenSource={onOpenSource} />);
    expand(c2);
    fireEvent.click(screen.getByText("trv2_journal_open_source"));
    expect(onOpenSource).toHaveBeenCalled();
  });

  it("no 'undo deal' / 'reverse' action without the right permission", () => {
    canFn = () => false;
    const { container } = render(<TransactionRow node={mkNode("deal")} />);
    expand(container);
    expect(screen.queryByText("trv2_journal_undo_deal")).toBeNull();
    expect(screen.queryByText("trv2_pm_reverse")).toBeNull();
  });

  it("shows 'undo deal' on a deal row when can('transactions','edit'); opens ReverseEntryModal with cascade=true", () => {
    canFn = (section) => section === "transactions";
    const { container } = render(<TransactionRow node={mkNode("deal")} />);
    expand(container);
    const undoBtn = screen.getByText("trv2_journal_undo_deal");
    fireEvent.click(undoBtn);
    const modal = screen.getByTestId("reverse-modal");
    expect(modal.getAttribute("data-cascade")).toBe("true");
  });

  it("shows 'reverse' on a manual entry when can('accounting','edit'); opens ReverseEntryModal with cascade=false", () => {
    canFn = (section) => section === "accounting";
    const { container } = render(<TransactionRow node={mkNode("manual")} />);
    expand(container);
    fireEvent.click(screen.getByText("trv2_pm_reverse"));
    expect(screen.getByTestId("reverse-modal").getAttribute("data-cascade")).toBe("false");
  });

  it("no action on a reversal tx or an already-reversed tx", () => {
    canFn = () => true;
    const { container, unmount } = render(<TransactionRow node={mkNode("deal", { reversesTransactionId: "tx-other" })} />);
    expand(container);
    expect(screen.queryByText("trv2_journal_undo_deal")).toBeNull();
    unmount();
    const { container: c2 } = render(<TransactionRow node={mkNode("deal", { status: "reversed" })} />);
    expand(c2);
    expect(screen.queryByText("trv2_journal_undo_deal")).toBeNull();
  });
});
