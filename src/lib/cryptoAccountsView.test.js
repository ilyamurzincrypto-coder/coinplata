// cryptoAccountsView.test.js — классификация, фильтры, порог Δ, сортировка, нулёвки.
import { describe, it, expect } from "vitest";
import {
  walletVM,
  classifyWallet,
  buildCryptoView,
  DELTA_ALERT_THRESHOLD_USD,
  SHARE_DRILLDOWN,
} from "./cryptoAccountsView.js";

const MARK = "mark";
const TERRA = "terra";
const offices = [
  { id: MARK, name: "Mark Antalya" },
  { id: TERRA, name: "Terra City" },
  { id: "empty", name: "Istanbul" }, // без крипты
];

const acc = (o) => ({
  id: o.id,
  name: o.name,
  address: o.address || `T${o.id}addr`,
  network: o.network || "TRC20",
  officeId: o.officeId,
  riskLevel: o.risk ?? "ok",
  aegisWalletId: "w_" + o.id,
  balanceUsdEst: o.onchain,
});

// набор кошельков
const items = [
  { account: acc({ id: "w88", name: "W88 Mark", officeId: MARK, risk: "warning", onchain: "0.62" }), ledgerUsd: 0 }, // problem: warning
  { account: acc({ id: "cerc", name: "Center ERC20", officeId: MARK, network: "ERC20", onchain: "572.01" }), ledgerUsd: 0 }, // problem: Δ>1
  { account: acc({ id: "ctrc", name: "Center TRC20", officeId: MARK, onchain: "0.00" }), ledgerUsd: 0 }, // zero
  { account: acc({ id: "lbep", name: "Lara BEP20", officeId: TERRA, network: "BEP20", onchain: "6806.94" }), ledgerUsd: 6806.94 }, // ok (Δ=0)
  { account: acc({ id: "lcrit", name: "Lara crit", officeId: TERRA, risk: "critical", onchain: "100.00" }), ledgerUsd: 100 }, // problem: critical
];

describe("classifyWallet", () => {
  it("warning/critical → problem", () => {
    expect(classifyWallet(walletVM(acc({ id: "x", risk: "warning", onchain: "0" }), 0))).toBe("problem");
    expect(classifyWallet(walletVM(acc({ id: "x", risk: "critical", onchain: "0" }), 0))).toBe("problem");
  });
  it("ok + расхождение > порога → problem", () => {
    expect(classifyWallet(walletVM(acc({ id: "x", onchain: "572" }), 0))).toBe("problem");
  });
  it("ok + он-чейн≈учёт (Δ ≤ порога) → ok", () => {
    expect(classifyWallet(walletVM(acc({ id: "x", onchain: "100.5" }), 100))).toBe("ok"); // Δ=0.5 ≤ 1
  });
  it("ok + он-чейн 0 и учёт 0 → zero", () => {
    expect(classifyWallet(walletVM(acc({ id: "x", onchain: "0.00" }), 0))).toBe("zero");
  });
});

describe("buildCryptoView — счётчики и фильтры", () => {
  it("counts: all / attention(problem) / ok(non-problem)", () => {
    const v = buildCryptoView({ items, offices });
    expect(v.counts.all).toBe(5);
    expect(v.counts.attention).toBe(3); // w88, cerc, lcrit
    expect(v.counts.ok).toBe(2); // ctrc(zero) + lbep(ok)
  });
  it("filter attention → только проблемные", () => {
    const v = buildCryptoView({ items, offices, filter: "attention" });
    const names = v.sections.flatMap((s) => [...s.wallets, ...s.zeroWallets].map((w) => w.name));
    expect(names.sort()).toEqual(["Center ERC20", "Lara crit", "W88 Mark"]);
  });
  it("filter ok → без проблемных (ok + нулёвки)", () => {
    const v = buildCryptoView({ items, offices, filter: "ok" });
    const cats = v.sections.flatMap((s) => [...s.wallets, ...s.zeroWallets].map((w) => w.category));
    expect(cats.every((c) => c !== "problem")).toBe(true);
  });
});

describe("buildCryptoView — итоги, сортировка, нулёвки, пустые офисы", () => {
  it("итоги он-чейн/учёт/Δ", () => {
    const v = buildCryptoView({ items, offices });
    expect(v.totals.onchain).toBeCloseTo(0.62 + 572.01 + 0 + 6806.94 + 100);
    expect(v.totals.ledger).toBeCloseTo(0 + 0 + 0 + 6806.94 + 100);
    expect(v.totals.delta).toBeCloseTo(v.totals.onchain - v.totals.ledger);
  });
  it("проблемные сверху внутри офиса", () => {
    const v = buildCryptoView({ items, offices });
    const mark = v.sections.find((s) => s.office.id === MARK);
    // wallets (без нулёвок): проблемные первыми
    expect(mark.wallets[0].category).toBe("problem");
    expect(mark.zeroWallets.map((w) => w.name)).toContain("Center TRC20");
  });
  it("нулёвки вынесены в zeroWallets, не в wallets", () => {
    const v = buildCryptoView({ items, offices });
    const mark = v.sections.find((s) => s.office.id === MARK);
    expect(mark.wallets.some((w) => w.name === "Center TRC20")).toBe(false);
    expect(v.zeroTotal).toBe(1);
  });
  it("офис без крипты → в emptyOffices, секцией не рендерится", () => {
    const v = buildCryptoView({ items, offices });
    expect(v.emptyOffices).toContain("Istanbul");
    expect(v.sections.some((s) => s.office.id === "empty")).toBe(false);
  });
});

describe("порог Δ конфигурируемый", () => {
  it("дефолт $1", () => {
    expect(DELTA_ALERT_THRESHOLD_USD).toBe(1);
  });
  it("Δ ровно на пороге — не проблема; выше — проблема", () => {
    expect(classifyWallet(walletVM(acc({ id: "x", onchain: "1" }), 0), 1)).not.toBe("problem"); // Δ=1, не > 1
    expect(classifyWallet(walletVM(acc({ id: "x", onchain: "1.01" }), 0), 1)).toBe("problem");
  });
  it("кастомный порог", () => {
    const v = buildCryptoView({ items, offices, threshold: 1000 });
    // Center ERC20 Δ=572 теперь НЕ проблема (порог 1000) → attention только warning+critical
    expect(v.counts.attention).toBe(2);
  });
});

describe("SHARE_DRILLDOWN", () => {
  it("по умолчанию выключен", () => {
    expect(SHARE_DRILLDOWN).toBe(false);
  });
});
