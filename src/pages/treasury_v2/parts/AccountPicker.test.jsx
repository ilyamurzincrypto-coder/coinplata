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

function openPicker() {
  // The picker shows a button with the placeholder text when nothing is selected.
  fireEvent.click(screen.getByRole("button", { name: /trv2_pm_col_account/ }));
}

describe("AccountPicker", () => {
  it("after opening, lists active currency-matching accounts (including dimensioned); excludes wrong-currency", () => {
    render(<AccountPicker accounts={ACCOUNTS} currency="USD" value="" onChange={() => {}} />);
    openPicker();
    expect(screen.getByText(/1110 · Cash USD/)).toBeInTheDocument();
    expect(screen.getByText(/4010 · Spread USD/)).toBeInTheDocument();
    expect(screen.getByText(/2110 · Customer Liab USD/)).toBeInTheDocument(); // dimensioned account is now offered
    expect(screen.queryByText(/1340/)).toBeNull(); // wrong currency
  });

  it("fires onChange with the picked account code", () => {
    const onChange = vi.fn();
    render(<AccountPicker accounts={ACCOUNTS} currency="USD" value="" onChange={onChange} />);
    openPicker();
    fireEvent.click(screen.getByText(/4010 · Spread USD/));
    expect(onChange).toHaveBeenCalledWith("4010");
  });

  it("filters by account code typed into the search", () => {
    render(<AccountPicker accounts={ACCOUNTS} currency="USD" value="" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText("Поиск…"), { target: { value: "2110" } });
    expect(screen.getByText(/2110 · Customer Liab USD/)).toBeInTheDocument();
    expect(screen.queryByText(/1110 · Cash USD/)).toBeNull();
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
