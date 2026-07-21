// accountsRisk.test.js — бейдж риска, расхождение, флаги подключения.
import { describe, it, expect } from "vitest";
import {
  riskBadge,
  walletDiscrepancy,
  syncedLabel,
  canConnectMonitoring,
  isCryptoAccount,
  DISCREPANCY_THRESHOLD_USD,
} from "./accountsRisk.js";

describe("riskBadge", () => {
  it("не подключён → null", () => {
    expect(riskBadge({ aegisWalletId: null })).toBeNull();
  });
  it("ok/warning/critical тона", () => {
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "ok" }).tone).toBe("ok");
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "warning" }).tone).toBe("warning");
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "critical" }).tone).toBe("critical");
  });
  it("лейблы: warning=«внимание», critical=«пред-бан» (слово пред-бан только у critical)", () => {
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "warning" }).label).toBe("внимание");
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "critical" }).label).toBe("пред-бан");
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "ok" }).label).toBe("OK");
    // warning НЕ должен содержать «пред-бан»
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "warning" }).label).not.toContain("пред-бан");
  });
  it("hint у warning поясняет «не блокировка»", () => {
    expect(riskBadge({ aegisWalletId: "w", riskLevel: "warning" }).hint).toMatch(/не блокировк/i);
  });
  it("degraded → muted «нет данных (сеть)» независимо от риска", () => {
    const b = riskBadge({ aegisWalletId: "w", riskLevel: "ok", capability: "degraded" });
    expect(b.tone).toBe("muted");
    expect(b.dot).toBe(false);
  });
  it("подключён, но риск неизвестен → muted", () => {
    expect(riskBadge({ aegisWalletId: "w", riskLevel: null }).tone).toBe("muted");
  });
});

describe("walletDiscrepancy", () => {
  it("нет он-чейн → hasOnchain=false, не флагаем", () => {
    const r = walletDiscrepancy({ ledgerUsd: 1000, balanceUsdEst: null });
    expect(r.hasOnchain).toBe(false);
    expect(r.flagged).toBe(false);
  });
  it("совпадает в пределах порога → не флагаем", () => {
    const r = walletDiscrepancy({ ledgerUsd: 1000, balanceUsdEst: "1049.99" });
    expect(r.flagged).toBe(false);
    expect(r.diff).toBeCloseTo(-49.99);
  });
  it("расхождение ≥ $50 → флагаем", () => {
    const r = walletDiscrepancy({ ledgerUsd: 1000, balanceUsdEst: "900.00" });
    expect(r.flagged).toBe(true);
    expect(r.diff).toBeCloseTo(100);
  });
  it("нечисловой on-chain → не падаем", () => {
    const r = walletDiscrepancy({ ledgerUsd: 1000, balanceUsdEst: "n/a" });
    expect(r.hasOnchain).toBe(false);
  });
  it("порог по умолчанию = $50", () => {
    expect(DISCREPANCY_THRESHOLD_USD).toBe(50);
    expect(walletDiscrepancy({ ledgerUsd: 100, balanceUsdEst: "50" }).flagged).toBe(true);
  });
});

describe("syncedLabel", () => {
  it("пусто без даты", () => {
    expect(syncedLabel(null)).toBe("");
    expect(syncedLabel("garbage")).toBe("");
  });
  it("формат «данные на HH:MM»", () => {
    expect(syncedLabel("2026-07-19T09:05:00.000Z")).toMatch(/^данные на \d\d:\d\d$/);
  });
});

describe("флаги счёта", () => {
  it("isCryptoAccount по kind или адрес+сеть", () => {
    expect(isCryptoAccount({ kind: "crypto" })).toBe(true);
    expect(isCryptoAccount({ address: "T..", network: "TRC20" })).toBe(true);
    expect(isCryptoAccount({ kind: "fiat" })).toBe(false);
  });
  it("canConnectMonitoring: крипта с адресом+сетью, не подключена", () => {
    expect(canConnectMonitoring({ kind: "crypto", address: "T..", network: "TRC20" })).toBe(true);
    expect(canConnectMonitoring({ kind: "crypto", address: "T..", network: "TRC20", aegisWalletId: "w" })).toBe(false);
    expect(canConnectMonitoring({ kind: "crypto", network: "TRC20" })).toBe(false); // нет адреса
  });
});
