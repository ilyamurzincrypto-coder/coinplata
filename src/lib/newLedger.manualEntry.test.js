import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("./supabase.js", () => ({
  supabase: { rpc: (...a) => rpcMock(...a) },
  isSupabaseConfigured: true,
}));
vi.mock("./dataVersion.jsx", () => ({ bumpDataVersion: vi.fn() }));

import { rpcCreateManualEntryV2 } from "./newLedger.js";

describe("rpcCreateManualEntryV2", () => {
  beforeEach(() => rpcMock.mockReset());

  it("maps the payload to p_* params, snake-cases lines, drops empty dims, returns tx_id", async () => {
    rpcMock.mockResolvedValue({ data: "tx-123", error: null });
    const txId = await rpcCreateManualEntryV2({
      lines: [
        { accountCode: "1110", direction: "dr", amount: 100 },
        { accountCode: "4010", direction: "cr", amount: 100, clientId: "", partnerId: null },
      ],
      currencyCode: "USD",
      reason: "manual fee",
      effectiveDate: "2026-05-10T00:00:00.000Z",
      description: " ",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(txId).toBe("tx-123");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, params] = rpcMock.mock.calls[0];
    expect(name).toBe("create_manual_entry");
    expect(params.p_idempotency_key).toBe("11111111-1111-4111-8111-111111111111");
    expect(typeof params.p_request_hash).toBe("string");
    expect(params.p_request_hash.length).toBe(64); // sha-256 hex
    expect(params.p_currency_code).toBe("USD");
    expect(params.p_reason).toBe("manual fee");
    expect(params.p_effective_date).toBe("2026-05-10T00:00:00.000Z");
    expect(params.p_lines).toEqual([
      { account_code: "1110", direction: "dr", amount: 100 },
      { account_code: "4010", direction: "cr", amount: 100 },
    ]);
  });

  it("generates an idempotency key when none is passed", async () => {
    rpcMock.mockResolvedValue({ data: "tx-9", error: null });
    await rpcCreateManualEntryV2({
      lines: [{ accountCode: "A", direction: "dr", amount: 1 }, { accountCode: "B", direction: "cr", amount: 1 }],
      currencyCode: "USD", reason: "x",
    });
    const [, params] = rpcMock.mock.calls[0];
    expect(params.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("surfaces RPC errors as thrown Error with the DB message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "entry does not balance: Dr 1 <> Cr 2", code: "22000" } });
    await expect(rpcCreateManualEntryV2({
      lines: [{ accountCode: "A", direction: "dr", amount: 1 }, { accountCode: "B", direction: "cr", amount: 2 }],
      currencyCode: "USD", reason: "x",
    })).rejects.toThrow(/does not balance/);
  });
});
