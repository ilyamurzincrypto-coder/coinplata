import { describe, it, expect } from "vitest";
import { validateTx } from "./validateTx.js";

describe("validateTx", () => {
  it("returns ok=true for a complete 1-IN + 1-OUT payload", () => {
    const payload = {
      officeId: "office-1",
      legs: [
        { id: "in_1", side: "in", currency: "USD", amount: "1000", source: "fresh", accountId: "acc-1" },
        { id: "out_1", side: "out", currency: "USDT", amount: "990", destination: "physical", deferred: false, accountId: "acc-2", rate: "1.01" },
      ],
    };
    const r = validateTx(payload);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags missing accountId on fresh IN leg", () => {
    const payload = {
      officeId: "office-1",
      legs: [
        { id: "in_2_xyz", side: "in", currency: "USD", amount: "1000", source: "fresh" }, // no accountId
        { id: "out_1", side: "out", currency: "USDT", amount: "990", destination: "physical", deferred: false, accountId: "acc-2", rate: "1.01" },
      ],
    };
    const r = validateTx(payload);
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({
      legId: "in_2_xyz",
      side: "in",
      field: "accountId",
      code: "fresh_requires_accountId",
      message: "Выбери счёт зачисления",
    });
  });

  it("flags non-positive amount", () => {
    const payload = {
      officeId: "office-1",
      legs: [{ id: "in_1", side: "in", currency: "USD", amount: "0", source: "fresh", accountId: "acc-1" }],
    };
    const r = validateTx(payload);
    expect(r.errors.find((e) => e.code === "amount_must_be_positive")).toBeDefined();
  });

  it("flags missing currency", () => {
    const payload = {
      officeId: "office-1",
      legs: [{ id: "in_1", side: "in", amount: "100", source: "fresh", accountId: "acc-1" }],
    };
    expect(validateTx(payload).errors.find((e) => e.code === "currency_required")).toBeDefined();
  });

  it("flags missing officeId", () => {
    const payload = { legs: [] };
    expect(validateTx(payload).errors.find((e) => e.code === "office_required")).toBeDefined();
  });

  it("flags physical OUT leg without accountId (incl. deferred)", () => {
    const payload = {
      officeId: "office-1",
      legs: [
        { id: "in_1", side: "in", currency: "USD", amount: "100", source: "fresh", accountId: "acc-1" },
        { id: "out_1", side: "out", currency: "USDT", amount: "100", destination: "physical", deferred: true, rate: "1" },
      ],
    };
    expect(validateTx(payload).errors.find((e) => e.code === "physical_requires_accountId")).toBeDefined();
  });
});
