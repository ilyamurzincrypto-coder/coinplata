import { describe, it, expect } from "vitest";
import { parseNumber, resolveRateValue, CITY_OFFICE_MAP, parseMorningRates, buildMorningUpdates, pivotRate } from "./morningRatesParser.js";

describe("parseNumber", () => {
  it("запятая как десятичный разделитель", () => {
    expect(parseNumber("45,50")).toBe(45.5);
    expect(parseNumber("-0,80")).toBe(-0.8);
    expect(parseNumber("1.171")).toBe(1.171);
  });
  it("мусор → NaN", () => {
    expect(Number.isNaN(parseNumber("abc"))).toBe(true);
  });
});

describe("resolveRateValue", () => {
  it("процент → 1 + v/100", () => {
    expect(resolveRateValue({ value: -1, pct: true }, "crypto", "cash")).toBe(0.99);
    expect(resolveRateValue({ value: 0, pct: true }, "crypto", "cash")).toBe(1);
  });
  it("crypto→cash = абсолют", () => {
    expect(resolveRateValue({ value: 44.9, pct: false }, "crypto", "cash")).toBe(44.9);
  });
  it("cash→crypto = 1/v", () => {
    expect(resolveRateValue({ value: 45.7, pct: false }, "cash", "crypto")).toBeCloseTo(1 / 45.7, 10);
  });
  it("cash→crypto деление на ноль → null", () => {
    expect(resolveRateValue({ value: 0, pct: false }, "cash", "crypto")).toBe(null);
  });
});

describe("CITY_OFFICE_MAP", () => {
  it("ANT → оба офиса Антальи, MSK/SPB пусто", () => {
    expect(CITY_OFFICE_MAP.ANT).toEqual(["mark", "terra"]);
    expect(CITY_OFFICE_MAP.IST).toEqual(["ist"]);
    expect(CITY_OFFICE_MAP.MSK).toEqual([]);
    expect(CITY_OFFICE_MAP.SPB).toEqual([]);
  });
});

const SAMPLE = `[15.06.2026 10:44] Paramon: ANT
USDT -> USD  -0,80%
USD -> USDT  0,00%
USDT -> TRY  45,50
TRY -> USDT  46,5
USDT -> EUR  1,171
EUR -> USDT  1,152

IST
USDT -> USD  -0,60%
USDT -> TRY  45,50`;

describe("parseMorningRates — якоря", () => {
  it("разбирает города и курсы", () => {
    const { anchors } = parseMorningRates(SAMPLE);
    const ant = anchors.filter((a) => a.city === "ANT");
    const ist = anchors.filter((a) => a.city === "IST");
    expect(ant).toHaveLength(6);
    expect(ist).toHaveLength(2);
    expect(ant[0]).toMatchObject({ city: "ANT", from: "USDT", to: "USD", value: -0.8, pct: true });
    expect(ant[2]).toMatchObject({ city: "ANT", from: "USDT", to: "TRY", value: 45.5, pct: false });
  });
  it("inline-city: «ANT USDT -> USD ...»", () => {
    const { anchors } = parseMorningRates("ANT USDT -> TRY 45,5");
    expect(anchors[0]).toMatchObject({ city: "ANT", from: "USDT", to: "TRY", value: 45.5 });
  });
  it("повторный префикс Paramon: срезается", () => {
    const { anchors } = parseMorningRates("[20.05 10:40] Paramon: Paramon:\nANT  USDT -> TRY  44,9");
    expect(anchors[0]).toMatchObject({ city: "ANT", from: "USDT", to: "TRY", value: 44.9 });
  });
  it("строка без города → skipped no-city", () => {
    const { anchors, skipped } = parseMorningRates("USDT -> TRY 45,5");
    expect(anchors).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/no-city/);
  });
  it("мусор → skipped unparseable", () => {
    const { skipped } = parseMorningRates("ANT\nкакая-то ерунда");
    expect(skipped.some((s) => /unparseable/.test(s.reason))).toBe(true);
  });
});

const SPECIAL = `RUB QR СБП>> USDT  75,50
USDT - RUB (НЕРЕЗ)

Sell
TOD-TOD  73,28
TOD-TOM  73,23
TOM-TOM  73,33

Buy
TOD-TOD  71,87
TOD-TOM  71,79
TOM-TOM  71,92`;

describe("parseMorningRates — special", () => {
  it("СБП-строка", () => {
    const { special } = parseMorningRates(SPECIAL);
    const sbp = special.filter((s) => s.kind === "sbp");
    expect(sbp).toHaveLength(1);
    expect(sbp[0]).toMatchObject({ kind: "sbp", from: "RUB", to: "USDT", value: 75.5 });
  });
  it("блок НЕРЕЗ: 3 settle × 2 side = 6", () => {
    const { special } = parseMorningRates(SPECIAL);
    const nerez = special.filter((s) => s.kind === "nerez");
    expect(nerez).toHaveLength(6);
    expect(nerez).toContainEqual(
      expect.objectContaining({ kind: "nerez", side: "sell", settle: "TOD-TOD", value: 73.28 })
    );
    expect(nerez).toContainEqual(
      expect.objectContaining({ kind: "nerez", side: "buy", settle: "TOM-TOM", value: 71.92 })
    );
  });
  it("спец-строки не попадают в anchors/skipped как мусор", () => {
    const { anchors, skipped } = parseMorningRates(SPECIAL);
    expect(anchors).toHaveLength(0);
    expect(skipped.some((s) => /СБП|TOD|НЕРЕЗ/.test(s.line))).toBe(false);
  });
});

