// Модалка «Новый счёт» — поведение, которое задаёт эталон account-modal-r2.
//
// Проверяем ровно то, что легко сломать правкой вида: состав блока дубликатов
// (он предлагает чужую настройку «за основу» — ошибиться тут значит скопировать
// не те реквизиты) и то, что номер счёта форма не выдумывает.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/supabase.js", () => ({ supabase: null, isSupabaseConfigured: false }));
vi.mock("../../lib/supabaseWrite.js", () => ({ insertAccount: vi.fn(), withToast: vi.fn() }));

const ACCOUNTS = [
  { id: "a1", officeId: "of_1", currency: "USD", kind: "fiat", type: "cash", name: "Cash · Safe A", active: true, channelId: "ch_usd_cash" },
  { id: "a2", officeId: "of_2", currency: "USD", kind: "fiat", type: "cash", name: "Cash · Main", active: true, channelId: "ch_usd_cash" },
  { id: "a3", officeId: "of_1", currency: "USD", kind: "fiat", type: "bank", name: "Bank · Ziraat", active: true, channelId: "ch_usd_bank" },
];
const CHANNELS = [
  { id: "ch_usd_cash", currencyCode: "USD", kind: "cash", isDefaultForCurrency: true },
  { id: "ch_usd_bank", currencyCode: "USD", kind: "bank" },
];

// ССЫЛКИ ДОЛЖНЫ БЫТЬ СТАБИЛЬНЫМИ. Форма сбрасывает поля эффектом с
// зависимостью от списка валют; мок, возвращающий новый массив на каждый
// рендер, гонит эффект по кругу и вешает воркер.
const CURRENCIES = [{ code: "USD", type: "fiat" }];
const OFFICES = [{ id: "of_1", name: "Mark Antalya" }, { id: "of_2", name: "Terra City" }];
const ACC_CTX = { addAccount: () => {}, accounts: ACCOUNTS };
const RATES_CTX = { channels: CHANNELS };
const AUDIT_CTX = { addEntry: () => {} };

vi.mock("../../store/accounts.jsx", () => ({ useAccounts: () => ACC_CTX }));
vi.mock("../../store/currencies.jsx", () => ({ useCurrencies: () => ({ currencies: CURRENCIES }) }));
vi.mock("../../store/rates.jsx", () => ({ useRates: () => RATES_CTX }));
vi.mock("../../store/offices.jsx", () => ({ useOffices: () => ({ offices: OFFICES }) }));
vi.mock("../../store/audit.jsx", () => ({ useAudit: () => AUDIT_CTX }));
vi.mock("../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: () => "" }) }));

import AddAccountModal from "./AddAccountModal.jsx";

const open = () =>
  render(<AddAccountModal open officeId="of_1" officeName="Mark Antalya" onClose={() => {}} />);

describe("AddAccountModal", () => {
  it("дубликаты считаются по паре валюта+канал, а не по одной валюте", () => {
    open();
    // USD · Cash — два счёта; банковский USD в счёт не идёт: это другой канал,
    // и брать его «за основу» значило бы скопировать чужие реквизиты.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("блок дубликатов открывается свёрнутым", () => {
    open();
    expect(screen.queryByText("Cash · Main")).not.toBeInTheDocument();
  });

  it("раскрывается по клику и предлагает взять за основу", () => {
    open();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Cash · Main")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Взять за основу" }).length).toBe(2);
  });

  it("«Взять за основу» подставляет имя источника", () => {
    open();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("button", { name: "Взять за основу" })[0]);
    const named = screen.getByDisplayValue(/\(copy\)/);
    expect(named).toBeInTheDocument();
  });

  it("номер счёта не выдумывается на клиенте: прочерк, только чтение", () => {
    // Номер присваивает сервер (create_account_v2, диапазон 19xx). Показать
    // здесь вычисленное значение значило бы обещать номер, который достанется
    // другому счёту, если рядом создаёт второй кассир.
    open();
    const field = screen.getByLabelText(/присвоит сервер/i);
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveValue("—");
  });

  it("«Создать счёт» заблокирована, пока нет названия", () => {
    open();
    const submit = screen.getByRole("button", { name: /Создать счёт/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Cash · Safe A"), { target: { value: "Cash · New" } });
    expect(submit).not.toBeDisabled();
  });
});
