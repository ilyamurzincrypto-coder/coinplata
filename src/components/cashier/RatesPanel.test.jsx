// RatesPanel tests (P2 T9 + P2 T10).

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

let _ratesMock = {};
let _getRateMock = () => null;
vi.mock("../../store/rates.jsx", () => ({
  useRates: () => ({
    getRate: _getRateMock,
    rates: _ratesMock,
  }),
}));

import RatesPanel from "./RatesPanel.jsx";

describe("RatesPanel", () => {
  it("T9: empty rates → empty placeholder", () => {
    _ratesMock = {};
    _getRateMock = () => null;
    render(<RatesPanel onPickRate={vi.fn()} />);
    expect(screen.getByText("rates_empty")).toBeInTheDocument();
  });

  it("T10: click cell → onPickRate(from, to, rate)", () => {
    _ratesMock = { USDT_TRY: 30, TRY_USDT: 0.0333 };
    _getRateMock = (from, to) => {
      if (from === "USDT" && to === "TRY") return 30;
      if (from === "TRY" && to === "USDT") return 0.0333;
      return null;
    };
    const onPick = vi.fn();
    render(<RatesPanel onPickRate={onPick} />);

    // Find rate cell USDT→TRY (value=30)
    const cell = screen.getByText("30.0000");
    fireEvent.click(cell);
    expect(onPick).toHaveBeenCalledWith("USDT", "TRY", 30);
  });

  it("filter dropdown switching", () => {
    _ratesMock = { USDT_TRY: 30 };
    _getRateMock = () => 30;
    render(<RatesPanel onPickRate={vi.fn()} officeId="office-1" />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("local");
    fireEvent.change(select, { target: { value: "global" } });
    expect(select).toHaveValue("global");
  });

  it("active leg summary shown when provided", () => {
    _ratesMock = { USDT_TRY: 30 };
    _getRateMock = () => 30;
    render(
      <RatesPanel
        onPickRate={vi.fn()}
        activeLegSummary="USDT → TRY"
      />
    );
    expect(screen.getByText("USDT → TRY")).toBeInTheDocument();
  });
});
