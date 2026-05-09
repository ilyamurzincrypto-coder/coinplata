// src/lib/dealOperations.test.js
// Phase 3.1 — split-brain guards for legacy-only mutations.
//
// Когда USE_NEW_LEDGER=true, новый createDeal пишет в ledger.transactions,
// но Edit/Delete/Settle/etc. без guard'а молча идут в legacy public.deals.
// Эти тесты фиксируют контракт: guardLegacyOnly бросит fail-fast при v2.
//
// Запуск: npm run test -- src/lib/dealOperations.test.js
//
// NOTE (2026-05-09): kill-switch требует двух env: VITE_FORCE_V2=true И
// VITE_USE_NEW_LEDGER=true. Стаблим обе. vi.resetModules() ОБЯЗАТЕЛЕН
// до re-import, чтобы newLedger.js перечитал env, а не вернул кэш.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

function stubV2On() {
  vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
  vi.stubEnv("VITE_FORCE_V2", "true");
}

describe("dealOperations split-brain guards", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("updateDeal throws when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const { updateDeal } = await import("./dealOperations.js");
    await expect(updateDeal({ id: "x" })).rejects.toThrow(/v2.*not.*supported|disable VITE_USE_NEW_LEDGER/i);
  });

  it("deleteDeal throws when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const { deleteDeal } = await import("./dealOperations.js");
    await expect(deleteDeal({ id: "x" })).rejects.toThrow(/v2.*not.*supported|disable VITE_USE_NEW_LEDGER/i);
  });

  it("completeDeal throws when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const { completeDeal } = await import("./dealOperations.js");
    await expect(completeDeal({ id: "x" })).rejects.toThrow();
  });

  it("settleObligation throws when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const { settleObligation } = await import("./dealOperations.js");
    await expect(settleObligation({})).rejects.toThrow();
  });

  it("recordPartnerInflow throws when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const { recordPartnerInflow } = await import("./dealOperations.js");
    await expect(recordPartnerInflow({})).rejects.toThrow();
  });
});
