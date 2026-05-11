import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const mockHook = vi.fn();
vi.mock("../../../store/openObligations.js", () => ({ useOpenObligations: () => mockHook() }));

import PaymentCalendarTab from "./PaymentCalendarTab.jsx";

const D = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };

describe("PaymentCalendarTab", () => {
  it("groups open obligations into due-date buckets with counts and per-currency leg totals", () => {
    mockHook.mockReturnValue({
      loading: false,
      items: [
        { id: "o1", due_date: D(-1), counterparty_name: "Иван Петров", status: "open", office_id: null, open_legs: [{ currency: "USDT", amount: 450 }] },
        { id: "o2", due_date: D(0), counterparty_name: "ООО Ромашка", status: "partial", office_id: null, open_legs: [{ currency: "USD", amount: 1000 }] },
        { id: "o3", due_date: D(3), counterparty_name: "Алексей Сидоров", status: "open", office_id: null, open_legs: [{ currency: "TRY", amount: 5000 }] },
      ],
    });
    render(<PaymentCalendarTab officeFilter="all" />);
    expect(screen.getByText("trv2_cal_overdue")).toBeInTheDocument();
    expect(screen.getByText("trv2_cal_today")).toBeInTheDocument();
    expect(screen.getByText("trv2_cal_week")).toBeInTheDocument();
    // "later" / "no_date" buckets have no rows → not rendered
    expect(screen.queryByText("trv2_cal_later")).toBeNull();
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText(/450 USDT/)).toBeInTheDocument();
    expect(screen.getByText(/1,000 USD|1 000 USD|1000 USD/)).toBeInTheDocument();
  });

  it("filters by office", () => {
    mockHook.mockReturnValue({
      loading: false,
      items: [
        { id: "o1", due_date: D(0), counterparty_name: "A", status: "open", office_id: "off-1", open_legs: [{ currency: "USD", amount: 10 }] },
        { id: "o2", due_date: D(0), counterparty_name: "B", status: "open", office_id: "off-2", open_legs: [{ currency: "USD", amount: 20 }] },
      ],
    });
    render(<PaymentCalendarTab officeFilter="off-1" />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText("B")).toBeNull();
  });

  it("shows the empty state when there are no open obligations", () => {
    mockHook.mockReturnValue({ loading: false, items: [] });
    render(<PaymentCalendarTab officeFilter="all" />);
    expect(screen.getByText("trv2_cal_empty")).toBeInTheDocument();
  });

  it("shows a loading placeholder while loading", () => {
    mockHook.mockReturnValue({ loading: true, items: [] });
    const { container } = render(<PaymentCalendarTab officeFilter="all" />);
    expect(container.textContent).toContain("…");
  });
});
