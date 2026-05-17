import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// t returns the key (with the optional second arg as fallback when given)
vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k, fb) => (fb != null ? fb : k) }) }));

import CashFlowTab from "./CashFlowTab.jsx";
import { OfficesProvider } from "../../../store/offices.jsx";

const NOW = new Date().toISOString();

// A tiny ledger: opening Dr cash 1000 / Cr equity 1000; then a deal moves
// Dr cash 200 (in) and a topup Cr cash 50 (out) — both this month.
function makeCtx(overrides = {}) {
  const accounts = [
    { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "ofA", clientDimRequired: false, partnerDimRequired: false },
    { id: "hot", code: "1316", name: "Hot USDT", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: "ofA", clientDimRequired: false, partnerDimRequired: false },
    { id: "clear", code: "1900", name: "Clearing USD", type: "asset", subtype: "clearing", currency: "USD", officeId: "ofA", clientDimRequired: false, partnerDimRequired: false },
    { id: "eq", code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
  ];
  const transactions = [
    { id: "tO", effectiveDate: NOW, createdAt: NOW, kind: "opening", sourceRefId: null, reversesTransactionId: null, metadata: {} },
    { id: "tD", effectiveDate: NOW, createdAt: NOW, kind: "deal", sourceRefId: "D-1", reversesTransactionId: null, metadata: {} },
    { id: "tT", effectiveDate: NOW, createdAt: NOW, kind: "topup", sourceRefId: null, reversesTransactionId: null, metadata: {} },
  ];
  const entries = [
    { id: "e1", transactionId: "tO", accountId: "cash", direction: "dr", amount: 1000, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e2", transactionId: "tO", accountId: "eq", direction: "cr", amount: 1000, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e3", transactionId: "tD", accountId: "cash", direction: "dr", amount: 200, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e4", transactionId: "tD", accountId: "clear", direction: "cr", amount: 200, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e5", transactionId: "tT", accountId: "cash", direction: "cr", amount: 50, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    { id: "e6", transactionId: "tT", accountId: "clear", direction: "dr", amount: 50, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
  ];
  const balances = [
    { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 1150 },
    { accountId: "clear", currency: "USD", clientId: null, partnerId: null, balance: -150 },
    { accountId: "eq", currency: "USD", clientId: null, partnerId: null, balance: 1000 },
  ];
  const rate = (c) => ({ USD: 1, USDT: 1 }[String(c).toUpperCase()] ?? 0);
  return {
    accounts, transactions, entries, balances,
    toBase: (a, c) => Number(a) * rate(c),
    baseCurrency: "USD", officeFilter: "all",
    extendWindow: () => {}, sinceIso: "2000-01-01T00:00:00.000Z",
    counterpartyOptions: () => [],
    counterpartyName: () => null,
    ...overrides,
  };
}

function renderTab(ctx = makeCtx(), officeFilter = "all") {
  return render(
    <OfficesProvider>
      <CashFlowTab ctx={ctx} officeFilter={officeFilter} formatBase={(n) => `$${n}`} baseCurrency="USD" />
    </OfficesProvider>
  );
}

describe("CashFlowTab — IFRS structure", () => {
  it("renders 3 IFRS sections (Operating / Investing / Financing) when there is movement", () => {
    renderTab();
    expect(screen.getByText("Операционная деятельность")).toBeInTheDocument();
    expect(screen.getByText("Инвестиционная деятельность")).toBeInTheDocument();
    expect(screen.getByText("Финансовая деятельность")).toBeInTheDocument();
  });

  it("renders the management metrics card with Сделок / Оборот / Маржа / Coverage", () => {
    renderTab();
    expect(screen.getByText("Сделок")).toBeInTheDocument();
    expect(screen.getByText("Оборот")).toBeInTheDocument();
    expect(screen.getByText("Маржа")).toBeInTheDocument();
    expect(screen.getByText("Coverage")).toBeInTheDocument();
  });

  it("ignores entries on internal clearing accounts (not cash/bank/crypto)", () => {
    // Clearing legs (e4 Cr 200, e6 Dr 50) must not affect totals. Если бы
    // считались, чистое изменение было бы +1300 а не +1150.
    renderTab();
    // 1150 = opening 1000 + deal 200 − topup 50 (только cash-ноги)
    // 1300 = + clear Dr 50 (если бы клиринг шёл в pool)
    // Число форматируется с разделителем (1,150 / 1 150 / 1 150). Проверяем
    // что любая из форм 1150 присутствует, а 1300 нет.
    const dom = document.body.textContent.replace(/[\s, ]/g, "");
    expect(dom).toContain("1150");
    expect(dom).not.toContain("1300");
  });

  it("shows the empty state when there are no entries at all", () => {
    renderTab(makeCtx({ entries: [], transactions: [] }));
    expect(screen.getByText("trv2_cf_empty")).toBeInTheDocument();
  });

  it("respects the office filter — accounts in another office produce empty state", () => {
    const ctx = makeCtx();
    ctx.accounts = ctx.accounts.map((a) => (a.id === "cash" || a.id === "hot" ? { ...a, officeId: "ofB" } : a));
    renderTab(ctx, "ofA");
    expect(screen.getByText("trv2_cf_empty")).toBeInTheDocument();
  });

  it("renders the period picker and CSV export button", () => {
    renderTab();
    expect(screen.getByText("CSV")).toBeInTheDocument();
  });
});
