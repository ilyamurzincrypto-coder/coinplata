// Плитки Экрана 3: когда доставка считается успешной.
//
// Повод для этих проверок боевой. Первая доставка легла на 12 строк из 42, а
// плитки нарисовали пять зелёных галочек. Починили — и получили обратную
// беду: штатная доставка 29 из 42 (13 строк не имеют места в модели сайта)
// горела жёлтым каждый раз. Жёлтый, который горит всегда, перестают замечать.
import { describe, it, expect } from "vitest";
import { channelState } from "./RatesVersionsScreen.jsx";

const sent = (extra) => ({ state: "sent", delivered_at: "2026-09-02T07:00:00Z", ...extra });

describe("channelState", () => {
  it("29 из 42, где 13 не имеют места в модели — успех, а не тревога", () => {
    const r = channelState(sent({ applied: 29, skipped_structural: 13, skipped_fixable: 0 }), 42);
    expect(r.tone).toBe("ok");
    expect(r.label).toContain("29");
  });

  it("потерянная строка поднимает тревогу и называет число", () => {
    const r = channelState(sent({ applied: 28, skipped_structural: 13, skipped_fixable: 1 }), 42);
    expect(r.tone).toBe("warn");
    expect(r.label).toContain("потеряно 1");
  });

  it("молчание о составе — не успех", () => {
    expect(channelState(sent({ applied: null }), 42).tone).toBe("warn");
  });

  it("старая доставка без разбивки судится по общему числу", () => {
    expect(channelState(sent({ applied: 12 }), 42).tone).toBe("warn");
    expect(channelState(sent({ applied: 42 }), 42).tone).toBe("ok");
  });

  it("несостоявшаяся и пропущенная доставка не выглядят доставленными", () => {
    expect(channelState({ state: "failed" }, 42).tone).toBe("bad");
    expect(channelState({ state: "skipped" }, 42).tone).toBe("muted");
    expect(channelState(undefined, 42).tone).toBe("muted");
  });
});
