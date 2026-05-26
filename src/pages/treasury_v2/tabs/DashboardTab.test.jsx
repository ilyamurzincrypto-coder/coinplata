import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k, lang: "ru" }) }));
vi.mock("../../../store/offices.jsx", () => ({ useOffices: () => ({ findOffice: (id) => ({ "office-mark": { name: "Mark Antalya" } }[id] || null) }) }));
const obligHook = vi.fn();
vi.mock("../../../store/openObligations.js", () => ({ useOpenObligations: () => obligHook() }));
vi.mock("../../../store/rates.jsx", () => ({ useRates: () => ({ getRate: (f, t) => (f === t ? 1 : 1) }) }));
vi.mock("../PeriodPicker.jsx", () => ({
  __esModule: true,
  default: () => null,
  presetWindow: () => ({ from: "1970-01-01T00:00:00Z", to: "2999-12-31T00:00:00Z" }),
}));

import DashboardTab from "./DashboardTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

function renderTab(ctx = makeLedgerCtx({ counterpartyName: (id) => ({ "client-1": "Иван Петров" }[id] || id) })) {
  return render(<DashboardTab ctx={ctx} officeFilter="all" baseCurrency="USD" formatBase={(n) => `$${n}`} onOpenSource={() => {}} />);
}

beforeEach(() => {
  obligHook.mockReturnValue({ items: [], loading: false });
  try { localStorage.removeItem("coinplata:dash-display-base"); } catch {}
});

describe("DashboardTab v2 — KPI + funds table + sidebar", () => {
  it("рендерит KPI-карточки с лейблами Активы/Клиенты/Капитал/Прибыль", () => {
    renderTab();
    expect(screen.getByText("Активы (наши)")).toBeInTheDocument();
    expect(screen.getByText("Клиенты (мы должны)")).toBeInTheDocument();
    expect(screen.getByText("Капитал (чистый)")).toBeInTheDocument();
    expect(screen.getByText("Прибыль за период")).toBeInTheDocument();
  });

  it("Funds-table с валютами и колонками Наши/≈USD/Клиентские", () => {
    renderTab();
    expect(screen.getByText("Доступные средства по валютам")).toBeInTheDocument();
    expect(screen.getByText("Наши")).toBeInTheDocument();
    expect(screen.getByText("Клиентские")).toBeInTheDocument();
    // USD строка должна быть в таблице (есть Mark Cash USD 11000)
    expect(screen.getAllByText("USD").length).toBeGreaterThanOrEqual(1);
  });

  it("TOP-7 счетов с именами счетов", () => {
    renderTab();
    expect(screen.getByText("TOP-7 счетов")).toBeInTheDocument();
    // Mark Cash USD должен быть в топе
    expect(screen.getByText("Cash · Mark Antalya · USD")).toBeInTheDocument();
  });

  it("Crypto/Fiat split с прогресс-барами", () => {
    renderTab();
    expect(screen.getByText("Crypto / Fiat")).toBeInTheDocument();
    // фикстура: Crypto = USDT 150+1000 = 1150; Fiat = USD 11000
    expect(screen.getByText("Крипто")).toBeInTheDocument();
    expect(screen.getByText("Фиат")).toBeInTheDocument();
  });

  it("Recent transactions показывает последние tx", () => {
    renderTab();
    expect(screen.getByText("Последние транзакции за период")).toBeInTheDocument();
  });

  it("Identity check внизу — Σ Дт = Σ Кт строка", () => {
    renderTab();
    expect(screen.getByText(/Σ Дт = Σ Кт/)).toBeInTheDocument();
  });

  it("Open obligations — empty state", () => {
    obligHook.mockReturnValue({ items: [], loading: false });
    renderTab();
    expect(screen.getByText("Нет открытых обязательств")).toBeInTheDocument();
  });

  it("Base picker рендерит USD/EUR/TRY/RUB", () => {
    renderTab();
    expect(screen.getByText("Приведение:")).toBeInTheDocument();
    expect(screen.getAllByText("USD").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("EUR").length).toBeGreaterThanOrEqual(1);
  });
});
