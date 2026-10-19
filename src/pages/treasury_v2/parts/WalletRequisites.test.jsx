// Кошелёк = счёт + реквизиты (канон CoinPay): адрес и сеть видны в карточке счёта.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const loadWalletAddresses = vi.fn();
vi.mock("../../../lib/ledgerReaders.js", () => ({ loadWalletAddresses: (...a) => loadWalletAddresses(...a) }));

import WalletRequisites, { shortAddress } from "./WalletRequisites.jsx";

const crypto = {
  id: "acc-1", code: "1316", name: "Hot · USDT TRC20 · Mark Antalya",
  type: "asset", subtype: "crypto_input", currency: "USDT",
  custodyType: "hot", provider: "SafePal",
};
const fiat = { id: "acc-2", code: "1110", name: "Касса TRY", type: "asset", subtype: "cash", currency: "TRY", custodyType: null, provider: null };

beforeEach(() => { loadWalletAddresses.mockReset(); loadWalletAddresses.mockResolvedValue([]); });

describe("WalletRequisites", () => {
  it("для фиатного счёта не рисует ничего и не ходит в базу", () => {
    const { container } = render(<WalletRequisites account={fiat} />);
    expect(container.firstChild).toBeNull();
    expect(loadWalletAddresses).not.toHaveBeenCalled();
  });

  it("показывает адрес, сеть и тип хранения криптосчёта", async () => {
    loadWalletAddresses.mockResolvedValue([
      { id: "w1", accountId: "acc-1", address: "TXyRrMNwYjmGBoK2ZhoH7L2eoyztdEpps9", label: "SafePal Mark TRC20", network: "TRC20", active: true },
    ]);
    render(<WalletRequisites account={crypto} />);
    await waitFor(() => expect(screen.getByText("TRC20")).toBeInTheDocument());
    expect(screen.getByText(/Горячий · SafePal/)).toBeInTheDocument();
    expect(screen.getByTitle("TXyRrMNwYjmGBoK2ZhoH7L2eoyztdEpps9")).toBeInTheDocument();
  });

  it("счёт без адреса говорит об этом прямо, а не выглядит сломанным", async () => {
    render(<WalletRequisites account={crypto} />);
    await waitFor(() => expect(screen.getByText(/Адрес не привязан/)).toBeInTheDocument());
  });

  it("сбой чтения реквизитов не роняет карточку", async () => {
    loadWalletAddresses.mockRejectedValue(new Error("boom"));
    render(<WalletRequisites account={crypto} />);
    await waitFor(() => expect(screen.getByText(/Адрес не привязан/)).toBeInTheDocument());
  });

  it("адрес сокращается для чтения, но не теряет концы", () => {
    const a = "TXyRrMNwYjmGBoK2ZhoH7L2eoyztdEpps9";
    const s = shortAddress(a);
    expect(s.startsWith("TXyRrMNwYj")).toBe(true);
    expect(s.endsWith("tdEpps9")).toBe(true);
    expect(shortAddress("TShort")).toBe("TShort");
  });
});
