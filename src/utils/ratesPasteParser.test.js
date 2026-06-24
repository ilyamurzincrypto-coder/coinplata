import { describe, it, expect } from "vitest";
import { parseRatesPaste } from "./ratesPasteParser.js";

const KNOWN = new Set(["USDT", "USD", "TRY", "EUR", "RUB"]);
const cur = (from, to) => {
  const m = { "USDT>TRY": 45.0, "USD>USDT": 1.002 };
  return m[`${from}>${to}`];
};

describe("parseRatesPaste", () => {
  it("парсит стрелки, запятую, % и абсолют", () => {
    const txt = [
      "USDT -> USD  -1,00%",
      "USD -> USDT  0,20%",
      "USDT → TRY 45,10",
      "TRY > USDT 46",
      "мусор без стрелки",
    ].join("\n");
    const rows = parseRatesPaste(txt, { known: KNOWN, currentRate: cur });
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ from: "USDT", to: "USD", rate: 0.99, isPercent: true, status: "new" });
    expect(rows[1]).toMatchObject({ from: "USD", to: "USDT", rate: 1.002, status: "unchanged" });
    expect(rows[2]).toMatchObject({ from: "USDT", to: "TRY", rate: 45.1, isPercent: false, status: "updated" });
    expect(rows[3]).toMatchObject({ from: "TRY", to: "USDT", rate: 46, status: "new" });
    expect(rows[4]).toMatchObject({ status: "error" });
  });
  it("неизвестная валюта → error", () => {
    const rows = parseRatesPaste("USDT -> XXX 1", { known: KNOWN, currentRate: cur });
    expect(rows[0].status).toBe("error");
  });
});
