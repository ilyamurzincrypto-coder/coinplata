import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import AccountRow from "./AccountRow.jsx";
import { AuthProvider } from "../../../store/auth.jsx";
import { PermissionsProvider } from "../../../store/permissions.jsx";

// AccountRow для plain-счёта рендерит InlineBalanceEditor — он использует
// useCan() и useAuth(). Чтобы не подтягивать всю prod-цепочку провайдеров
// в юнит-тесте, оборачиваем в AuthProvider + PermissionsProvider.
function Providers({ children }) {
  return (
    <AuthProvider>
      <PermissionsProvider>{children}</PermissionsProvider>
    </AuthProvider>
  );
}

const ctx = {
  counterpartyName: (id) => ({ "client-1": "Иван Петров", "client-2": "ООО Ромашка" }[id] || String(id).slice(0, 8)),
  counterpartyOptions: () => [],
  accounts: [
    { id: "ac_cl", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null, clientDimRequired: true, partnerDimRequired: false, active: true },
    { id: "ac_cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false, active: true },
  ],
  entries: [
    { id: "e1", accountId: "ac_cl", transactionId: "tx1", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null, createdAt: "2026-05-10T00:00:00Z" },
    { id: "e2", accountId: "ac_cl", transactionId: "tx1", direction: "dr", amount: 30, currency: "USD", clientId: "client-2", partnerId: null, createdAt: "2026-05-10T00:00:00Z" },
    { id: "e3", accountId: "ac_cash", transactionId: "tx1", direction: "dr", amount: 500, currency: "USD", clientId: null, partnerId: null, createdAt: "2026-05-10T00:00:00Z" },
  ],
  transactions: [{ id: "tx1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "deal", sourceRefId: "D1" }],
};
const fmt = (n) => `$${n}`;

describe("AccountRow — subconto drill-down", () => {
  it("a dimensioned account expands to subconto rows with resolved names; expanding one shows its entries", () => {
    const account = {
      accountId: "ac_cl", code: "2110", name: "Customer Liab USD", currency: "USD", balance: -130, balanceInBase: -130,
      dims: [
        { clientId: "client-1", partnerId: null, balance: -100, balanceInBase: -100 },
        { clientId: "client-2", partnerId: null, balance: -30, balanceInBase: -30 },
      ],
    };
    render(
      <Providers>
        <AccountRow account={account} ctx={ctx} formatBase={fmt} baseCurrency="USD" onOpenTx={() => {}} />
      </Providers>
    );
    fireEvent.click(screen.getByText("Customer Liab USD"));
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("ООО Ромашка")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Иван Петров"));
    expect(screen.getByRole("button", { name: "D1 →" })).toBeInTheDocument(); // e1 only (clientId client-1)
  });

  it("a plain account expands straight to its entries", () => {
    const account = { accountId: "ac_cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", balance: 500, balanceInBase: 500, dims: null };
    render(
      <Providers>
        <AccountRow account={account} ctx={ctx} formatBase={fmt} baseCurrency="USD" onOpenTx={() => {}} />
      </Providers>
    );
    fireEvent.click(screen.getByText("Cash USD"));
    expect(screen.getByRole("button", { name: "D1 →" })).toBeInTheDocument();
    expect(screen.queryByText("Иван Петров")).toBeNull();
  });
});
