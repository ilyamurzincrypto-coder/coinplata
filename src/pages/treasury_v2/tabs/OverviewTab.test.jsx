// Обзор Казначейства: модель Ностро · Лоро · Капитал с приведением к $ и €.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../../store/baseCurrency.js", () => ({
  // 1 RUB = 0.0119 USD, 1 USD = 0.875 EUR — хватает, чтобы отличить $ от €.
  useBaseCurrency: () => ({
    getRateFx: (from, to) => {
      if (from === to) return 1;
      const usd = { RUB: 0.0119, USD: 1, EUR: 1 / 0.875 };
      return usd[from] / usd[to];
    },
  }),
}));

import OverviewTab from "./OverviewTab.jsx";

const ctx = {
  accounts: [
    { id: "a1", type: "asset", currency: "RUB", code: "1110", name: "Касса RUB", officeId: "o1" },
    { id: "l1", type: "liability", currency: "RUB", code: "2110", name: "Клиенты RUB", officeId: "o1" },
  ],
  balances: [
    { accountId: "a1", currency: "RUB", balance: 19591.83 },
    { accountId: "l1", currency: "RUB", balance: 12000, clientId: "c1" },
    { accountId: "l1", currency: "RUB", balance: 591.83, clientId: "c2" },
  ],
  transactions: [],
  entries: [],
  clients: [],
  toBase: (n) => n,
};

function renderTab() {
  return render(
    <OverviewTab
      ctx={ctx}
      officeFilter="all"
      formatBase={(n) => `$${n}`}
      baseCurrency="USD"
      totals={{ identityCheck: { ok: true, delta: 0 } }}
    />
  );
}

describe("OverviewTab — Ностро / Лоро / Капитал", () => {
  it("группы колонок Ностро, Лоро, Капитал и без переключателя приведения", () => {
    renderTab();
    expect(screen.getByText("trv2_ov_col_assets")).toBeInTheDocument();
    expect(screen.getByText("trv2_ov_col_liabilities")).toBeInTheDocument();
    expect(screen.queryByText("trv2_ov_conversion")).not.toBeInTheDocument();
  });

  it("родная сумма и приведение к $ и € по каждой группе; капитал = Н − Л", () => {
    const { container } = renderTab();
    const text = container.textContent.replace(/ | /g, " ");
    expect(text).toContain("19 591,83"); // Ностро RUB
    expect(text).toContain("12 591,83"); // Лоро RUB (сумма по клиентам)
    expect(text).toContain("7 000,00");  // Капитал RUB
    expect(text).toContain("233,14 $");  // 19 591,83 × 0.0119
    expect(text).toContain("204,00 €");  // 233,14 × 0.875
  });

  it("раскрытие валюты показывает её счета", () => {
    renderTab();
    expect(screen.queryByText("Касса RUB")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Касса RUB")).toBeInTheDocument();
    expect(screen.getByText("Клиенты RUB")).toBeInTheDocument();
  });
});
