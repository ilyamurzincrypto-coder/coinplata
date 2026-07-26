// Слайс 1.5.g — липкость форм системно через общий ui/Modal + прогон инвентаря модалок.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import Modal from "./Modal.jsx";

describe("Modal — липкость (1.5.g)", () => {
  it("клик по фону НЕ закрывает форму, данные целы", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Форма">
        <input defaultValue="черновик" />
      </Modal>
    );
    const overlay = screen.getByTestId("modal-overlay");
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("черновик")).toBeInTheDocument(); // данные на месте
  });

  it("Esc закрывает (форма не dirty)", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Форма" />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("крестик закрывает", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Форма" />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dirty: Esc спрашивает подтверждение; отмена → форма остаётся", () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Modal open onClose={onClose} title="Форма" dirty />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("dirty: подтверждение принято → закрывает", () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Modal open onClose={onClose} title="Форма" dirty />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});

describe("Инвентарь модалок — все сидят на общем ui/Modal (получают липкость)", () => {
  const MODALS = [
    "src/components/currencies/CurrencyWizard.jsx",
    "src/pages/treasury_v2/parts/CashboxWizard.jsx",
    "src/pages/treasury_v2/parts/ChartAccountModal.jsx",
    "src/components/clients/AddClientModal.jsx",
    "src/components/clients/ClientProfileModal.jsx",
  ];
  it.each(MODALS)("%s импортирует общий Modal, а не свой", (f) => {
    const src = readFileSync(resolve(f), "utf8");
    expect(src).toMatch(/import\s+Modal\s+from\s+["'][^"']*ui\/Modal(\.jsx)?["']/);
  });
});
