// Tests for formatAge pure helper.

import { describe, expect, it } from "vitest";
import { formatAge } from "./openObligations.js";

const t = (k) => k;

describe("formatAge", () => {
  it("just now (<1min)", () => {
    const now = new Date(Date.now() - 30_000).toISOString();
    expect(formatAge(now, t)).toBe("open_obligations_age_just_now");
  });
  it("minutes (5min ago)", () => {
    const five = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatAge(five, t)).toBe("open_obligations_age_minutes");
  });
  it("hours (3h ago)", () => {
    const three = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatAge(three, t)).toBe("open_obligations_age_hours");
  });
  it("days (2 days ago)", () => {
    const twoD = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    expect(formatAge(twoD, t)).toBe("open_obligations_age_days");
  });
  it("null/undefined → empty", () => {
    expect(formatAge(null, t)).toBe("");
    expect(formatAge(undefined, t)).toBe("");
  });
});
