// Хранилище сессии: поведение, когда браузер не даёт писать на диск.
// Цена ошибки — вечный спиннер на входе и молча пропавшая сессия (27.08).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { authStorage, isPersistentStorageAvailable, __resetStorageProbe } from "./authStorage.js";

const realLS = globalThis.localStorage;

function mockStorage({ throwOnSet = false, throwOnGet = false } = {}) {
  const box = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => { if (throwOnGet) throw new Error("blocked"); return box.has(k) ? box.get(k) : null; },
      setItem: (k, v) => { if (throwOnSet) throw new Error("blocked"); box.set(k, String(v)); },
      removeItem: (k) => { box.delete(k); },
    },
  });
  return box;
}

beforeEach(() => __resetStorageProbe());
afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: realLS });
  __resetStorageProbe();
});

describe("isPersistentStorageAvailable", () => {
  it("рабочее хранилище → true, проба за собой убирает", () => {
    const box = mockStorage();
    expect(isPersistentStorageAvailable()).toBe(true);
    expect(box.size).toBe(0); // ключ пробы удалён
  });

  it("Safari-случай: объект есть, setItem бросает → false", () => {
    mockStorage({ throwOnSet: true });
    expect(isPersistentStorageAvailable()).toBe(false);
  });

  it("результат кэшируется — проба не гоняется на каждый вызов", () => {
    const box = mockStorage();
    const spy = vi.spyOn(globalThis.localStorage, "setItem");
    isPersistentStorageAvailable();
    isPersistentStorageAvailable();
    isPersistentStorageAvailable();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("authStorage — фолбэк в память вкладки", () => {
  it("рабочее хранилище: пишет и читает с диска", () => {
    const box = mockStorage();
    authStorage.setItem("sb-x-auth-token", "SESSION");
    expect(box.get("sb-x-auth-token")).toBe("SESSION");
    expect(authStorage.getItem("sb-x-auth-token")).toBe("SESSION");
  });

  it("запись блокирована: сессия живёт в памяти, а не пропадает", () => {
    mockStorage({ throwOnSet: true });
    authStorage.setItem("sb-x-auth-token", "SESSION");
    expect(authStorage.getItem("sb-x-auth-token")).toBe("SESSION");
  });

  it("чтение бросает — тоже отдаём из памяти", () => {
    mockStorage({ throwOnGet: true, throwOnSet: false });
    authStorage.setItem("k", "V");
    expect(authStorage.getItem("k")).toBe("V");
  });

  it("живая сессия с диска ЧИТАЕТСЯ — деплой не разлогинивает", () => {
    const box = mockStorage();
    box.set("sb-x-auth-token", "OLD_SESSION"); // как будто осталась от прошлой версии
    expect(authStorage.getItem("sb-x-auth-token")).toBe("OLD_SESSION");
  });

  it("removeItem чистит и диск, и память", () => {
    const box = mockStorage();
    authStorage.setItem("k", "V");
    authStorage.removeItem("k");
    expect(box.has("k")).toBe(false);
    expect(authStorage.getItem("k")).toBe(null);
  });

  it("нет ключа → null, а не исключение", () => {
    mockStorage({ throwOnGet: true });
    expect(authStorage.getItem("missing")).toBe(null);
  });
});
