// waitForSession — страховка от возврата вечного спиннера.
// Сервер отвечает 200, но сессия может не материализоваться (браузер не дал
// сохранить). Тогда ждать бесконечно нельзя: надо сдаться и сказать правду.
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/supabase.js", () => ({ supabase: null, isSupabaseConfigured: true }));
vi.mock("../lib/authStorage.js", () => ({ isPersistentStorageAvailable: () => true }));

const { waitForSession } = await import("./LoginPage.jsx");

const clientWith = (sessionAfterCalls) => {
  let n = 0;
  return { auth: { getSession: async () => ({ data: { session: ++n >= sessionAfterCalls ? { access_token: "t" } : null } }) } };
};

describe("waitForSession", () => {
  it("сессия появилась сразу → true", async () => {
    expect(await waitForSession(2000, clientWith(1))).toBe(true);
  });

  it("появилась через несколько опросов → true", async () => {
    expect(await waitForSession(2000, clientWith(3))).toBe(true);
  });

  it("не появилась за таймаут → false, а не бесконечное ожидание", async () => {
    const never = { auth: { getSession: async () => ({ data: { session: null } }) } };
    const t0 = Date.now();
    expect(await waitForSession(500, never)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1500); // сдался, а не завис
  });

  it("getSession бросает → не падает, дожидается таймаута", async () => {
    const broken = { auth: { getSession: async () => { throw new Error("client not ready"); } } };
    expect(await waitForSession(400, broken)).toBe(false);
  });
});
