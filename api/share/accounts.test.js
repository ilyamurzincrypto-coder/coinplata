// api/share/accounts.test.js — публичный read-эндпоинт НЕ имеет write-пути.
// Любой не-GET → 405 (проверка до касания БД/env). Нет токена → 400.
// Это бэкенд-энфорсмент read-only из DoD: мутацию по ссылке сделать нечем.
import { describe, it, expect } from "vitest";
import handler from "./accounts.js";

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
  return res;
}

describe("share/accounts read-only endpoint", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("метод %s отклоняется 405", async (method) => {
    const res = mockRes();
    await handler({ method, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("GET без токена → 400", async () => {
    const res = mockRes();
    await handler({ method: "GET", query: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});
