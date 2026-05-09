// src/lib/dealOperations.test.js
// Phase 3.1 — split-brain guards for legacy-only mutations.
//
// Когда USE_NEW_LEDGER=true, новый createDeal пишет в ledger.transactions,
// но Edit/Delete/Settle/etc. без guard'а молча идут в legacy public.deals.
// Эти тесты фиксируют контракт: guardLegacyOnly бросит fail-fast при v2.
//
// Запуск: npm run test -- src/lib/dealOperations.test.js
//
// CRITICAL: USE_NEW_LEDGER читается из import.meta.env при загрузке модуля
// newLedger.js. Чтобы stubEnv подействовал, нужно vi.resetModules() ДО
// re-import dealOperations.js (иначе закэшированный модуль вернёт старое
// значение USE_NEW_LEDGER).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("dealOperations split-brain guards", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("updateDeal throws when USE_NEW_LEDGER=true", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { updateDeal } = await import("./dealOperations.js");
    await expect(updateDeal({ id: "x" })).rejects.toThrow(/v2.*not.*supported|disable VITE_USE_NEW_LEDGER/i);
  });

  it("deleteDeal throws when USE_NEW_LEDGER=true", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { deleteDeal } = await import("./dealOperations.js");
    await expect(deleteDeal({ id: "x" })).rejects.toThrow(/v2.*not.*supported|disable VITE_USE_NEW_LEDGER/i);
  });

  it("completeDeal throws when USE_NEW_LEDGER=true", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { completeDeal } = await import("./dealOperations.js");
    await expect(completeDeal({ id: "x" })).rejects.toThrow();
  });

  it("settleObligation throws when USE_NEW_LEDGER=true", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { settleObligation } = await import("./dealOperations.js");
    await expect(settleObligation({})).rejects.toThrow();
  });

  it("recordPartnerInflow throws when USE_NEW_LEDGER=true", async () => {
    vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
    const { recordPartnerInflow } = await import("./dealOperations.js");
    await expect(recordPartnerInflow({})).rejects.toThrow();
  });
});
