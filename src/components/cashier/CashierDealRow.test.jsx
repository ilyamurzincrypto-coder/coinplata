import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
let canFn = () => false;
vi.mock("../../store/permissions.jsx", () => ({ useCan: () => canFn }));
// Heavy children — stub to thin markers (mirrors how other row tests do it).
vi.mock("./DealDetail.jsx", () => ({ __esModule: true, default: ({ node }) => <div data-testid="deal-detail" data-tx={node.tx.id} /> }));
vi.mock("../../pages/treasury_v2/parts/ReverseEntryModal.jsx", () => ({ __esModule: true, default: ({ tx, cascade }) => <div data-testid="reverse-modal" data-tx={tx.id} data-cascade={String(!!cascade)} /> }));
vi.mock("../../pages/treasury_v2/parts/EditTxNoteModal.jsx", () => ({ __esModule: true, default: ({ tx }) => <div data-testid="note-modal" data-tx={tx.id} /> }));

import CashierDealRow from "./CashierDealRow.jsx";

const ACC_BY_ID = new Map([
  ["a_cash", { id: "a_cash", code: "1110", name: "Касса USD", type: "asset", subtype: "cash", currency: "USD" }],
  ["a_hot", { id: "a_hot", code: "1316", name: "Hot USDT", type: "asset", subtype: "crypto_input", currency: "USDT" }],
  ["r_spread", { id: "r_spread", code: "4010", name: "Доход: спред", type: "revenue", subtype: "spread", currency: "USD" }],
]);
// A clean deal: in 1000 USD → out 950 USDT, margin 50 USD.
const mkNode = (overrides = {}) => ({
  tx: { id: "tx-deal-1", effectiveDate: "2026-05-10T12:30:00Z", kind: "deal", status: "posted", reversesTransactionId: null, metadata: { client_nickname: "Иван Петров" }, ...overrides },
  entries: [
    { id: "e1", accountId: "a_cash", direction: "dr", amount: 1000, currency: "USD", accountName: "Касса USD", clientId: null },
    { id: "e2", accountId: "a_hot", direction: "cr", amount: 950, currency: "USDT", accountName: "Hot USDT", clientId: null },
    { id: "e3", accountId: "r_spread", direction: "cr", amount: 50, currency: "USD", accountName: "Доход: спред", clientId: null },
  ],
});
const expand = (container) => fireEvent.click(container.querySelector("div.cursor-pointer"));

describe("CashierDealRow", () => {
  beforeEach(() => { canFn = () => false; });

  it("collapsed: shows counterparty, «пришло → ушло», status badge — no Дт/Кт, no tx-id", () => {
    const { container } = render(<CashierDealRow node={mkNode()} accById={ACC_BY_ID} counterpartyName={() => "—"} />);
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    const stripped = container.textContent.replace(/[\s ,]/g, "");
    expect(stripped).toContain("1000USD");   // in leg
    expect(stripped).toContain("950USDT");   // out leg
    expect(container.textContent).toContain("cashdeal_status_posted");
    // managerial — never the accounting bits
    expect(container.textContent).not.toContain("Дт");
    expect(container.textContent).not.toContain("Кт");
    expect(container.textContent).not.toContain("tx-deal-1"); // no raw tx-id on the row
  });

  it("falls back to counterpartyName(clientId) when no metadata nickname", () => {
    const node = mkNode({ metadata: {} });
    node.entries[0].clientId = "c-1";
    render(<CashierDealRow node={node} accById={ACC_BY_ID} counterpartyName={(id) => (id === "c-1" ? "ООО Ромашка" : "—")} />);
    expect(screen.getByText("ООО Ромашка")).toBeInTheDocument();
  });

  it("shows the «obligation» badge when the deal has a deferred leg", () => {
    render(<CashierDealRow node={mkNode({ metadata: { has_deferred: true } })} accById={ACC_BY_ID} counterpartyName={() => "—"} />);
    expect(screen.getByText("cashdeal_has_obligation")).toBeInTheDocument();
    expect(screen.queryByText("cashdeal_status_posted")).toBeNull();
  });

  it("expanded: renders DealDetail and (with transactions:edit) the «Отменить сделку» action → ReverseEntryModal cascade=true", () => {
    canFn = (section) => section === "transactions";
    const { container } = render(<CashierDealRow node={mkNode()} accById={ACC_BY_ID} counterpartyName={() => "—"} />);
    expand(container);
    expect(screen.getByTestId("deal-detail").getAttribute("data-tx")).toBe("tx-deal-1");
    fireEvent.click(screen.getByText("trv2_journal_undo_deal"));
    const modal = screen.getByTestId("reverse-modal");
    expect(modal.getAttribute("data-cascade")).toBe("true");
  });

  it("no «Отменить сделку» on a reversed deal or without the right permission", () => {
    canFn = () => false;
    const { container, unmount } = render(<CashierDealRow node={mkNode()} accById={ACC_BY_ID} counterpartyName={() => "—"} />);
    expand(container);
    expect(screen.queryByText("trv2_journal_undo_deal")).toBeNull();
    unmount();
    canFn = () => true;
    const { container: c2 } = render(<CashierDealRow node={mkNode({ status: "reversed" })} accById={ACC_BY_ID} counterpartyName={() => "—"} />);
    expand(c2);
    expect(screen.queryByText("trv2_journal_undo_deal")).toBeNull();
    expect(screen.getByText("cashdeal_status_reversed")).toBeInTheDocument();
  });
});
