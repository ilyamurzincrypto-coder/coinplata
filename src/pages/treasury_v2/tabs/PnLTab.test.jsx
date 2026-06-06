import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/translations.jsx";

const exportCSVMock = vi.fn(() => true);
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVMock(...a) }));
// PnLTab uses useCan() to gate the "Close period" button — not exercised here.
vi.mock("../../../store/permissions.jsx", () => ({ useCan: () => () => false }));

import PnLTab from "./PnLTab.jsx";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

// i18n strings are language-dependent (I18nProvider default); match en/ru/tr to be robust.
const EXPORT_RE = /Export CSV|Экспорт CSV|CSV dışa aktar/;
const COMPARE_RE = /Compare with previous period|Сравнить с прошлым периодом|Önceki dönemle karşılaştır/;
const PREV_RE = /Previous|Прошл\.|Önceki/;

function renderTab() {
  return render(
    <I18nProvider>
      <PnLTab ctx={makeLedgerCtx()} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" />
    </I18nProvider>
  );
}

describe("PnLTab", () => {
  // PnLTab строит дефолтное окно ("month") от системных часов через presetWindow(),
  // а фикстура makeLedgerCtx() датирована маем 2026 (NOW = 2026-05-10). Без заморозки
  // часов данные оказываются вне окна (today-bound) и таблица показывает пустое
  // состояние. Фиксируем только Date, чтобы не трогать таймеры RTL/fireEvent.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders net profit row without throwing (smoke)", () => {
    const { container } = renderTab();
    expect(container.textContent).toMatch(/Net Profit|Чистая прибыль|Net kâr/i);
  });

  it("renders the Export CSV and Compare buttons", () => {
    renderTab();
    expect(screen.getByRole("button", { name: EXPORT_RE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COMPARE_RE })).toBeInTheDocument();
  });

  it("Export CSV calls exportCSV with flat per-account rows + a net_profit row (no prev columns)", () => {
    renderTab();
    exportCSVMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: EXPORT_RE }));
    expect(exportCSVMock).toHaveBeenCalledTimes(1);
    const arg = exportCSVMock.mock.calls[0][0];
    expect(Array.isArray(arg.rows)).toBe(true);
    expect(arg.rows.some((r) => r.section === "net_profit")).toBe(true);
    expect(arg.columns.some((c) => c.key === "amountPrev")).toBe(false);
  });

  it("toggling Compare adds the Previous columns and includes them in the CSV", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: COMPARE_RE }));
    expect(screen.getAllByText(PREV_RE).length).toBeGreaterThanOrEqual(1);
    exportCSVMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: EXPORT_RE }));
    const arg = exportCSVMock.mock.calls.at(-1)[0];
    expect(arg.columns.some((c) => c.key === "amountPrev")).toBe(true);
    expect(arg.columns.some((c) => c.key === "delta")).toBe(true);
  });
});
