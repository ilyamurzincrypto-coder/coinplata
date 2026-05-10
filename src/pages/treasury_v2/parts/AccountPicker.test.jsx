import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import AccountPicker from "./AccountPicker.jsx";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a2", code: "4010", name: "Spread USD", subtype: "spread", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a4", code: "1340", name: "Treasury USDT", subtype: "crypto_input", currency: "USDT", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a5", code: "2110", name: "Customer Liab USD", subtype: "customer_liab", currency: "USD", clientDimRequired: true, partnerDimRequired: false, active: true },
];

describe("AccountPicker", () => {
  it("lists active, currency-matching accounts (including dimensioned ones); excludes wrong-currency", () => {
    render(<AccountPicker accounts={ACCOUNTS} currency="USD" value="" onChange={() => {}} />);
    expect(screen.getByRole("option", { name: /1110/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /4010/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /2110/ })).toBeInTheDocument(); // dimensioned account is now offered
    expect(screen.queryByRole("option", { name: /1340/ })).toBeNull(); // wrong currency
  });

  it("fires onChange with the picked account code", () => {
    const onChange = vi.fn();
    render(<AccountPicker accounts={ACCOUNTS} currency="USD" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "4010" } });
    expect(onChange).toHaveBeenCalledWith("4010");
  });

  it("shows the system-driven hint chip when a crypto/clearing-type account is selected", () => {
    const accts = [...ACCOUNTS, { id: "a6", code: "1316", name: "Hot USDT", subtype: "crypto_input", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true }];
    render(<AccountPicker accounts={accts} currency="USD" value="1316" onChange={() => {}} />);
    expect(screen.getByText("trv2_pm_system_account_hint")).toBeInTheDocument();
  });

  it("shows the empty-state when no accounts match", () => {
    render(<AccountPicker accounts={ACCOUNTS} currency="EUR" value="" onChange={() => {}} />);
    expect(screen.getByText("trv2_pm_no_accounts")).toBeInTheDocument();
  });
});