const KIND = (code) => (code === "USDT" ? "crypto" : "cash");

describe("buildMorningUpdates", () => {
  it("ANT-якорь → две записи (mark, terra), MSK → skipped", () => {
    const parsed = parseMorningRates(`ANT
USDT -> TRY  45,50
MSK
USDT -> RUB  75,75`);
    const { updates, skipped } = buildMorningUpdates(parsed, KIND);
    const tryUpd = updates.filter((u) => u.to === "TRY");
    expect(tryUpd.map((u) => u.officeId).sort()).toEqual(["mark", "terra"]);
    expect(tryUpd[0]).toMatchObject({ from: "USDT", to: "TRY", rate: 45.5 });
    expect(skipped.some((s) => /MSK/.test(s.reason))).toBe(true);
  });
  it("пишем только якоря с USDT-стороной", () => {
    const parsed = parseMorningRates(`ANT
USD -> EUR  1,1`);
    const { updates } = buildMorningUpdates(parsed, KIND);
    expect(updates).toHaveLength(0);
  });
  it("процент USDT->USD резолвится в rate", () => {
    const parsed = parseMorningRates(`ANT
USDT -> USD  -0,80%`);
    const { updates } = buildMorningUpdates(parsed, KIND);
    expect(updates[0].rate).toBeCloseTo(0.992, 6);
  });
});

describe("pivotRate", () => {
  const direct = { USD_USDT: 1, USDT_TRY: 45.5, USDT_USD: 0.992 };
  const lookup = (a, b) => direct[`${a}_${b}`];
  it("USD→TRY через USDT", () => {
    expect(pivotRate("USD", "TRY", lookup)).toBeCloseTo(45.5, 6);
  });
  it("одна сторона USDT → undefined (пивот не нужен)", () => {
    expect(pivotRate("USDT", "TRY", lookup)).toBeUndefined();
  });
  it("нет ноги → undefined", () => {
    expect(pivotRate("EUR", "TRY", lookup)).toBeUndefined();
  });
  it("from===to → 1", () => {
    expect(pivotRate("USD", "USD", lookup)).toBe(1);
  });
  it("нулевая нога → undefined (не 0)", () => {
    const lk = (a, b) => ({ USD_USDT: 0, USDT_TRY: 45.5 })[`${a}_${b}`];
    expect(pivotRate("USD", "TRY", lk)).toBeUndefined();
  });
});

const FULL = `[15.06.2026 10:44] Paramon: ANT
USDT -> USD  -0,80%
USD -> USDT  0,00%
USDT -> TRY  45,50
TRY -> USDT  46,5
USDT -> EUR  1,171
EUR -> USDT  1,152

IST
USDT -> USD  -0,60%
USD -> USDT  0,10%
USDT -> TRY  45,50
TRY -> USDT  45,6
USDT -> EUR  1,171
EUR -> USDT  1,152
[15.06.2026 10:44] Paramon: RUB QR СБП>> USDT  75,50
[15.06.2026 10:46] Paramon: MSK
USDT -> RUB  75,75
RUB -> USDT  76,92

SPB
USDT -> RUB  75,55
RUB -> USDT  77,12
[15.06.2026 11:38] Paramon: USDT - RUB (НЕРЕЗ)

Sell
TOD-TOD  73,28
TOD-TOM  73,23
TOM-TOM  73,33

Buy
TOD-TOD  71,87
TOD-TOM  71,79
TOM-TOM  71,92`;

describe("интеграция — полный документ", () => {
  const KIND = (code) => (code === "USDT" ? "crypto" : "cash");
  it("разбирает все 4 города + СБП + НЕРЕЗ без мусора", () => {
    const p = parseMorningRates(FULL);
    expect(p.anchors.filter((a) => a.city === "ANT")).toHaveLength(6);
    expect(p.anchors.filter((a) => a.city === "IST")).toHaveLength(6);
    expect(p.anchors.filter((a) => a.city === "MSK")).toHaveLength(2);
    expect(p.anchors.filter((a) => a.city === "SPB")).toHaveLength(2);
    expect(p.special.filter((s) => s.kind === "sbp")).toHaveLength(1);
    expect(p.special.filter((s) => s.kind === "nerez")).toHaveLength(6);
    expect(p.skipped).toHaveLength(0);
  });
  it("buildMorningUpdates: MSK/SPB → skipped, ANT×2 офиса", () => {
    const p = parseMorningRates(FULL);
    const { updates, skipped } = buildMorningUpdates(p, KIND);
    // только якоря с USDT-стороной; ANT=6 пар ×2 офиса + IST=6 ×1
    expect(updates.every((u) => u.from === "USDT" || u.to === "USDT")).toBe(true);
    expect(updates.some((u) => u.officeId === "mark")).toBe(true);
    expect(updates.some((u) => u.officeId === "terra")).toBe(true);
    expect(updates.some((u) => u.officeId === "ist")).toBe(true);
    expect(updates.some((u) => ["mark", "terra", "ist"].includes(u.officeId) === false)).toBe(false);
    expect(skipped.some((s) => /MSK/.test(s.reason))).toBe(true);
    expect(skipped.some((s) => /SPB/.test(s.reason))).toBe(true);
  });
});
