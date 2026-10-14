import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountsRegister } from "./AccountsRegister.jsx";
import { SECTION } from "../../lib/ledgerView/accountRoles.js";

const ROWS = [
  { id: "1", accountId: "a", number: "220-001", counterparty: "Платформа", name: "Касса Анталья", typeLabel: "Актив", currency: "TRY", presentedRaw: "5000.00" },
  { id: "2", accountId: "b", number: "220-002", counterparty: "Платформа", name: "Касса Стамбул", typeLabel: "Актив", currency: "TRY", presentedRaw: "1500.50" },
];

describe("реестр счетов", () => {
  it("колонки стоят в каноническом порядке", () => {
    render(<AccountsRegister section={SECTION.NOSTRO} rows={ROWS} />);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Номер", "Контрагент", "Наименование", "Тип", "Остаток", "Вал", "$", "€"]);
  });

  it("🔴 нет курса — прочерк, а не ноль", () => {
    // Ноль утверждал бы, что счёт ничего не стоит. Прочерк честно говорит «не знаем».
    const { container } = render(<AccountsRegister section={SECTION.NOSTRO} rows={ROWS} />);
    const text = container.textContent;
    expect(text).toContain("—");
    expect(text).not.toContain("0,00 $");
  });

  it("🔴 итог — по валютам, без единого «всего»", () => {
    const { container } = render(<AccountsRegister section={SECTION.NOSTRO} rows={ROWS} />);
    // 5000.00 + 1500.50 = 6500.50 — сложение точное, без float.
    expect(container.textContent.replace(/ /g, " ")).toContain("6 500,50");
    expect(container.textContent).not.toMatch(/Всего по всем валютам/i);
  });

  it("пустое состояние объясняет, а не молчит", () => {
    render(<AccountsRegister section={SECTION.LORO} rows={[]} />);
    expect(screen.getByText("Счетов нет.")).toBeTruthy();
  });

  it("раздел подписан своим именем", () => {
    render(<AccountsRegister section={SECTION.LORO} rows={ROWS} />);
    expect(screen.getByText("Лоро")).toBeTruthy();
  });
});
