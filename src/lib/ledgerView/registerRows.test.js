import { describe, expect, it } from "vitest";
import { SECTION, buildRegisterRows, sectionTotals } from "./registerRows.js";

const ACCOUNTS = [
  { id: "a1", code: "220-001", name: "Касса Анталья", type: "cash", currency: "TRY", active: true },
  { id: "a2", code: "140-001", name: "Клиент Иванов", type: "liability", clientDimRequired: true, currency: "USD", active: true },
  { id: "a3", code: "370-001", name: "Доход платформы", type: "income", currency: "USD", active: true },
  { id: "a4", code: "999-001", name: "Загадка", type: "неведомое", currency: "USD", active: true },
  { id: "a5", code: "220-002", name: "Закрытая касса", type: "cash", currency: "USD", active: false },
];

describe("раскладка по разделам", () => {
  it("каждый счёт попадает в свой раздел", () => {
    expect(buildRegisterRows({ accounts: ACCOUNTS, balances: [], section: SECTION.NOSTRO }).map((r) => r.number)).toEqual(["220-001"]);
    expect(buildRegisterRows({ accounts: ACCOUNTS, balances: [], section: SECTION.LORO }).map((r) => r.number)).toEqual(["140-001"]);
    expect(buildRegisterRows({ accounts: ACCOUNTS, balances: [], section: SECTION.CAPITAL }).map((r) => r.number)).toEqual(["370-001"]);
  });

  it("🔴 нераспознанный счёт ВИДЕН в отдельном разделе, а не растворяется", () => {
    const rows = buildRegisterRows({ accounts: ACCOUNTS, balances: [], section: SECTION.UNSORTED });
    expect(rows.map((r) => r.number)).toEqual(["999-001"]);
    expect(rows[0].typeLabel).toContain("не распознан");
  });

  it("неактивные счета в реестр не попадают", () => {
    const all = [SECTION.NOSTRO, SECTION.LORO, SECTION.CAPITAL, SECTION.UNSORTED]
      .flatMap((s) => buildRegisterRows({ accounts: ACCOUNTS, balances: [], section: s }));
    expect(all.find((r) => r.number === "220-002")).toBeUndefined();
  });
});

describe("колонки одинаковы во всех разделах", () => {
  it("набор полей строки не зависит от раздела", () => {
    // 🔴 Правило владельца: Лоро/Ностро/Капитал выглядят ИДЕНТИЧНО, различаются только данные.
    const keys = (s) => Object.keys(buildRegisterRows({ accounts: ACCOUNTS, balances: [], section: s })[0]).sort();
    expect(keys(SECTION.NOSTRO)).toEqual(keys(SECTION.LORO));
    expect(keys(SECTION.LORO)).toEqual(keys(SECTION.CAPITAL));
  });

  it("у наших счетов контрагент — «Платформа», у клиентских — имя", () => {
    const nostro = buildRegisterRows({ accounts: ACCOUNTS, balances: [], section: SECTION.NOSTRO })[0];
    expect(nostro.counterparty).toBe("Платформа");

    const names = new Map([["c1", "Иванов И."]]);
    const loro = buildRegisterRows({
      accounts: ACCOUNTS,
      balances: [{ accountId: "a2", currency: "USD", clientId: "c1", balance: "100.00" }],
      names,
      section: SECTION.LORO,
    })[0];
    expect(loro.counterparty).toBe("Иванов И.");
  });
});

describe("знак остатка", () => {
  it("актив показывается положительным при нормальной стороне", () => {
    const rows = buildRegisterRows({
      accounts: ACCOUNTS,
      balances: [{ accountId: "a1", currency: "TRY", balance: "-5000.00" }],
      section: SECTION.NOSTRO,
    });
    expect(rows[0].presentedRaw).toBe("5000.00");
  });

  it("обязательство — как есть", () => {
    const rows = buildRegisterRows({
      accounts: ACCOUNTS,
      balances: [{ accountId: "a2", currency: "USD", balance: "-300.00" }],
      section: SECTION.LORO,
    });
    expect(rows[0].presentedRaw).toBe("-300.00");
  });
});

describe("итоги раздела", () => {
  it("🔴 по валютам отдельными строками, без единого «всего»", () => {
    const rows = [
      { currency: "USD", presentedRaw: "10.00" },
      { currency: "USD", presentedRaw: "5.50" },
      { currency: "TRY", presentedRaw: "100.00" },
    ];
    expect(sectionTotals(rows)).toEqual([
      { currency: "TRY", raw: "100.00" },
      { currency: "USD", raw: "15.50" },
    ]);
  });

  it("валюта без данных в итог не попадает нулём", () => {
    expect(sectionTotals([{ currency: "USD", presentedRaw: null }])).toEqual([]);
  });
});

describe("сортировка", () => {
  it("деньги сверху, нули ниже, без данных — в самый низ", () => {
    const accounts = [
      { id: "x1", code: "220-010", name: "Мало", type: "cash", currency: "USD", active: true },
      { id: "x2", code: "220-020", name: "Много", type: "cash", currency: "USD", active: true },
      { id: "x3", code: "220-030", name: "Пусто", type: "cash", currency: "USD", active: true },
    ];
    const rows = buildRegisterRows({
      accounts,
      balances: [
        { accountId: "x1", currency: "USD", balance: "-10.00" },
        { accountId: "x2", currency: "USD", balance: "-900.00" },
      ],
      section: SECTION.NOSTRO,
    });
    expect(rows.map((r) => r.name)).toEqual(["Много", "Мало", "Пусто"]);
  });
});
