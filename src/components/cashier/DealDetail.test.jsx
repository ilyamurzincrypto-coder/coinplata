import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import DealDetail from "./DealDetail.jsx";

const ACCOUNTS = [
  { id: "a_cash", code: "1110", name: "Касса USD", type: "asset", subtype: "cash", currency: "USD" },
  { id: "a_hot", code: "1316", name: "Hot-кошелёк USDT", type: "asset", subtype: "crypto_input", currency: "USDT" },
  { id: "l_cust", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD" },
  { id: "r_spread", code: "4010", name: "Revenue spread", type: "revenue", subtype: "spread", currency: "USD" },
  { id: "e_fx", code: "3210", name: "FX clearing", type: "asset", subtype: "fx_clearing", currency: "USD" },
];
const accById = new Map(ACCOUNTS.map((a) => [a.id, a]));

// A simple v2 deal: Dr cash 1000 USD / Cr Hot 950 USDT / Cr spread 50 USD,
// plus an fx_clearing leg (should be hidden) — counterparty "Иван".
const node = {
  tx: {
    id: "tx-deal-1",
    kind: "deal",
    status: "posted",
    effectiveDate: "2026-05-10T10:30:00Z",
    metadata: { client_nickname: "Иван", comment: "срочная сделка" },
  },
  entries: [
    { id: "e1", accountId: "a_cash", direction: "dr", amount: 1000, currency: "USD", accountName: "Касса USD" },
    { id: "e2", accountId: "e_fx", direction: "dr", amount: 1000, currency: "USD", accountName: "FX clearing" },
    { id: "e3", accountId: "a_hot", direction: "cr", amount: 950, currency: "USDT", accountName: "Hot-кошелёк USDT" },
    { id: "e4", accountId: "e_fx", direction: "cr", amount: 950, currency: "USDT", accountName: "FX clearing" },
    { id: "e5", accountId: "r_spread", direction: "cr", amount: 50, currency: "USD", accountName: "Revenue spread" },
  ],
};

describe("DealDetail", () => {
  it("renders the in/out amounts on real asset accounts, the margin, and the counterparty", () => {
    const { container } = render(<DealDetail node={node} accById={accById} counterpartyName={() => "ignored"} />);
    // normalize digit-group separators (locale may use ',', ' ', ' ', or none)
    const txt = container.textContent.replace(/[,\s  ]/g, "");
    expect(txt).toContain("1000USD·КассаUSD");
    expect(txt).toContain("950USDT·Hot-кошелёкUSDT");
    expect(txt).toContain("~50USD"); // margin
    expect(screen.getByText("Иван")).toBeInTheDocument();
  });

  it("hides the fx_clearing legs and never shows Дт/Кт or account codes", () => {
    const { container } = render(<DealDetail node={node} accById={accById} counterpartyName={() => "x"} />);
    expect(container.textContent).not.toContain("FX clearing");
    expect(container.textContent).not.toContain("Дт");
    expect(container.textContent).not.toContain("Кт");
    expect(container.textContent).not.toContain("1110");
    expect(container.textContent).not.toContain("3210");
  });

  it("falls back to counterpartyName(client_id) when metadata has no nickname", () => {
    const n2 = {
      tx: { id: "tx-2", kind: "deal", status: "posted", effectiveDate: "2026-05-10T10:00:00Z", metadata: {} },
      entries: [
        { id: "e1", accountId: "a_cash", direction: "dr", amount: 500, currency: "USD", accountName: "Касса USD", clientId: "11111111-2222-3333-4444-555555555555" },
        { id: "e2", accountId: "a_hot", direction: "cr", amount: 480, currency: "USDT", accountName: "Hot-кошелёк USDT" },
      ],
    };
    render(<DealDetail node={n2} accById={accById} counterpartyName={(id) => (id ? "Пётр" : "?")} />);
    expect(screen.getByText("Пётр")).toBeInTheDocument();
  });

  it("shows obligation lines for customer_liab Cr legs (deferred OUT)", () => {
    const n3 = {
      tx: { id: "tx-3", kind: "deal", status: "posted", effectiveDate: "2026-05-10T10:00:00Z", metadata: { has_deferred: true } },
      entries: [
        { id: "e1", accountId: "a_cash", direction: "dr", amount: 1000, currency: "USD", accountName: "Касса USD" },
        { id: "e2", accountId: "l_cust", direction: "cr", amount: 1000, currency: "USD", accountName: "Customer Liab USD" },
      ],
    };
    render(<DealDetail node={n3} accById={accById} counterpartyName={() => "—"} />);
    expect(screen.getByText(/cashdeal_out_obligation/)).toBeInTheDocument();
    expect(screen.getByText("cashdeal_has_obligation")).toBeInTheDocument();
  });
});
