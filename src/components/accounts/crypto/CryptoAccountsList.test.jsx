// CryptoAccountsList.test.jsx — раскрытие/закрытие плашки причины (П7).
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CryptoAccountsList from "./CryptoAccountsList.jsx";

const account = {
  id: "w1",
  name: "W Test",
  address: "TXyzAbcdEfGh1234567890",
  network: "TRC20",
  officeId: "o1",
  riskLevel: "warning",
  aegisWalletId: "aw1",
  aegisCapability: "live",
  balanceUsdEst: "100.00", // учёт 0 → Δ=100 (расхождение) + риск warning = проблемный
};
const items = [{ account, ledgerUsd: 0 }];
const offices = [{ id: "o1", name: "Office" }];

describe("CryptoAccountsList — плашка причины по тапу на статус", () => {
  it("скрыта по умолчанию → раскрывается по тапу → скрывается повторным тапом", () => {
    render(<CryptoAccountsList items={items} offices={offices} mode="authed" onOpenWallet={() => {}} />);

    const rx = /Учёт расходится с он-чейном/;
    // по умолчанию скрыта
    expect(screen.queryAllByText(rx)).toHaveLength(0);

    // тап на статус («Показать причину»); mobile+desktop оба в DOM — берём первый
    const statusBtn = screen.getAllByTitle("Показать причину")[0];
    fireEvent.click(statusBtn);
    expect(screen.getAllByText(rx).length).toBeGreaterThan(0);

    // повторный тап — скрывает
    fireEvent.click(statusBtn);
    expect(screen.queryAllByText(rx)).toHaveLength(0);
  });

  it("статус проблемного = «внимание» (warning → правка, не «warning»)", () => {
    render(<CryptoAccountsList items={items} offices={offices} mode="authed" onOpenWallet={() => {}} />);
    expect(screen.getAllByText("внимание").length).toBeGreaterThan(0);
  });
});
