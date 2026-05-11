import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
let canFn = () => false;
vi.mock("../../../store/permissions.jsx", () => ({ useCan: () => canFn }));
// ReverseEntryModal / EditTxNoteModal pull in newLedger/toast — stub them to thin
// markers so we can assert they open without exercising the RPC path.
vi.mock("./ReverseEntryModal.jsx", () => ({
  __esModule: true,
  default: ({ tx, cascade }) => <div data-testid="reverse-modal" data-tx={tx.id} data-cascade={String(!!cascade)} />,
}));
vi.mock("./EditTxNoteModal.jsx", () => ({
  __esModule: true,
  default: ({ tx }) => <div data-testid="note-modal" data-tx={tx.id} />,
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

  it("renders renderDetail(node) instead of the Dr/Cr entries when provided; without it shows the entries table", () => {
    const renderDetail = vi.fn(() => <div data-testid="custom-detail">manager view</div>);
    const { container } = render(<TransactionRow node={mkNode("deal")} renderDetail={renderDetail} />);
    expand(container);
    expect(screen.getByTestId("custom-detail")).toBeInTheDocument();
    expect(renderDetail).toHaveBeenCalled();
    // the Dr/Cr header from TransactionEntries must NOT render
    expect(screen.queryByText("trv2_col_account")).toBeNull();
    // default (no renderDetail) → entries table is shown
    const { container: c2 } = render(<TransactionRow node={mkNode("deal")} />);
    expand(c2);
    expect(screen.getByText("trv2_col_account")).toBeInTheDocument();
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

  it("no reverse action on a reversal tx or an already-reversed tx (but note editing stays available)", () => {
    canFn = () => true;
    const { container, unmount } = render(<TransactionRow node={mkNode("deal", { reversesTransactionId: "tx-other" })} />);
    expand(container);
    expect(screen.queryByText("trv2_journal_undo_deal")).toBeNull();
    expect(screen.queryByText("trv2_tx_edit_note")).not.toBeNull(); // can still edit the note
    unmount();
    const { container: c2 } = render(<TransactionRow node={mkNode("deal", { status: "reversed" })} />);
    expand(c2);
    expect(screen.queryByText("trv2_journal_undo_deal")).toBeNull();
  });

  it("'edit note' shows when can(transactions|accounting,'edit') and opens EditTxNoteModal; renders the comment when present", () => {
    canFn = (section) => section === "transactions";
    const { container, unmount } = render(<TransactionRow node={mkNode("deal", { metadata: { comment: "hello note" } })} />);
    expand(container);
    expect(screen.getByText("«hello note»")).toBeInTheDocument();
    fireEvent.click(screen.getByText("trv2_tx_edit_note"));
    expect(screen.getByTestId("note-modal")).toBeInTheDocument();
    unmount();
    // no perms → no edit-note button
    canFn = () => false;
    const { container: c2 } = render(<TransactionRow node={mkNode("deal")} />);
    expand(c2);
    expect(screen.queryByText("trv2_tx_edit_note")).toBeNull();
  });
});
