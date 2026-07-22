import { describe, it, expect } from "vitest";
import { plainReason, plainReasons, hopLabel } from "./riskReasons.js";

describe("plainReason — funder-trace парсинг", () => {
  const msg = "Типология: След к прачечной: 48% средств от узла TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe (1 хоп), который шлёт 20% исходящего на 110 BLACKLIST-адресов — INFERRED, проверить источник";
  it("вытаскивает хоп/долю/блэклист и убирает жаргон", () => {
    const r = plainReason({ code: "risk_factor", message: msg });
    expect(r.tone).toBe("warning");
    expect(r.hop).toBe(1);
    expect(r.title).toBe("След к чёрному списку");
    expect(r.plain).toContain("48%");
    expect(r.plain).toContain("110 адресов из чёрного списка");
    expect(r.plain).not.toMatch(/прачечн|типология|INFERRED/i);
    expect(r.note).toMatch(/предположение/);
  });
});

describe("plainReason — хард-коды", () => {
  it("blacklist → критично, без жаргона", () => {
    const r = plainReason({ code: "blacklist", message: "..." });
    expect(r.tone).toBe("critical");
    expect(r.title).toBe("Чёрный список");
  });
  it("clean фильтруется из plainReasons", () => {
    const list = plainReasons([{ code: "clean", message: "Риск-флагов не найдено" }]);
    expect(list).toHaveLength(0);
  });
});

describe("hopLabel", () => {
  it("1 = прямой источник, 2 = через посредника", () => {
    expect(hopLabel(1)).toMatch(/прямой/);
    expect(hopLabel(2)).toMatch(/1 посредника/);
    expect(hopLabel(null)).toBeNull();
  });
});
