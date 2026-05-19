// SpreadIndicator tests (P3 T12 — spread color logic edge cases).

import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import SpreadIndicator from "./SpreadIndicator.jsx";

describe("SpreadIndicator color logic", () => {
  it("returns null when current/market missing", () => {
    const { container: c1 } = render(
      <SpreadIndicator currentRate={null} marketRate={30} />
    );
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(
      <SpreadIndicator currentRate={30} marketRate={null} />
    );
    expect(c2.firstChild).toBeNull();
    const { container: c3 } = render(
      <SpreadIndicator currentRate={0} marketRate={30} />
    );
    expect(c3.firstChild).toBeNull();
  });

  it("equal rates → mid label", () => {
    render(<SpreadIndicator currentRate={30} marketRate={30} />);
    expect(screen.getByText(/mid/)).toBeInTheDocument();
  });

  it("above mid +0.5% → emerald (profitable)", () => {
    const { container } = render(
      <SpreadIndicator currentRate={30.15} marketRate={30} />
    );
    const span = container.querySelector("span");
    expect(span.className).toContain("text-success");
    expect(span.textContent).toMatch(/\+0\.5%/);
  });

  it("below mid -1.5% → amber (less profitable)", () => {
    const { container } = render(
      <SpreadIndicator currentRate={29.55} marketRate={30} />
    );
    const span = container.querySelector("span");
    expect(span.className).toContain("text-warning");
    expect(span.textContent).toMatch(/-1\.5%/);
  });

  it("above mid +6% → rose (>5% threshold, warning)", () => {
    const { container } = render(
      <SpreadIndicator currentRate={31.8} marketRate={30} />
    );
    const span = container.querySelector("span");
    expect(span.className).toContain("text-danger");
    expect(span.textContent).toMatch(/\+6\.0%/);
  });

  it("below mid -8% → rose (>5% threshold both sides)", () => {
    const { container } = render(
      <SpreadIndicator currentRate={27.6} marketRate={30} />
    );
    const span = container.querySelector("span");
    expect(span.className).toContain("text-danger");
    expect(span.textContent).toMatch(/-8\.0%/);
  });

  it("tooltip contains current/market/spread details", () => {
    const { container } = render(
      <SpreadIndicator currentRate={30.6} marketRate={30} />
    );
    const span = container.querySelector("span");
    const title = span.getAttribute("title");
    expect(title).toMatch(/current.*30\.6/);
    expect(title).toMatch(/market.*30/);
    expect(title).toMatch(/spread.*\+2\.00%/);
  });
});
