import { describe, it, expect } from "vitest";
import {
  buildAccountsOverview,
  initials,
  shortAddress,
  fmtSpace,
  gasWarning,
} from "./accountsOverview.js";

const OFFICES = [
  { id: "o1", name: "Mark Antalya", city: "Анталья" },
  { id: "o2", name: "Terra City", city: "Анталья" },
  { id: "o3", name: "Arbat", city: "Москва" },
];

const ACCOUNTS = [
  { id: "a1", officeId: "o1", currency: "USD", kind: "fiat", active: true, name: "Касса USD", ledgerAccountCode: "1101" },
  { id: "a2", officeId: "o1", currency: "TRY", kind: "fiat", active: true, name: "Касса TRY", ledgerAccountCode: "1103" },
  {
    id: "a3", officeId: "o1", currency: "USDT", kind: "crypto", active: true, name: "USDT TRC20",
    network: "TRC20", address: "TAzj2xxxxxxxxxxxxxxxxxxxTL3V", riskLevel: "warning", ledgerAccountCode: "1201",
  },
  { id: "a4", officeId: "o2", currency: "USD", kind: "fiat", active: true, name: "Касса USD", ledgerAccountCode: "2101" },
  { id: "a5", officeId: "o3", currency: "USD", kind: "fiat", active: true, name: "Касса USD", ledgerAccountCode: "3101" },
  { id: "aX", officeId: "o1", currency: "USD", kind: "fiat", active: false, name: "Закрытый", ledgerAccountCode: "1109" },
];

// o1: 100 USD + 1000 TRY(=50) + 200 USDT(=200) ; o2: 60 USD ; o3: 0
const BAL = { a1: 100, a2: 1000, a3: 200, a4: 60, a5: 0, aX: 999 };
const balanceOf = (id) => BAL[id] ?? 0;
const toBase = (v, cur) => (cur === "TRY" ? v * 0.05 : v);

const build = (over = {}) =>
  buildAccountsOverview({
    accounts: ACCOUNTS,
    offices: OFFICES,
    balanceOf,
    toBase,
    deltaOf: () => 0,
    ...over,
  });

describe("helpers", () => {
  it("initials — из двух слов, из одного, из пустого", () => {
    expect(initials("Mark Antalya")).toBe("MA");
    expect(initials("Lara")).toBe("LA");
    expect(initials("")).toBe("??");
  });

  it("shortAddress — 5 головы, 4 хвоста; короткий адрес не режется", () => {
    expect(shortAddress("TAzj2xxxxxxxxxxxxxxxxxxxTL3V")).toBe("TAzj2…TL3V");
    expect(shortAddress("TAzj2")).toBe("TAzj2");
    expect(shortAddress(null)).toBe("");
  });

  it("fmtSpace — разряды шпацией, запятая в дробной", () => {
    expect(fmtSpace(964000, 2)).toBe("964\u00A0000,00");
    expect(fmtSpace(42300)).toBe("42\u00A0300");
  });

  it("gasWarning — только при наличии поля и значении ниже порога", () => {
    expect(gasWarning({})).toBeNull();
    expect(gasWarning({ gasBalanceUsd: 5 })).toBeNull();
    expect(gasWarning({ gasBalanceUsd: 0.62 })).toBe(0.62);
    // channel.gasFee сюда не попадает — только собственное поле счёта
    expect(gasWarning({ gasFee: 0.1 })).toBeNull();
  });
});

describe("buildAccountsOverview", () => {
  it("считает итоги офиса и компании, неактивные счета не учитывает", () => {
    const m = build();
    const o1 = m.offices.find((b) => b.office.id === "o1");
    expect(o1.cash).toBe(150); // 100 USD + 1000 TRY * 0.05
    expect(o1.crypto).toBe(200);
    expect(o1.total).toBe(350);
    expect(m.totals.total).toBe(410); // 350 + 60 + 0
    // aX (active:false) не попал ни в суммы, ни в счётчик
    expect(o1.subCount).toBe(3);
  });

  it("срез Фиат/Крипто пересчитывает суммы И счётчики, а не прячет строки", () => {
    const fiat = build({ mode: "fiat" });
    expect(fiat.totals.total).toBe(210); // 150 + 60
    const o1f = fiat.offices.find((b) => b.office.id === "o1");
    expect(o1f.total).toBe(150);
    expect(o1f.subCount).toBe(2);
    expect(o1f.cryptoRows).toHaveLength(0);

    const crypto = build({ mode: "crypto" });
    expect(crypto.totals.total).toBe(200);
    const o1c = crypto.offices.find((b) => b.office.id === "o1");
    expect(o1c.total).toBe(200);
    expect(o1c.fiatRows).toHaveLength(0);
    // офис без крипты уходит в нули
    expect(crypto.offices.find((b) => b.office.id === "o2").isZero).toBe(true);
  });

  it("сортировка по итогу: нулевые всегда внизу", () => {
    const m = build();
    expect(m.offices.map((b) => b.office.id)).toEqual(["o1", "o2", "o3"]);
    expect(m.offices[2].isZero).toBe(true);
  });

  it("сортировка по названию — алфавит, без выталкивания нулевых", () => {
    const m = build({ sort: "name" });
    expect(m.offices.map((b) => b.office.name)).toEqual(["Arbat", "Mark Antalya", "Terra City"]);
  });

  it("поиск ловит офис, город, валюту субсчёта и адрес кошелька", () => {
    expect(build({ query: "terra" }).offices).toHaveLength(1);
    expect(build({ query: "москва" }).offices).toHaveLength(1);
    expect(build({ query: "try" }).offices.map((b) => b.office.id)).toEqual(["o1"]);
    expect(build({ query: "TAzj2xxxx" }).offices.map((b) => b.office.id)).toEqual(["o1"]);
    expect(build({ query: "нет-такого" }).offices).toHaveLength(0);
  });

  it("итоги компании считаются по найденному, а не по всем офисам", () => {
    const m = build({ query: "terra" });
    expect(m.totals.total).toBe(60);
    expect(m.officeCount).toBe(1);
  });

  it("бейдж проблемных кошельков — только в срезах с криптой", () => {
    const o1 = build().offices.find((b) => b.office.id === "o1");
    expect(o1.warnCount).toBe(1); // riskLevel: warning
    const o1f = build({ mode: "fiat" }).offices.find((b) => b.office.id === "o1");
    expect(o1f.warnCount).toBe(0);
  });

  it("номер счёта берётся с сервера и не достраивается; без кода — null", () => {
    const m = buildAccountsOverview({
      accounts: [{ id: "n1", officeId: "o1", currency: "USD", kind: "fiat", active: true, ledgerAccountCode: null }],
      offices: [OFFICES[0]],
      balanceOf: () => 10,
      toBase: (v) => v,
    });
    expect(m.offices[0].fiatRows[0].ledgerCode).toBeNull();
  });
});
