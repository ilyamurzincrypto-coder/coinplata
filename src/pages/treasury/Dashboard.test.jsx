// src/pages/treasury/Dashboard.test.jsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../../i18n/translations.jsx";

// Mock the store hooks Dashboard pulls from. We pass enough shape to render
// without throwing — actual selector logic is unit-tested in selectors.test.js.
import { vi } from "vitest";

vi.mock("../../store/accounts.jsx", () => ({
  useAccounts: () => ({
    accounts: [],
    balanceOf: () => 0,
    reservedOf: () => 0,
    movements: [],
  }),
}));
vi.mock("../../store/obligations.jsx", () => ({
  useObligations: () => ({ obligations: [] }),
}));
vi.mock("../../store/transactions.jsx", () => ({
  useTransactions: () => ({ transactions: [] }),
}));
vi.mock("../../store/rates.jsx", () => ({
  useRates: () => ({ rates: [], confirmedAt: new Date().toISOString(), modifiedAfterConfirmation: false }),
}));
vi.mock("../../store/offices.jsx", () => ({
  useOffices: () => ({ findOffice: () => ({ id: "mark", name: "Mark Antalya" }) }),
}));
vi.mock("../../store/baseCurrency.js", () => ({
  useBaseCurrency: () => ({
    toBase: (a) => a,
    formatBase: (a) => `${a}`,
    baseCurrency: "USD",
  }),
}));

import Dashboard from "./Dashboard.jsx";

describe("Dashboard smoke render", () => {
  it("renders EmptyState when office has no accounts", () => {
    const { container } = render(
      <I18nProvider>
        <Dashboard officeId="mark" />
      </I18nProvider>
    );
    expect(container.textContent).toMatch(/No accounts|Нет счетов|Hesap yok|пока нет счетов/i);
  });
});
