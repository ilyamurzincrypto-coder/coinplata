// LivePreview component tests (P1 T6 + P2 T7).

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../store/rates.jsx", () => ({
  useRates: () => ({ getRate: () => 1, rates: {} }),
}));
vi.mock("../../store/baseCurrency.js", () => ({
  useBaseCurrency: () => ({
    base: "USD",
    toBase: (amt, cur) => {
      if (cur === "USD" || cur === "USDT") return Number(amt);
      if (cur === "TRY") return Number(amt) / 30;
      return Number(amt);
    },
  }),
}));
vi.mock("../../i18n/translations.jsx", () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

import LivePreview from "./LivePreview.jsx";

function legIn(over) {
  return { id: "i1", side: "in", currency: "", amount: "", ...over };
}
function legOut(over) {
  return { id: "o1", side: "out", currency: "", amount: "", ...over };
}

describe("LivePreview", () => {
  it("T6: pro-rata margin USD/% calculated correctly", () => {
    const legs = [
      legIn({ currency: "USDT", amount: "1000" }),       // = $1000
      legOut({ currency: "TRY", amount: "29400" }),      // = $980 (29400/30)
    ];
    render(
      <LivePreview
        legs={legs}
        totalIn={{ USDT: 1000 }}
        totalOut={{ TRY: 29400 }}
        conditions={{}}
      />
    );
    const txt = document.body.textContent.replace(/\s+/g, " ");
    expect(txt).toMatch(/\+1,?000\s*USDT/);
    expect(txt).toMatch(/29,?400\s*TRY/);
    expect(txt.toLowerCase()).toMatch(/margin/);
    expect(txt).toMatch(/\$20/);
    expect(txt).toMatch(/2\.00%/);
  });

  it("T7: default state render — no warnings shown", () => {
    render(
      <LivePreview
        legs={[]}
        totalIn={{}}
        totalOut={{}}
        conditions={{ flags: [], fees: ["network_fee_exchange"] }}
      />
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText(/overdraft/i)).not.toBeInTheDocument();
    expect(screen.queryByText("conditions_chip_no_commission")).not.toBeInTheDocument();
  });

  it("T7b: overdraft warning shown", () => {
    render(
      <LivePreview
        legs={[
          legIn({ currency: "USD", amount: "100" }),
          legOut({ currency: "TRY", amount: "3000" }),
        ]}
        totalIn={{ USD: 100 }}
        totalOut={{ TRY: 3000 }}
        conditions={{}}
        hasOverdraft={true}
      />
    );
    expect(screen.getByText(/overdraft/i)).toBeInTheDocument();
  });

  it("T7c: no_commission warning shown + margin block hidden", () => {
    render(
      <LivePreview
        legs={[
          legIn({ currency: "USD", amount: "100" }),
          legOut({ currency: "TRY", amount: "3000" }),
        ]}
        totalIn={{ USD: 100 }}
        totalOut={{ TRY: 3000 }}
        conditions={{ fees: ["no_commission"] }}
      />
    );
    // i18n key shows up для warning chip
    expect(screen.getByText("conditions_chip_no_commission")).toBeInTheDocument();
    // "margin:" label не должен быть viewable (margin block hidden при no_commission)
    expect(screen.queryByText("margin:")).not.toBeInTheDocument();
  });
});
