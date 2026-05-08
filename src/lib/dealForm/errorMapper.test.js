// src/lib/dealForm/errorMapper.test.js

import { describe, expect, it } from "vitest";
import {
  mapErrorToToast,
  extractErrCode,
  extractFieldFromError,
} from "./errorMapper.js";

const t = (key) => key; // identity для тестов

describe("extractErrCode", () => {
  it("reads .code first", () => {
    expect(extractErrCode({ code: "P0001", message: "any" })).toBe("P0001");
  });
  it("falls back to message regex", () => {
    expect(extractErrCode({ message: "P0422 something happened" })).toBe("P0422");
    expect(extractErrCode({ message: "22000: invalid params" })).toBe("22000");
  });
  it("returns null for unknown", () => {
    expect(extractErrCode(null)).toBe(null);
    expect(extractErrCode({ message: "unknown error" })).toBe(null);
  });
});

describe("extractFieldFromError", () => {
  it("extracts leg side+id", () => {
    expect(extractFieldFromError({ message: "IN leg leg_5: amount must be > 0" }))
      .toEqual({ side: "in", legId: "leg_5" });
  });
  it("extracts account code", () => {
    expect(extractFieldFromError({ message: "Account 1316 not found" }))
      .toEqual({ accountCode: "1316" });
  });
  it("returns null for unknown shape", () => {
    expect(extractFieldFromError({ message: "Unknown error" })).toBe(null);
    expect(extractFieldFromError(null)).toBe(null);
  });
});

describe("mapErrorToToast", () => {
  it("P0001 insufficient balance", () => {
    const r = mapErrorToToast({ code: "P0001", message: "balance too low", details: "acc 1316" }, t);
    expect(r.severity).toBe("error");
    expect(r.message).toBe("error_insufficient_balance");
    expect(r.details).toBe("acc 1316");
    expect(r.code).toBe("P0001");
  });

  it("P0422 idempotency conflict + retry", () => {
    const r = mapErrorToToast({ code: "P0422", message: "key reused", hint: "use new key" }, t);
    expect(r.message).toBe("error_idempotency_conflict");
    expect(r.retry).toBe(true);
  });

  it("P0002 not found", () => {
    const r = mapErrorToToast({ code: "P0002", message: "Account 1316 not found" }, t);
    expect(r.message).toBe("error_not_found");
  });

  it("22000 validation + field extraction", () => {
    const r = mapErrorToToast({ code: "22000", message: "OUT leg leg_3: amount required" }, t);
    expect(r.message).toBe("error_validation");
    expect(r.field).toEqual({ side: "out", legId: "leg_3" });
  });

  it("23502 required field (dim_required)", () => {
    const r = mapErrorToToast({ code: "23502", message: "client_id required" }, t);
    expect(r.message).toBe("error_required_field");
  });

  it("42501 forbidden", () => {
    const r = mapErrorToToast({ code: "42501", message: "permission denied" }, t);
    expect(r.message).toBe("error_forbidden");
    expect(r.details).toBe("error_forbidden_hint");
  });

  it("unknown code → error_unknown", () => {
    const r = mapErrorToToast({ code: "XX000", message: "Internal error" }, t);
    expect(r.message).toBe("error_unknown");
    expect(r.code).toBe("XX000");
  });

  it("no code at all → error_unknown с null code", () => {
    const r = mapErrorToToast({ message: "Plain string error" }, t);
    expect(r.message).toBe("error_unknown");
    expect(r.code).toBe(null);
  });
});
