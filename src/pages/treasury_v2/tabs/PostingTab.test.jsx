import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k, lang: "ru" }) }));
const emitToastMock = vi.fn();
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: (...a) => emitToastMock(...a) }));
const rpcMock = vi.fn();
vi.mock("../../../lib/newLedger.js", () => ({ rpcCreateManualEntryV2: (...a) => rpcMock(...a) }));

import PostingTab from "./PostingTab.jsx";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a2", code: "4010", name: "Spread USD", subtype: "spread", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a3", code: "2110", name: "Customer Liab USD", subtype: "customer_liab", currency: "USD", clientDimRequired: true, partnerDimRequired: false, active: true },
  { id: "a4", code: "5126", name: "Exchange fee USD", subtype: "exchange_fee", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a5", code: "1112", name: "Cash TRY", subtype: "cash", currency: "TRY", clientDimRequired: false, partnerDimRequired: false, active: true },
];
const ctx = {
  accounts: ACCOUNTS,
  baseCurrency: "USD",
  toBase: (n) => Number(n), // fxOf(c) = toBase(1, c) = 1 for every currency in tests
  counterpartyOptions: (k) => (k === "partner" ? [{ id: "p1", name: "OTC Acme" }] : [{ id: "client-1", name: "Иван Петров" }]),
};

function pickAccount(lineIdx, codeText) {
  const accBtns = screen.getAllByRole("button").filter((b) => /trv2_pm_col_account|^\d{4}\s·\s/.test(b.textContent));
  fireEvent.click(accBtns[lineIdx]);
  fireEvent.click(screen.getByText(new RegExp(`^${codeText}\\s·\\s`)));
}
const decimalInputs = () => screen.getAllByRole("textbox").filter((el) => el.getAttribute("inputmode") === "decimal");

describe("PostingTab", () => {
  beforeEach(() => { rpcMock.mockReset(); emitToastMock.mockReset(); });

  it("renders the editor with two starter lines and a disabled Post button", () => {
    render(<PostingTab ctx={ctx} />);
    expect(screen.getByText("trv2_pm_title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trv2_pm_post" })).toBeDisabled();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(1); // header + per-line currency selects
    expect(screen.getAllByRole("button").filter((b) => /trv2_pm_col_account/.test(b.textContent)).length).toBe(2);
  });

  it("posts a balanced single-currency entry; payload has per-line currency + fxRates; resets the form", async () => {
    rpcMock.mockResolvedValue("tx-1");
    render(<PostingTab ctx={ctx} />);
    pickAccount(0, "1110");
    pickAccount(1, "4010");
    const ins = decimalInputs();
    fireEvent.change(ins[0], { target: { value: "100" } }); // line 1 Dr
    fireEvent.change(ins[3], { target: { value: "100" } }); // line 2 Cr ([l1Dr, l1Cr, l2Dr, l2Cr])
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "manual fee" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const payload = rpcMock.mock.calls[0][0];
    expect(payload.currencyCode).toBe("USD");
    expect(payload.reason).toBe("manual fee");
    expect(payload.fxRates).toEqual({ USD: 1 });
    expect(payload.lines).toEqual([
      { accountCode: "1110", direction: "dr", amount: 100, currencyCode: "USD" },
      { accountCode: "4010", direction: "cr", amount: 100, currencyCode: "USD" },
    ]);
    expect(emitToastMock).toHaveBeenCalledWith("success", "trv2_pm_posted");
    await waitFor(() => expect(screen.getByPlaceholderText("trv2_pm_reason_ph").value).toBe(""));
  });

  it("multi-currency entry: switching a line's currency feeds the right currencyCode + fxRates", async () => {
    rpcMock.mockResolvedValue("tx-2");
    render(<PostingTab ctx={ctx} />);
    // line 2 → currency TRY (3rd combobox: header, line1, line2)
    const combos = screen.getAllByRole("combobox");
    fireEvent.change(combos[combos.length - 1], { target: { value: "TRY" } });
    pickAccount(0, "1110"); // USD
    pickAccount(1, "1112"); // TRY
    const ins = decimalInputs();
    fireEvent.change(ins[0], { target: { value: "100" } });   // line 1 Dr (USD)
    fireEvent.change(ins[3], { target: { value: "100" } });   // line 2 Cr (TRY) — balances in base (fx=1 in tests)
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "fx reclass" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const payload = rpcMock.mock.calls[0][0];
    expect(payload.currencyCode).toBe("USD"); // reference = base
    expect(payload.fxRates).toEqual({ USD: 1, TRY: 1 });
    expect(payload.lines).toEqual([
      { accountCode: "1110", direction: "dr", amount: 100, currencyCode: "USD" },
      { accountCode: "1112", direction: "cr", amount: 100, currencyCode: "TRY" },
    ]);
  });

  it("picking a dimensioned account requires a counterparty; the chosen client goes into the payload line", async () => {
    rpcMock.mockResolvedValue("tx-1");
    render(<PostingTab ctx={ctx} />);
    pickAccount(0, "2110"); // line 1 → customer_liab
    pickAccount(1, "4010"); // line 2 → spread
    const ins = decimalInputs();
    fireEvent.change(ins[0], { target: { value: "100" } });
    fireEvent.change(ins[3], { target: { value: "100" } });
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "reclass" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    expect(post).toBeDisabled(); // line 1 needs a client
    fireEvent.click(screen.getByRole("button", { name: /trv2_pm_pick_counterparty/ }));
    fireEvent.click(screen.getByText("Иван Петров"));
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock.mock.calls[0][0].lines.find((l) => l.accountCode === "2110")).toMatchObject({ direction: "dr", amount: 100, clientId: "client-1" });
  });

  it("maps a 42501 RPC error to the forbidden toast", async () => {
    rpcMock.mockRejectedValue(new Error("Not authenticated"));
    render(<PostingTab ctx={ctx} />);
    pickAccount(0, "1110");
    pickAccount(1, "4010");
    const ins = decimalInputs();
    fireEvent.change(ins[0], { target: { value: "50" } });
    fireEvent.change(ins[3], { target: { value: "50" } });
    fireEvent.change(screen.getByPlaceholderText("trv2_pm_reason_ph"), { target: { value: "x" } });
    const post = screen.getByRole("button", { name: "trv2_pm_post" });
    await waitFor(() => expect(post).not.toBeDisabled());
    fireEvent.click(post);
    await waitFor(() => expect(emitToastMock).toHaveBeenCalledWith("error", "trv2_pm_err_forbidden"));
  });

  it("picking a template pre-fills the lines and the reason field", async () => {
    render(<PostingTab ctx={ctx} />);
    fireEvent.click(screen.getByRole("button", { name: /trv2_pm_template_pick/ }));
    fireEvent.click(screen.getByText(/Комиссия биржи/)); // id=exchange_fee
    const reasonInput = screen.getByPlaceholderText("trv2_pm_reason_ph");
    await waitFor(() => expect(reasonInput.value).toMatch(/Комиссия биржи/));
    expect(screen.getByRole("button", { name: /5126 · Exchange fee USD/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1110 · Cash USD/ })).toBeInTheDocument();
  });
});
