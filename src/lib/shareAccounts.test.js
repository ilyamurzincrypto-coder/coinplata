// shareAccounts.test.js — сборка дерева «Счета» из снапшота share-эндпоинта:
// разрез по типу + base-конверсия через тот же движок, что и приложение.
import { describe, it, expect } from "vitest";
import { buildShareTree, makeGetRateFromMap, isValidScope } from "./shareAccounts.js";

const snapshot = {
  scope: "all",
  baseCurrency: "USD",
  fxRates: {},
  offices: [
    { id: "msk", name: "Москва" },
    { id: "spb", name: "Питер" },
    { id: "evn", name: "Ереван" }, // пуст
  ],
  accounts: [
    { id: "a1", officeId: "msk", currency: "RUB", kind: "fiat", active: true },
    { id: "a2", officeId: "spb", currency: "USDT", kind: "crypto", active: true },
    { id: "a3", officeId: "spb", currency: "RUB", kind: "fiat", active: true },
  ],
  balances: {
    a1: { total: 1000, reserved: 0 },
    a2: { total: 200, reserved: 0 },
    a3: { total: 300, reserved: 0 },
  },
  // Плоская карта дефолтных пар (как отдаёт эндпоинт). USDT трактуется как USD 1:1.
  rates: { RUB_USD: 0.011, USD_RUB: 90.9, USDT_USD: 1 },
};

describe("buildShareTree", () => {
  it("scope all: офисы по порядку, итоги в base, пустой офис виден", () => {
    const { tree, grandBase, base, scope } = buildShareTree(snapshot);
    expect(base).toBe("USD");
    expect(scope).toBe("all");
    expect(tree.map((o) => o.office.id)).toEqual(["msk", "spb", "evn"]);

    const msk = tree.find((o) => o.office.id === "msk");
    expect(msk.baseTotal).toBeCloseTo(1000 * 0.011); // 11

    const spb = tree.find((o) => o.office.id === "spb");
    // USDT→USD 1:1 = 200; RUB 300*0.011 = 3.3
    expect(spb.baseTotal).toBeCloseTo(200 + 3.3);

    const evn = tree.find((o) => o.office.id === "evn");
    expect(evn.accsCount).toBe(0);
    expect(evn.baseTotal).toBe(0);

    expect(grandBase).toBeCloseTo(11 + 203.3);
    expect(grandBase).toBeCloseTo(tree.reduce((s, o) => s + o.baseTotal, 0));
  });

  it("scope crypto: только крипта; фиатный офис виден с 0", () => {
    const { tree, grandBase } = buildShareTree({ ...snapshot, scope: "crypto" });
    const msk = tree.find((o) => o.office.id === "msk");
    expect(msk.accsCount).toBe(0);
    expect(msk.baseTotal).toBe(0);
    const spb = tree.find((o) => o.office.id === "spb");
    expect(spb.ccys.map((c) => c.ccy)).toEqual(["USDT"]);
    expect(grandBase).toBeCloseTo(200);
  });

  it("невалидный scope → трактуется как all", () => {
    const { scope } = buildShareTree({ ...snapshot, scope: "garbage" });
    expect(scope).toBe("all");
  });
});

describe("makeGetRateFromMap", () => {
  it("прямой курс, тождество и USDT-пивот", () => {
    const gr = makeGetRateFromMap({ RUB_USDT: 0.011, USDT_TRY: 40 });
    expect(gr("USD", "USD")).toBe(1);
    expect(gr("RUB", "USDT")).toBeCloseTo(0.011);
    // пивот RUB→USDT→TRY = 0.011 * 40
    expect(gr("RUB", "TRY")).toBeCloseTo(0.011 * 40);
    expect(gr("XXX", "YYY")).toBeUndefined();
  });
});

describe("isValidScope", () => {
  it("all/fiat/crypto валидны, прочее — нет", () => {
    expect(isValidScope("all")).toBe(true);
    expect(isValidScope("fiat")).toBe(true);
    expect(isValidScope("crypto")).toBe(true);
    expect(isValidScope("x")).toBe(false);
  });
});
