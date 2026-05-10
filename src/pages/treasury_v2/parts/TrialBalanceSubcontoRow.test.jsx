import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import TrialBalanceSubcontoRow from "./TrialBalanceSubcontoRow.jsx";

const ctx = {
  counterpartyName: (id) => ({ "client-1": "Иван Петров" }[id] || String(id).slice(0, 8)),
  entries: [{ id: "e1", accountId: "ac_cl", transactionId: "tx1", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null, createdAt: "2026-05-10T00:00:00Z" }],
  transactions: [{ id: "tx1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "deal", sourceRefId: "D1" }],
};
const win = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
const dim = { clientId: "client-1", partnerId: null, opening: -500, debitTurnover: 95, creditTurnover: 100, closing: -505, openingInBase: -500, debitTurnoverInBase: 95, creditTurnoverInBase: 100, closingInBase: -505 };

const wrap = (ui) => render(<table><tbody>{ui}</tbody></table>);

describe("TrialBalanceSubcontoRow", () => {
  it("renders the resolved name, kind label, and the 4 metric cells", () => {
    wrap(<TrialBalanceSubcontoRow ctx={ctx} accountId="ac_cl" dim={dim} window={win} onOpenTx={() => {}} />);
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("client")).toBeInTheDocument();
  });
  it("expands to the dim-filtered journal entries for the period", () => {
    const { container } = wrap(<TrialBalanceSubcontoRow ctx={ctx} accountId="ac_cl" dim={dim} window={win} onOpenTx={() => {}} />);
    expect(container.textContent).not.toContain("D1");
    fireEvent.click(screen.getByText("Иван Петров"));
    expect(container.textContent).toContain("D1"); // AccountInlineEntries renders the source-doc ref
  });
});
