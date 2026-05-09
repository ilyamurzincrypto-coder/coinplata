// src/lib/dealOperations.test.js
// Tasks 1.12–1.14 — v2 wrapper contract tests.
//
// 10 follow-up cashier mutations (updateDeal, deleteDeal, completeDeal,
// deleteTransfer, settleObligation, settleObligationPartial, receivePayment,
// cancelObligation, recordPartnerInflow, recordPartnerOutflow) теперь
// маршрутизируются на v2 RPC из newLedger.js когда USE_NEW_LEDGER=true.
//
// Каждый тест: stub V2 env on → vi.doMock("./newLedger.js") c подменой нужного
// RPC на spy AND USE_NEW_LEDGER:true → re-import dealOperations.js → проверить,
// что обёртка вызвала именно тот spy. vi.resetModules() в beforeEach обязателен,
// чтобы doMock применился к свежему графу.
//
// Запуск: npm run test -- src/lib/dealOperations.test.js

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

function stubV2On() {
  vi.stubEnv("VITE_USE_NEW_LEDGER", "true");
  vi.stubEnv("VITE_FORCE_V2", "true");
}

describe("dealOperations v2 wrappers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock("./newLedger.js");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("./newLedger.js");
  });

  it("updateDeal calls rpcUpdateDealV2 when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const updateDealSpy = vi.fn().mockResolvedValue({ tx_id: "ledger-tx-1" });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcUpdateDealV2: updateDealSpy };
    });
    const { updateDeal } = await import("./dealOperations.js");
    const result = await updateDeal({ id: "deal-1", patch: { note: "x" } });
    expect(updateDealSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({ tx_id: "ledger-tx-1" });
  });

  it("deleteDeal calls rpcReverseTransactionV2 when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const reverseSpy = vi.fn().mockResolvedValue({ reversal_tx_id: "rev-1" });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcReverseTransactionV2: reverseSpy };
    });
    const { deleteDeal } = await import("./dealOperations.js");
    await deleteDeal("deal-uuid", "manual");
    expect(reverseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetTxId: "deal-uuid",
        reason: expect.stringContaining("delete"),
        cascade: true,
      }),
    );
  });

  it("completeDeal calls rpcCompleteDealLegV2 when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const spy = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcCompleteDealLegV2: spy };
    });
    const { completeDeal } = await import("./dealOperations.js");
    await completeDeal("deal-1");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ dealTxId: "deal-1" }),
    );
  });

  it("deleteTransfer calls rpcReverseTransactionV2 when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const reverseSpy = vi.fn().mockResolvedValue({ reversal_tx_id: "rev-2" });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcReverseTransactionV2: reverseSpy };
    });
    const { deleteTransfer } = await import("./dealOperations.js");
    await deleteTransfer("transfer-uuid");
    expect(reverseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetTxId: "transfer-uuid",
        cascade: true,
      }),
    );
  });

  it("settleObligation calls rpcCompleteDealLegV2 when USE_NEW_LEDGER=true", async () => {
    stubV2On();
    const spy = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcCompleteDealLegV2: spy };
    });
    const { settleObligation } = await import("./dealOperations.js");
    await settleObligation("ob-1", "acc-1", 100);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        obligationId: "ob-1",
        paymentAccountId: "acc-1",
        amount: 100,
      }),
    );
  });

  it("settleObligationPartial calls rpcCompleteDealLegV2 with partial:true", async () => {
    stubV2On();
    const spy = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcCompleteDealLegV2: spy };
    });
    const { settleObligationPartial } = await import("./dealOperations.js");
    await settleObligationPartial("ob-2", "acc-2", 50);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        obligationId: "ob-2",
        paymentAccountId: "acc-2",
        amount: 50,
        partial: true,
      }),
    );
  });

  it("receivePayment calls rpcCreateAdjustmentV2 with kind:receive_payment", async () => {
    stubV2On();
    const spy = vi.fn().mockResolvedValue({ adj_tx_id: "adj-1" });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcCreateAdjustmentV2: spy };
    });
    const { receivePayment } = await import("./dealOperations.js");
    await receivePayment("ob-3", "acc-3", 75);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "receive_payment",
        obligationId: "ob-3",
        accountId: "acc-3",
        amount: 75,
      }),
    );
  });

  it("cancelObligation calls rpcReverseTransactionV2 with targetObligationId", async () => {
    stubV2On();
    const reverseSpy = vi.fn().mockResolvedValue({ reversal_tx_id: "rev-3" });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcReverseTransactionV2: reverseSpy };
    });
    const { cancelObligation } = await import("./dealOperations.js");
    await cancelObligation("ob-4");
    expect(reverseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetObligationId: "ob-4",
        reason: expect.stringContaining("cancel"),
      }),
    );
  });

  it("recordPartnerInflow calls rpcCreateAdjustmentV2 with kind:partner_inflow", async () => {
    stubV2On();
    const spy = vi.fn().mockResolvedValue({ adj_tx_id: "adj-2" });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcCreateAdjustmentV2: spy };
    });
    const { recordPartnerInflow } = await import("./dealOperations.js");
    await recordPartnerInflow({
      partnerAccountId: "p-1",
      amount: 200,
      currency: "USD",
      note: "test inflow",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "partner_inflow",
        partnerAccountId: "p-1",
        amount: 200,
        currency: "USD",
        note: "test inflow",
      }),
    );
  });

  it("recordPartnerOutflow calls rpcCreateAdjustmentV2 with kind:partner_outflow", async () => {
    stubV2On();
    const spy = vi.fn().mockResolvedValue({ adj_tx_id: "adj-3" });
    vi.doMock("./newLedger.js", async () => {
      const actual = await vi.importActual("./newLedger.js");
      return { ...actual, USE_NEW_LEDGER: true, rpcCreateAdjustmentV2: spy };
    });
    const { recordPartnerOutflow } = await import("./dealOperations.js");
    await recordPartnerOutflow({
      partnerAccountId: "p-2",
      amount: 300,
      currency: "EUR",
      fromAccountId: "acc-9",
      note: "test outflow",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "partner_outflow",
        partnerAccountId: "p-2",
        amount: 300,
        currency: "EUR",
        fromAccountId: "acc-9",
        note: "test outflow",
      }),
    );
  });
});
