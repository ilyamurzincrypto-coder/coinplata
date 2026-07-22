import { describe, it, expect } from "vitest";
import { plainReason, plainReasons, hopLabel } from "./riskReasons.js";

describe("plainReason — funder-trace парсинг", () => {
  const msg = "Типология: След к прачечной: 48% средств от узла TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe (1 хоп), который шлёт 20% исходящего на 110 BLACKLIST-адресов — INFERRED, проверить источник";
  it("вытаскивает хоп/долю/блэклист и убирает жаргон", () => {
    const r = plainReason({ code: "risk_factor", message: msg });
    expect(r.tone).toBe("warning");
    expect(r.hop).toBe(1);
    expect(r.plain).toContain("48%");
    expect(r.plain).toContain("110 замороженных");
    expect(r.plain).not.toMatch(/прачечн|типология|INFERRED/i);
    expect(r.glossary).toMatch(/Tether/); // определение «чёрного списка»
    expect(r.note).toMatch(/косвенный/);
  });
});

describe("plainReason — структурный funder_trace (AEGIS Tier 1)", () => {
  it("читает поля напрямую (без парсинга), с категорией mixer + inbound", () => {
    const r = plainReason({ code: "funder_trace", hop: 1, direction: "inbound", category: "mixer", share: 48, onward_blacklist_count: 110, onward_blacklist_pct: 20, confidence: "inferred" });
    expect(r.hop).toBe(1);
    expect(r.plain).toContain("48%");
    expect(r.plain).toContain("110 адресов-миксеров");
    expect(r.glossary).toMatch(/Миксер/);
    expect(r.title).toMatch(/пришл/i);
  });
  it("direction=outbound → «ушло»", () => {
    const r = plainReason({ code: "funder_trace", direction: "outbound", category: "blacklist", share: 30, onward_blacklist_count: 5, confidence: "confirmed" });
    expect(r.title).toMatch(/ушл/i);
    expect(r.plain).toMatch(/ушло/);
    expect(r.note).toMatch(/подтверждена/i);
  });
});

describe("plainReason — хард-коды", () => {
  it("blacklist → критично, без жаргона", () => {
    const r = plainReason({ code: "blacklist", message: "..." });
    expect(r.tone).toBe("critical");
    expect(r.title).toBe("Кошелёк заморожен");
    expect(r.plain).toMatch(/Tether/);
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
