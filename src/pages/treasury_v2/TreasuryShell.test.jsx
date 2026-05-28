// Integration smoke for the Treasury shell: real selectors + parts, mocked stores.
// Catches runtime wiring errors (tab switching, account expand, journal drill-down
// modal) that the per-tab render smokes don't cover.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const fx = vi.hoisted(() => {
  const NOW = new Date().toISOString();
  return {
    NOW,
    accounts: [
      { id: "ac_cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
      { id: "ac_liab", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null },
      { id: "ac_open", code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
    ],
    balances: [
      { accountId: "ac_cash", currency: "USD", clientId: null, partnerId: null, balance: 1000 },
      { accountId: "ac_liab", currency: "USD", clientId: null, partnerId: null, balance: -300 },
      { accountId: "ac_open", currency: "USD", clientId: null, partnerId: null, balance: 1300 },
    ],
    transactions: [
      { id: "tx1", effectiveDate: NOW, createdAt: NOW, kind: "deal", sourceRefId: "D-7", reversesTransactionId: null, metadata: { note: "smoke-tx" } },
    ],
    entries: [
      { id: "e1", transactionId: "tx1", accountId: "ac_cash", direction: "dr", amount: 100, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
      { id: "e2", transactionId: "tx1", accountId: "ac_liab", direction: "cr", amount: 100, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: NOW },
    ],
  };
});

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../store/offices.jsx", () => ({ useOffices: () => ({ activeOffices: [], findOffice: () => null }) }));
vi.mock("../../store/openObligations.js", () => ({ useOpenObligations: () => ({ items: [], loading: false }) }));
vi.mock("../../store/baseCurrency.js", () => ({
  useBaseCurrency: () => ({ toBase: (a) => Number(a) || 0, formatBase: (a) => `$${Number(a) || 0}`, base: "USD" }),
}));
vi.mock("../../store/rates.jsx", () => ({
  useRates: () => ({ getRate: (from, to) => (from === to ? 1 : 1) }),
}));
vi.mock("../../store/ledger.jsx", () => ({
  useLedger: () => ({
    accounts: fx.accounts, balances: fx.balances, transactions: fx.transactions, entries: fx.entries,
    loading: false, sinceIso: "2000-01-01T00:00:00.000Z", extendWindow: () => {},
  }),
}));

let canAccountingEdit = false;
vi.mock("../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));
vi.mock("../../lib/toast.jsx", () => ({ emitToast: () => {} }));
vi.mock("../../lib/newLedger.js", () => ({ rpcCreateManualEntryV2: () => Promise.resolve("tx-x"), rpcReverseTransactionV2: () => Promise.resolve(["rev-x"]) }));

import TreasuryShell from "./TreasuryShell.jsx";

describe("TreasuryShell integration smoke", () => {
  it("renders the tabs, opens on the Dashboard, and the Assets tab merges single-account currencies into one row on office click", () => {
    render(<TreasuryShell />);
    for (const key of ["trv2_tab_dashboard", "trv2_tab_assets", "trv2_tab_liabilities", "trv2_tab_equity", "trv2_tab_transactions"]) {
      expect(screen.getByRole("button", { name: key })).toBeInTheDocument();
    }
    // Dashboard is the landing tab → видим KPI «Капитал (чистый)» из новой шапки
    expect(screen.getByText("Капитал (чистый)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_assets" }));
    // ac_cash has officeId null → "no office" row is the only office row; leaves hidden until expanded
    expect(screen.getByText("trv2_assets_no_office")).toBeInTheDocument();
    expect(screen.queryByText("1110")).toBeNull();
    // expand office → 1 счёт в USD → merged-строка, код 1110 сразу виден
    fireEvent.click(screen.getByText("trv2_assets_no_office"));
    expect(screen.getByText("1110")).toBeInTheDocument();
  });

  it("clicking a leaf account opens the AccountDetailModal with its source-doc link", () => {
    render(<TreasuryShell />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_assets" }));
    expect(document.body.textContent).not.toContain("D-7");
    fireEvent.click(screen.getByText("trv2_assets_no_office"));
    // merged-строка → клик по № счёта 1110 → модал
    fireEvent.click(screen.getByText("1110"));
    // Modal renders entries via portal to document.body — D-7 is the sourceRefId of the seed tx
    expect(document.body.textContent).toContain("D-7");
  });

  it("switches to Транзакции и видит ссылку на исходный документ в entries-view", () => {
    render(<TreasuryShell />);
    // дефолтное view — entries (плоская таблица); flatEntries показывают D-7 как doc-ссылку
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_transactions" }));
    expect(document.body.textContent).toContain("D-7");
  });
});

describe("TreasuryShell — manual entry inline в Транзакциях", () => {
  // Ручная проводка теперь inline в Транзакциях (не модал).
  it("nikогда не рендерит standalone Manual-entry таб", () => {
    canAccountingEdit = true;
    render(<TreasuryShell />);
    expect(screen.queryByRole("button", { name: "trv2_pm_tab" })).toBeNull();
  });
  it("показывает PostingTab inline в Транзакциях при accounting:edit (открыт по умолчанию)", () => {
    canAccountingEdit = true;
    try { localStorage.removeItem("coinplata:journal-posting-open"); } catch {}
    render(<TreasuryShell />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_transactions" }));
    // PostingTab.Провести виден сразу (inline-card открыта)
    expect(screen.getByRole("button", { name: "trv2_pm_post" })).toBeInTheDocument();
  });
  it("скрывает '+Ручная проводка' card без accounting:edit", () => {
    canAccountingEdit = false;
    render(<TreasuryShell />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_tab_transactions" }));
    expect(screen.queryByRole("button", { name: "trv2_journal_new_manual" })).toBeNull();
  });
});

// Tabs Сделки/Календарь/ДДС/Корр-счета/P&L/Обороты выпилены 2026-05-26 —
// связанные интеграционные тесты удалены вместе с ними.
