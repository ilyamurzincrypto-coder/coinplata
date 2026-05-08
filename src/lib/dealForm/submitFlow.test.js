// submitFlow tests (P1 T1-T4).

import { describe, expect, it, vi } from "vitest";
import { runSubmitFlow } from "./submitFlow.js";

const t = (k) => k;

describe("runSubmitFlow", () => {
  it("T1: happy path → onSuccess called with result", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const result = await runSubmitFlow({
      buildPayload: () => ({ inLegs: [], outLegs: [] }),
      createDeal: vi.fn().mockResolvedValue({ deal_tx_id: "abc-123" }),
      t,
      onSuccess,
      onError,
    });
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ deal_tx_id: "abc-123" });
    expect(onSuccess).toHaveBeenCalledWith({ deal_tx_id: "abc-123" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("T2: insufficient balance (P0001) → toast.message=error_insufficient_balance", async () => {
    const onError = vi.fn();
    const error = {
      code: "P0001",
      message: "Insufficient balance on account 1316",
      details: "Available: 0, requested: 1000",
    };
    const result = await runSubmitFlow({
      buildPayload: () => ({}),
      createDeal: vi.fn().mockRejectedValue(error),
      t,
      onError,
    });
    expect(result.ok).toBe(false);
    expect(result.toast.message).toBe("error_insufficient_balance");
    expect(result.toast.code).toBe("P0001");
    expect(result.toast.details).toContain("Available: 0");
    expect(onError).toHaveBeenCalledWith(result.toast);
  });

  it("T3: idempotency conflict (P0422) → toast.retry=true", async () => {
    const error = { code: "P0422", message: "Idempotency key reused" };
    const result = await runSubmitFlow({
      buildPayload: () => ({}),
      createDeal: vi.fn().mockRejectedValue(error),
      t,
    });
    expect(result.ok).toBe(false);
    expect(result.toast.message).toBe("error_idempotency_conflict");
    expect(result.toast.retry).toBe(true);
  });

  it("T4: validation (22000) → toast.field extracted from message", async () => {
    const error = {
      code: "22000",
      message: "OUT leg leg_3: amount must be > 0",
    };
    const result = await runSubmitFlow({
      buildPayload: () => ({}),
      createDeal: vi.fn().mockRejectedValue(error),
      t,
    });
    expect(result.ok).toBe(false);
    expect(result.toast.message).toBe("error_validation");
    expect(result.toast.field).toEqual({ side: "out", legId: "leg_3" });
  });

  it("buildPayload throws → caught и mapped как 22000", async () => {
    const result = await runSubmitFlow({
      buildPayload: () => {
        throw new Error("at least one IN leg required");
      },
      createDeal: vi.fn(),
      t,
    });
    expect(result.ok).toBe(false);
    expect(result.toast.message).toBe("error_validation");
    expect(result.toast.code).toBe("22000");
  });

  it("retry для P0422 — same key replays и возвращает ok", async () => {
    // Реальный backend на retry с той же idem-key вернёт original result.
    // Здесь mock'ает behaviour: первый attempt fail с P0422, retry success.
    let attempt = 0;
    const createDeal = async () => {
      attempt += 1;
      if (attempt === 1) {
        const e = new Error("Idempotency key reused");
        e.code = "P0422";
        throw e;
      }
      return { deal_tx_id: "retried-123" };
    };

    const r1 = await runSubmitFlow({
      buildPayload: () => ({}),
      createDeal,
      t,
    });
    expect(r1.ok).toBe(false);
    expect(r1.toast.retry).toBe(true);

    // Manual retry (UI button)
    const r2 = await runSubmitFlow({
      buildPayload: () => ({}),
      createDeal,
      t,
    });
    expect(r2.ok).toBe(true);
    expect(r2.result.deal_tx_id).toBe("retried-123");
  });
});
