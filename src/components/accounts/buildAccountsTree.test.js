// buildAccountsTree.test.js — разрез «Все/Фиат/Крипто» + пересчёт итогов (DoD).
import { describe, it, expect } from "vitest";
import { buildAccountsTree } from "./buildAccountsTree.js";

// Фикстуры: два офиса. МСК — только фиат; СПБ — фиат + крипта; пустой офис Ереван.
const offices = [
  { id: "msk", name: "Москва" },
  { id: "spb", name: "Питер" },
  { id: "evn", name: "Ереван" }, // пуст в любом разрезе
];

const accounts = [
  { id: "a1", officeId: "msk", currency: "RUB", kind: "fiat", active: true },
  { id: "a2", officeId: "msk", currency: "USD", kind: "fiat", active: true },
  { id: "a3", officeId: "spb", currency: "USDT", kind: "crypto", active: true },
  { id: "a4", officeId: "spb", currency: "RUB", kind: "fiat", active: true },
  // неактивный — не должен попадать никогда
  { id: "a5", officeId: "spb", currency: "USDT", kind: "crypto", active: false },
];

const balances = { a1: 1000, a2: 50, a3: 200, a4: 300, a5: 999 };
const balanceOf = (id) => balances[id] || 0;
const reservedOf = () => 0;
// Курс: RUB→base 0.01, USD→base 1, USDT→base 1 (упрощённо для проверки сумм).
const rate = { RUB: 0.01, USD: 1, USDT: 1 };
const toBase = (amt, ccy) => amt * (rate[ccy] ?? 0);
const ccyOrder = (c) => ["USDT", "USD", "RUB"].indexOf(c);

const build = (kindFilter) =>
  buildAccountsTree({ accounts, offices, kindFilter, balanceOf, reservedOf, toBase, ccyOrder });

describe("buildAccountsTree", () => {
  it("all: все активные счета, крипта+фиат", () => {
    const { tree, grandBase } = build("all");
    expect(tree.map((o) => o.office.id)).toEqual(["msk", "spb", "evn"]);

    const msk = tree.find((o) => o.office.id === "msk");
    expect(msk.accsCount).toBe(2);
    expect(msk.baseTotal).toBeCloseTo(1000 * 0.01 + 50 * 1); // 60

    const spb = tree.find((o) => o.office.id === "spb");
    expect(spb.accsCount).toBe(2); // a5 неактивна — не считается
    expect(spb.baseTotal).toBeCloseTo(200 * 1 + 300 * 0.01); // 203

    // grand = сумма офисов
    expect(grandBase).toBeCloseTo(60 + 203 + 0);
    expect(grandBase).toBeCloseTo(tree.reduce((s, o) => s + o.baseTotal, 0));
  });

  it("fiat: только фиат, крипта исключена", () => {
    const { tree, grandBase } = build("fiat");
    const spb = tree.find((o) => o.office.id === "spb");
    expect(spb.accsCount).toBe(1); // только RUB
    expect(spb.ccys.map((c) => c.ccy)).toEqual(["RUB"]);
    expect(spb.baseTotal).toBeCloseTo(300 * 0.01); // 3
    expect(grandBase).toBeCloseTo(60 + 3 + 0);
  });

  it("crypto: только крипта, фиат исключён", () => {
    const { tree, grandBase } = build("crypto");
    const msk = tree.find((o) => o.office.id === "msk");
    expect(msk.accsCount).toBe(0); // у МСК крипты нет — офис остаётся, итог 0
    expect(msk.baseTotal).toBe(0);

    const spb = tree.find((o) => o.office.id === "spb");
    expect(spb.accsCount).toBe(1); // только активный USDT (a3), a5 неактивна
    expect(spb.baseTotal).toBeCloseTo(200);
    expect(grandBase).toBeCloseTo(200);
  });

  it("пустой офис виден в любом разрезе с итогом 0", () => {
    for (const f of ["all", "fiat", "crypto"]) {
      const { tree } = build(f);
      const evn = tree.find((o) => o.office.id === "evn");
      expect(evn).toBeTruthy();
      expect(evn.accsCount).toBe(0);
      expect(evn.baseTotal).toBe(0);
      expect(evn.ccys).toEqual([]);
    }
  });

  it("итог офиса = сумма его валют; grand = сумма офисов (инвариант)", () => {
    const { tree, grandBase } = build("all");
    for (const o of tree) {
      const sumCcy = o.ccys.reduce((s, c) => s + toBase(c.total, c.ccy), 0);
      expect(o.baseTotal).toBeCloseTo(sumCcy);
    }
    expect(grandBase).toBeCloseTo(tree.reduce((s, o) => s + o.baseTotal, 0));
  });
});
