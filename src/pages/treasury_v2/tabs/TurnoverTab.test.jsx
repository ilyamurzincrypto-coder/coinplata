// ОСВ в каноне: разделы как в Реестре, без «шахматки» и развёрток, сходимость по валютам.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import TurnoverTab, { checkByCurrency } from "./TurnoverTab.jsx";
import { SECTION } from "../../../lib/ledgerView/accountRoles.js";

const NOW = new Date().toISOString();
const accounts = [
  { id: "cash", code: "1110", name: "Касса USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "liab", code: "2110", name: "Клиенты USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null },
  { id: "rev", code: "4210", name: "Спред USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
];
const transactions = [{ id: "T1", effectiveDate: NOW, createdAt: NOW, kind: "manual", sourceRefId: null }];
const entries = [
  { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 50, currency: "USD", createdAt: NOW },
  { id: "e2", transactionId: "T1", accountId: "rev", direction: "cr", amount: 50, currency: "USD", createdAt: NOW },
];
const balances = [
  { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 50 },
  { accountId: "liab", currency: "USD", clientId: null, partnerId: null, balance: 20 },
  { accountId: "rev", currency: "USD", clientId: null, partnerId: null, balance: 50 },
];
const ctx = {
  accounts, transactions, entries, balances,
  toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all",
  sinceIso: "2000-01-01T00:00:00.000Z", extendWindow: () => {},
};

const renderTab = () =>
  render(<TurnoverTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);

describe("ОСВ", () => {
  it("показывает счета с канон-колонками", () => {
    renderTab();
    for (const label of ["Счёт", "Наименование", "Сальдо нач.", "Оборот Дт", "Оборот Кт", "Сальдо кон."]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("4210")).toBeInTheDocument();
  });

  it("разделы те же, что в Реестре — и никакой «шахматки»", () => {
    renderTab();
    expect(screen.getByText("Ностро и кассы")).toBeInTheDocument();
    expect(screen.getByText("Лоро")).toBeInTheDocument();
    expect(screen.getByText("Капитал")).toBeInTheDocument();
    expect(screen.queryByText(/[Шш]ахматк/)).toBeNull();
  });

  it("доход лежит в Капитале, а не отдельным классом", () => {
    renderTab();
    // 4210 «Спред» — это капитал по раскладке; отдельного раздела «Доходы» быть не должно.
    expect(screen.queryByText("Доходы")).toBeNull();
    expect(screen.queryByText("Расходы")).toBeNull();
  });
});

describe("checkByCurrency", () => {
  const rows = (over = {}) => [
    { currency: "USD", section: SECTION.NOSTRO, closing: 100 },
    { currency: "USD", section: SECTION.LORO, closing: 40 },
    { currency: "USD", section: SECTION.CAPITAL, closing: 60, ...over },
  ];

  it("сходится, когда Ностро − Лоро − Капитал = 0", () => {
    const [usd] = checkByCurrency(rows());
    expect(usd.delta).toBeCloseTo(0, 10);
  });

  it("показывает невязку, а не прячет её", () => {
    const [usd] = checkByCurrency(rows({ closing: 55 }));
    expect(usd.delta).toBeCloseTo(5, 10);
  });

  it("валюты считаются отдельно и не складываются", () => {
    const out = checkByCurrency([
      { currency: "USD", section: SECTION.NOSTRO, closing: 100 },
      { currency: "TRY", section: SECTION.NOSTRO, closing: 4000 },
    ]);
    expect(out.map((r) => r.currency)).toEqual(["TRY", "USD"]);
    expect(out.find((r) => r.currency === "TRY").nostro).toBe(4000);
    expect(out.find((r) => r.currency === "USD").nostro).toBe(100);
  });
});
