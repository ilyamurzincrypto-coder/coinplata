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
vi.mock("../../../store/rates.jsx", () => ({ useRates: () => ({ getRate: (f, t) => (f === t ? 1 : 1) }) }));
vi.mock("../../../lib/supabaseWrite.js", () => ({
  rpcCreateLedgerAccount: vi.fn(async () => "1901"),
  withToast: vi.fn(async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: String(e) }; } }),
}));
vi.mock("../parts/AccountDetailModal.jsx", () => ({
  __esModule: true,
  default: ({ open, accountId }) => open ? <div data-testid="detail-modal">{accountId}</div> : null,
}));
const exportCSVSpy = vi.fn();
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVSpy(...a) }));

import AssetsTab from "./AssetsTab.jsx";

const formatBase = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

function renderTab(ctx = makeLedgerCtx()) {
  return render(<AssetsTab ctx={ctx} officeFilter="all" formatBase={formatBase} baseCurrency="USD" onOpenTx={() => {}} />);
}

describe("AssetsTab — дерево Office → Currency → Account", () => {
  beforeEach(() => { canAccountingEdit = true; exportCSVSpy.mockClear(); });

  it("рендерит таблицу с шапкой 'Касса' + 'Native' + base-picker и строки-офисы", () => {
    renderTab();
    const thead = document.querySelector("thead");
    expect(thead).not.toBeNull();
    expect(within(thead).getByText("trv2_assets_col_office")).toBeInTheDocument();
    expect(within(thead).getByText("Native")).toBeInTheDocument();
    // base-picker <select> с дефолтом USD
    const baseSelect = within(thead).getByTitle("Сменить валюту приведения");
    expect(baseSelect.value).toBe("USD");
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.getByText("trv2_assets_no_office")).toBeInTheDocument();
    // листья и валюты-строки скрыты до раскрытия (USD в шапке как option — не учитываем)
    expect(screen.queryByText("1110")).toBeNull();
  });

  it("клик по офису раскрывает валюты; клик по валюте раскрывает листья", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    const tbody = document.querySelector("tbody");
    // USD строка валюты в tbody
    expect(within(tbody).getByText("USD")).toBeInTheDocument();
    expect(within(tbody).getByText("USDT")).toBeInTheDocument();
    expect(screen.queryByText("1110")).toBeNull();
    fireEvent.click(within(tbody).getByText("USD"));
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("Cash · Mark Antalya · USD")).toBeInTheDocument();
  });

  it("клик по листу открывает AccountDetailModal", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    const tbody = document.querySelector("tbody");
    fireEvent.click(within(tbody).getByText("USD"));
    fireEvent.click(screen.getByText("Cash · Mark Antalya · USD"));
    expect(screen.getByTestId("detail-modal")).toHaveTextContent("ac_cash_usd_mark");
  });

  it("строка ИТОГО внизу с grand-total в base", () => {
    renderTab();
    const tfoot = document.querySelector("tfoot");
    expect(tfoot).not.toBeNull();
    expect(within(tfoot).getByText("trv2_assets_grand_total")).toBeInTheDocument();
    // 11000 USD (cash mark) + 150 USDT (hot mark) + 1000 USDT (treasury) = 12150
    expect(within(tfoot).getByText("$12,150")).toBeInTheDocument();
  });

  it("кнопка 'Ненулевые' скрывает офисы с нулём", () => {
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

  it("CSV-экспорт — flat per-account (office, code, name, currency, native, base)", () => {
    renderTab();
    fireEvent.click(screen.getByText(/^CSV$/));
    expect(exportCSVSpy).toHaveBeenCalledTimes(1);
    const arg = exportCSVSpy.mock.calls[0][0];
    expect(arg.filename).toMatch(/^assets_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(arg.columns.map((c) => c.key)).toEqual([
      "office", "accountCode", "accountName", "currency", "balance", "balanceInBase",
    ]);
    // три asset-счёта = три строки
    expect(arg.rows).toHaveLength(3);
    expect(arg.rows[0]).toMatchObject({ accountCode: "1110", currency: "USD", balance: 11000, balanceInBase: 11000 });
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
