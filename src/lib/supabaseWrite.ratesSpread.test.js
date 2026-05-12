// src/lib/supabaseWrite.ratesSpread.test.js
// Минимальный тест для rpcSetAllPairSpreads и p_sync_reverse в rpcUpdatePair.
// Мокаем supabase / dataVersion / toast — не сетевые, чисто проверяем что
// в RPC улетают правильные параметры и возвращается count.

import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("./supabase.js", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...args) => rpcMock(...args) },
}));
vi.mock("./dataVersion.jsx", () => ({ bumpDataVersion: vi.fn() }));
vi.mock("./toast.jsx", () => ({ emitToast: vi.fn() }));

import { rpcSetAllPairSpreads, rpcUpdatePair } from "./supabaseWrite.js";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("rpcSetAllPairSpreads", () => {
  it("calls set_all_pair_spreads and returns the count", async () => {
    rpcMock.mockResolvedValue({ data: 7, error: null });
    const count = await rpcSetAllPairSpreads(0.5);
    expect(rpcMock).toHaveBeenCalledWith("set_all_pair_spreads", { p_spread: 0.5 });
    expect(count).toBe(7);
  });

  it("rejects non-numeric spread", async () => {
    await expect(rpcSetAllPairSpreads("abc")).rejects.toThrow(/number/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(rpcSetAllPairSpreads(1)).rejects.toThrow(/boom/);
  });
});

describe("rpcUpdatePair — p_sync_reverse", () => {
  it("defaults p_sync_reverse to true on a base-rate edit", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await rpcUpdatePair({ fromCurrency: "USDT", toCurrency: "TRY", baseRate: 39 });
    expect(rpcMock).toHaveBeenCalledWith("update_pair", {
      p_from: "USDT",
      p_to: "TRY",
      p_base_rate: 39,
      p_spread: null,
      p_sync_reverse: true,
    });
  });

  it("passes p_sync_reverse=false when syncReverse:false", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await rpcUpdatePair({ fromCurrency: "USDT", toCurrency: "TRY", baseRate: 39, syncReverse: false });
    expect(rpcMock.mock.calls[0][1].p_sync_reverse).toBe(false);
  });
});
