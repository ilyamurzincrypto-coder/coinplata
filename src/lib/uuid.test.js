// Страж офисного фильтра. Смысл — НЕ отправить заведомо битый id в базу:
// PostgREST на `office_id=eq.mark` отвечает 400, а ошибка глоталась, и
// заявки с закрытиями кассы молча показывали пусто.

import { describe, it, expect } from "vitest";
import { isUuid, assertOfficeId } from "./uuid.js";

describe("isUuid", () => {
  it("настоящий id офиса", () => {
    expect(isUuid("cc51b231-6ea6-47f4-82cc-04028351f128")).toBe(true);
  });
  it("сидовые id и мусор — нет", () => {
    for (const v of ["mark", "ist", "", "office_1", null, undefined, 42, {}]) {
      expect(isUuid(v)).toBe(false);
    }
  });
});

describe("assertOfficeId", () => {
  it("пропускает отсутствие фильтра — «все офисы» законно", () => {
    expect(assertOfficeId(null, "x")).toBeNull();
    expect(assertOfficeId(undefined, "x")).toBeNull();
    expect(assertOfficeId("", "x")).toBeNull();
  });

  it("возвращает валидный id как есть", () => {
    const id = "12b68624-a75c-4909-a74a-fe108660c33e";
    expect(assertOfficeId(id, "x")).toBe(id);
  });

  it("на сидовом «mark» бросает, а не отправляет запрос", () => {
    expect(() => assertOfficeId("mark", "loadPendingOrders")).toThrow(/loadPendingOrders/);
    expect(() => assertOfficeId("mark", "loadPendingOrders")).toThrow(/mark/);
  });

  it("текст ошибки объясняет причину человеку, а не кодом 400", () => {
    expect(() => assertOfficeId("mark", "x")).toThrow(/не является UUID|устарел/);
  });
});
