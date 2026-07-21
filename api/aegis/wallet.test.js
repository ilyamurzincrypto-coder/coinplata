// api/aegis/wallet.test.js — detail-эндпоинт: только GET, гейт requireStaff.
import { describe, it, expect } from "vitest";
import handler from "./wallet.js";

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

describe("aegis/wallet detail endpoint", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH"])("метод %s → 405", async (method) => {
    const res = mockRes();
    await handler({ method, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
  // Авторизация (share-токен/аноним → 401/403) гейтится requireStaff — проверяется
  // на живом эндпоинте (share-токен не staff-JWT).
});
