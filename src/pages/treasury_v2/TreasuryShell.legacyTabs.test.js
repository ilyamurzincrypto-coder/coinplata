// Старые id вкладок должны уводить в новый раздел, а не на «Обзор».
//
// Ссылка и привычка живут дольше вёрстки: тот, кто открывал «Пассивы»,
// должен попасть в пассивы. Тихая подмена на «Обзор» выглядит как «раздел
// работает», хотя человек смотрит не туда, куда шёл.
import { describe, it, expect } from "vitest";
import { LEGACY_TAB, TABS } from "./TreasuryShell.jsx";

describe("редиректы старых вкладок Казначейства", () => {
  it("каждый старый id ведёт в существующий раздел", () => {
    const ids = new Set(TABS.map((t) => t.id));
    for (const [from, to] of Object.entries(LEGACY_TAB)) {
      expect(ids.has(to.tab), `${from} → ${to.tab}`).toBe(true);
    }
  });

  it("четыре бывшие вкладки открывают свой подтаб «Счетов и выписок»", () => {
    expect(LEGACY_TAB.assets).toEqual({ tab: "statements", sub: "assets" });
    expect(LEGACY_TAB.liabilities).toEqual({ tab: "statements", sub: "liabilities" });
    expect(LEGACY_TAB.equity).toEqual({ tab: "statements", sub: "equity" });
    expect(LEGACY_TAB.opening).toEqual({ tab: "statements", sub: "opening" });
  });

  it("дашборд стал обзором, журнал остался журналом", () => {
    expect(LEGACY_TAB.dashboard.tab).toBe("overview");
    expect(LEGACY_TAB.journal.tab).toBe("journal");
  });

  it("разделов ровно четыре и в заданном порядке", () => {
    expect(TABS.map((t) => t.id)).toEqual(["overview", "statements", "journal", "exchange_income"]);
  });
});
