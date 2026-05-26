import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const exportCSVMock = vi.fn();
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVMock(...a) }));
vi.mock("../PeriodPicker.jsx", () => ({
  __esModule: true,
  default: () => null,
  presetWindow: () => ({ from: "1970-01-01T00:00:00Z", to: "2999-12-31T00:00:00Z" }),
}));
vi.mock("../parts/TransactionRow.jsx", () => ({
  __esModule: true,
  default: ({ node }) => <div data-testid="tx-row">{node.tx.id}</div>,
}));
vi.mock("./PostingTab.jsx", () => ({
  __esModule: true,
  default: ({ onDone }) => <button data-testid="posting-tab" onClick={() => onDone?.()}>posting-tab</button>,
}));

let canAccountingEdit = true;
vi.mock("../../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));

import JournalTab from "./JournalTab.jsx";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "a2", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null, clientDimRequired: true },
];
const TRANSACTIONS = [
  { id: "tx_a", effectiveDate: "2026-05-01T00:00:00Z", kind: "deal", sourceRefId: null, reversesTransactionId: null, metadata: {} },
  { id: "tx_b", effectiveDate: "2026-05-02T00:00:00Z", kind: "deal", sourceRefId: null, reversesTransactionId: null, metadata: {} },
];
const ENTRIES = [
  { id: "e1", transactionId: "tx_a", accountId: "a1", direction: "dr", amount: 100, currency: "USD", clientId: null, partnerId: null },
  { id: "e2", transactionId: "tx_a", accountId: "a2", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null },
  { id: "e3", transactionId: "tx_b", accountId: "a1", direction: "dr", amount: 50, currency: "USD", clientId: null, partnerId: null },
  { id: "e4", transactionId: "tx_b", accountId: "a2", direction: "cr", amount: 50, currency: "USD", clientId: "client-2", partnerId: null },
];

const ctx = {
  accounts: ACCOUNTS,
  transactions: TRANSACTIONS,
  entries: ENTRIES,
  balances: [],
  baseCurrency: "USD",
  toBase: (n) => n,
  sinceIso: "1970-01-01T00:00:00Z",
  extendWindow: () => {},
  counterpartyName: (id) => ({ "client-1": "Иван Петров", "client-2": "Алексей Сидоров" }[id] || id),
  counterpartyOptions: (k) => k === "client"
    ? [{ id: "client-1", name: "Иван Петров" }, { id: "client-2", name: "Алексей Сидоров" }]
    : [{ id: "p1", name: "OTC Acme" }],
};

function renderTab() {
  // Force tx view for tests that assert on TransactionRow data-testid.
  try { localStorage.setItem("coinplata:journal-view-mode", "tx"); } catch {}
  return render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
}

describe("JournalTab", () => {
  it("в tx-режиме рендерит обе транзакции", () => {
    renderTab();
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
  });

  it("Export CSV emits one row per journal_entry for the currently-filtered tree", () => {
    exportCSVMock.mockReset();
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "trv2_journal_export_csv" }));
    expect(exportCSVMock).toHaveBeenCalledTimes(1);
    const call = exportCSVMock.mock.calls[0][0];
    expect(call.rows).toHaveLength(4);
    const cols = call.columns.map((c) => c.key);
    expect(cols).toEqual(expect.arrayContaining(["tx_id", "side", "account_code", "amount", "currency", "client_id"]));
    expect(new Set(call.rows.map((r) => r.tx_id))).toEqual(new Set(["tx_a", "tx_b"]));
    expect(new Set(call.rows.map((r) => r.side))).toEqual(new Set(["Дт", "Кт"]));
  });

  it("counterparty picker filters the tree to only transactions touching the chosen client", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /trv2_journal_filter_cp_any/ }));
    fireEvent.click(screen.getByText(/Иван Петров/));
    const rows = screen.getAllByTestId("tx-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("tx_a");
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
  });

  it("free-text search filters the tree (debounced); a no-match query shows the search empty state", () => {
    vi.useFakeTimers();
    try {
      renderTab();
      const input = screen.getByPlaceholderText("trv2_search_placeholder");
      fireEvent.change(input, { target: { value: "cash" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
      fireEvent.change(input, { target: { value: "иван" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getAllByTestId("tx-row").map((r) => r.textContent)).toEqual(["tx_a"]);
      fireEvent.change(input, { target: { value: "tx_b" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.getAllByTestId("tx-row").map((r) => r.textContent)).toEqual(["tx_b"]);
      fireEvent.change(input, { target: { value: "zzz-nope" } });
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.queryAllByTestId("tx-row")).toHaveLength(0);
      expect(screen.getByText("trv2_search_no_results")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("PostingTab inline card hidden without accounting:edit", () => {
    canAccountingEdit = false;
    renderTab();
    // header «+Ручная проводка» (toggle of inline card) не виден
    expect(screen.queryByText("trv2_journal_new_manual")).toBeNull();
    expect(screen.queryByTestId("posting-tab")).toBeNull();
    canAccountingEdit = true;
  });

  it("PostingTab inline card visible by default with accounting:edit", () => {
    canAccountingEdit = true;
    try { localStorage.removeItem("coinplata:journal-posting-open"); } catch {}
    renderTab();
    expect(screen.getByText("trv2_journal_new_manual")).toBeInTheDocument();
    // открыт по умолчанию → PostingTab рендерится
    expect(screen.getByTestId("posting-tab")).toBeInTheDocument();
  });

  it("default view mode = entries (flat journal); toggle переключает на tx", () => {
    canAccountingEdit = false;
    try { localStorage.removeItem("coinplata:journal-view-mode"); } catch {}
    render(<JournalTab ctx={ctx} officeFilter="all" onOpenSource={() => {}} />);
    // в entries-view нет tx-row, есть flat-table
    expect(screen.queryByTestId("tx-row")).toBeNull();
    // 4 строки entries (по одной на каждый dr/cr leg)
    expect(document.querySelectorAll("tbody tr").length).toBe(4);
    // toggle на «Транзакции»
    fireEvent.click(screen.getByRole("button", { name: "trv2_journal_view_tx" }));
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
    canAccountingEdit = true;
  });
});
