// Карточка счёта = выписка: во всю ширину, одна сумма остатка, человеческие даты.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import Modal from "../../../components/ui/Modal.jsx";
import InlineBalanceEditor from "./InlineBalanceEditor.jsx";

vi.mock("../../../store/permissions.jsx", () => ({ useCan: () => () => true }));
vi.mock("../../../lib/treasury/setAccountBalance.js", () => ({ setAccountBalance: vi.fn() }));
vi.mock("../../../lib/toast.jsx", () => ({ emitToast: () => {} }));

describe("ширина карточки", () => {
  it("width=\"full\" раскрывает модалку во всю ширину экрана", () => {
    render(<Modal open onClose={() => {}} width="full"><div>выписка</div></Modal>);
    const panel = screen.getByText("выписка").closest("[class*='max-w-']");
    expect(panel.className).toContain("max-w-[min(1680px,96vw)]");
  });

  it("неизвестная ширина не ломает модалку", () => {
    render(<Modal open onClose={() => {}} width="нет-такой"><div>тело</div></Modal>);
    expect(screen.getByText("тело")).toBeInTheDocument();
  });
});

describe("остаток печатается один раз", () => {
  const account = { code: "1110", currency: "USD", type: "asset", subtype: "cash", balance: 0 };

  it("showValue=false оставляет на кнопке только «Править»", () => {
    render(<InlineBalanceEditor account={account} accounts={[]} suffix="USD" balanceOverride={0} showValue={false} />);
    expect(screen.getByText("Править")).toBeInTheDocument();
    // Сумма рядом с кнопкой не повторяется: её печатает карточка крупно.
    expect(screen.queryByText("0.00")).toBeNull();
  });

  it("по умолчанию сумма на кнопке остаётся — другие экраны на это опираются", () => {
    render(<InlineBalanceEditor account={account} accounts={[]} suffix="USD" balanceOverride={12.5} />);
    expect(screen.queryByText("Править")).toBeNull();
  });
});
