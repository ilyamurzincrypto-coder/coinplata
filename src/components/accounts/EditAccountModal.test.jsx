import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("../../lib/supabase.js", () => ({ isSupabaseConfigured: true }));

const updateAccountMock = vi.fn(async () => {});
vi.mock("../../lib/supabaseWrite.js", () => ({
  updateAccount: (...a) => updateAccountMock(...a),
  withToast: vi.fn(async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: String(e) }; } }),
}));

import EditAccountModal from "./EditAccountModal.jsx";

const cashAccount = { id: "acc-1", name: "Касса USD", currency: "USD", type: "cash", active: true };
const cryptoAccount = { id: "acc-2", name: "Hot TRC20", currency: "USDT", type: "crypto", network: "TRC20", address: "TXXX", active: true };

describe("EditAccountModal", () => {
  beforeEach(() => { updateAccountMock.mockClear(); });

  it("pre-fills the name from the account", () => {
    render(<EditAccountModal open account={cashAccount} onClose={() => {}} />);
    const input = screen.getByDisplayValue("Касса USD");
    expect(input).toBeInTheDocument();
  });

  it("hides the network/address fields for a non-crypto account", () => {
    render(<EditAccountModal open account={cashAccount} onClose={() => {}} />);
    expect(screen.queryByText("acc_edit_network")).toBeNull();
    expect(screen.queryByText("acc_edit_address")).toBeNull();
  });

  it("shows the network field only for a crypto account", () => {
    render(<EditAccountModal open account={cryptoAccount} onClose={() => {}} />);
    expect(screen.getByText("acc_edit_network")).toBeInTheDocument();
    expect(screen.getByText("acc_edit_address")).toBeInTheDocument();
    expect(screen.getByDisplayValue("TXXX")).toBeInTheDocument();
  });

  it("submits a patch with the edited name on save", () => {
    const onClose = vi.fn();
    render(<EditAccountModal open account={cashAccount} onClose={onClose} />);
    fireEvent.change(screen.getByDisplayValue("Касса USD"), { target: { value: "Касса USD (main)" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(updateAccountMock).toHaveBeenCalledTimes(1);
    expect(updateAccountMock).toHaveBeenCalledWith(expect.objectContaining({ id: "acc-1", name: "Касса USD (main)", active: true }));
  });

  it("submits address + networkId for a crypto account", () => {
    render(<EditAccountModal open account={cryptoAccount} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(updateAccountMock).toHaveBeenCalledWith(expect.objectContaining({ id: "acc-2", address: "TXXX", networkId: "TRC20" }));
  });
});
