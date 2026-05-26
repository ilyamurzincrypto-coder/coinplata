import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

let canAccountingEdit = true;
vi.mock("../../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));

vi.mock("../../../store/offices.jsx", () => ({
  useOffices: () => ({
    findOffice: (id) => ({ "office-mark": { id: "office-mark", name: "Mark Antalya" } }[id] || null),
    activeOffices: [{ id: "office-mark", name: "Mark Antalya" }],
  }),
}));
vi.mock("../../../store/currencies.jsx", () => ({ useCurrencies: () => ({ codes: ["USD", "USDT", "TRY"] }) }));
vi.mock("../../../lib/supabaseWrite.js", () => ({
  rpcCreateLedgerAccount: vi.fn(async () => "1901"),
  withToast: vi.fn(async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: String(e) }; } }),
}));
vi.mock("../parts/AccountInlineEntries.jsx", () => ({
  __esModule: true,
  default: ({ accountId }) => <div data-testid="inline-entries">{accountId}</div>,
}));
const exportCSVSpy = vi.fn();
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVSpy(...a) }));

import AssetsTab from "./AssetsTab.jsx";

const formatBase = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

function renderTab(ctx = makeLedgerCtx()) {
  return render(<AssetsTab ctx={ctx} officeFilter="all" formatBase={formatBase} baseCurrency="USD" onOpenTx={() => {}} />);
}

describe("AssetsTab — pivot Office × Currency", () => {
  beforeEach(() => { canAccountingEdit = true; exportCSVSpy.mockClear(); });

  it("рендерит таблицу с заголовком 'Касса' + колонками валют + правой ≈USD", () => {
    renderTab();
    const thead = document.querySelector("thead");
    expect(thead).not.toBeNull();
    expect(within(thead).getByText("trv2_assets_col_office")).toBeInTheDocument();
    expect(within(thead).getByText("USD")).toBeInTheDocument();
    expect(within(thead).getByText("USDT")).toBeInTheDocument();
  });

  it("строки-офисы видны: 'Mark Antalya' и 'trv2_assets_no_office'", () => {
    renderTab();
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.getByText("trv2_assets_no_office")).toBeInTheDocument();
    expect(screen.queryByText("1110")).toBeNull();
  });

  it("клик по строке-офису раскрывает листы-счета", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("Cash · Mark Antalya · USD")).toBeInTheDocument();
    expect(screen.getByText("1316")).toBeInTheDocument();
  });

  it("клик по строке-листу разворачивает AccountInlineEntries", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    fireEvent.click(screen.getByText("Cash · Mark Antalya · USD"));
    expect(screen.getByTestId("inline-entries")).toHaveTextContent("ac_cash_usd_mark");
  });

  it("строка ИТОГО внизу с grand-total в base", () => {
    renderTab();
    const tfoot = document.querySelector("tfoot");
    expect(tfoot).not.toBeNull();
    expect(within(tfoot).getByText("trv2_assets_grand_total")).toBeInTheDocument();
    expect(within(tfoot).getByText("$12,150")).toBeInTheDocument();
  });

  it("клик по заголовку колонки USD сортирует строки по этой колонке", () => {
    renderTab();
    const tbody = document.querySelector("tbody");
    const rowsBefore = within(tbody).getAllByRole("row");
    expect(within(rowsBefore[0]).queryByText("Mark Antalya")).toBeTruthy();

    fireEvent.click(within(document.querySelector("thead")).getByText("USD"));
    fireEvent.click(within(document.querySelector("thead")).getByText("USD")); // asc
    const rowsAsc = within(tbody).getAllByRole("row");
    expect(within(rowsAsc[0]).queryByText("trv2_assets_no_office")).toBeTruthy();
  });

  it("кнопка 'Ненулевые' скрывает офисы с нулём и валюты с Σ==0", () => {
    const ctx = makeLedgerCtx({
      accounts: [
        { id: "a1", code: "1", name: "non-zero", type: "asset", subtype: "cash", currency: "USD", officeId: "office-mark" },
        { id: "a2", code: "2", name: "zero", type: "asset", subtype: "cash", currency: "USD", officeId: null },
      ],
      balances: [
        { accountId: "a1", currency: "USD", clientId: null, partnerId: null, balance: 100 },
      ],
    });
    renderTab(ctx);
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.getByText("trv2_assets_no_office")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ненулевые"));
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.queryByText("trv2_assets_no_office")).toBeNull();
  });

  it("CSV-экспорт вызывается с pivot-колонками (office + currencies + base_<ccy>) и строкой ИТОГО", () => {
    renderTab();
    fireEvent.click(screen.getByText(/^CSV$/));
    expect(exportCSVSpy).toHaveBeenCalledTimes(1);
    const arg = exportCSVSpy.mock.calls[0][0];
    expect(arg.filename).toMatch(/^assets_\d{4}-\d{2}-\d{2}\.csv$/);
    const colKeys = arg.columns.map((c) => c.key);
    expect(colKeys[0]).toBe("office");
    expect(colKeys).toContain("USD");
    expect(colKeys).toContain("USDT");
    expect(colKeys[colKeys.length - 1]).toBe("base_usd");
    const lastRow = arg.rows[arg.rows.length - 1];
    expect(lastRow.office).toBe("trv2_assets_grand_total");
    expect(lastRow.base_usd).toBe(12150);
  });

  it("кнопка '+ Счёт в план' видна только при accounting:edit", () => {
    const { unmount } = renderTab();
    expect(screen.getByText("trv2_chart_add_btn")).toBeInTheDocument();
    unmount();
    canAccountingEdit = false;
    renderTab();
    expect(screen.queryByText("trv2_chart_add_btn")).toBeNull();
  });

  it("empty-state когда нет asset-счетов", () => {
    const ctx = makeLedgerCtx({ accounts: [], balances: [] });
    renderTab(ctx);
    expect(screen.getByText("trv2_no_accounts")).toBeInTheDocument();
  });
});
